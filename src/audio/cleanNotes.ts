import type { NoteEvent } from "../music/types";
import { AUDIO_PRESETS, type AudioTranscriptionPreset } from "./presets";

export interface AudioCleanStats {
  rawCount: number;
  cleanCount: number;
  removedRange: number;
  removedShort: number;
  removedWeak: number;
  mergedFragments: number;
  removedDensity: number;
  amplitudeFloor: number;
}

export interface AudioCleanResult {
  notes: NoteEvent[];
  stats: AudioCleanStats;
}

function quantile(values: number[], q: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const position = Math.max(0, Math.min(sorted.length - 1, (sorted.length - 1) * q));
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  if (lower === upper) return sorted[lower];
  const weight = position - lower;
  return sorted[lower] * (1 - weight) + sorted[upper] * weight;
}

function noteStrength(note: NoteEvent): number {
  const velocity = note.velocity ?? 0.65;
  const duration = Math.min(1, note.duration / 650);
  const register = 1 - Math.min(1, Math.abs(note.pitch - 67) / 34);
  return velocity * 1.55 + duration * 0.72 + register * 0.2;
}

function mergeFragments(notes: NoteEvent[], gapMs: number): NoteEvent[] {
  const merged: NoteEvent[] = [];
  const lastByPitch = new Map<number, NoteEvent>();

  for (const source of notes) {
    const note = { ...source };
    const previous = lastByPitch.get(note.pitch);
    if (previous) {
      const previousEnd = previous.start + previous.duration;
      const gap = note.start - previousEnd;
      if (gap <= gapMs && note.start - previous.start <= 850) {
        const end = Math.max(previousEnd, note.start + note.duration);
        previous.duration = Math.max(1, end - previous.start);
        previous.velocity = Math.max(previous.velocity ?? 0, note.velocity ?? 0);
        continue;
      }
    }

    merged.push(note);
    lastByPitch.set(note.pitch, note);
  }

  return merged.sort((a, b) => a.start - b.start || b.pitch - a.pitch);
}

function limitChordDensity(notes: NoteEvent[], windowMs: number, maxNotes: number): NoteEvent[] {
  if (notes.length <= maxNotes) return notes.map((note) => ({ ...note }));
  const result: NoteEvent[] = [];

  for (let index = 0; index < notes.length;) {
    const groupStart = notes[index].start;
    const group: NoteEvent[] = [];
    let cursor = index;
    while (cursor < notes.length && notes[cursor].start - groupStart <= windowMs) {
      group.push(notes[cursor]);
      cursor += 1;
    }

    if (group.length <= maxNotes) {
      result.push(...group.map((note) => ({ ...note })));
    } else {
      const selected = [...group]
        .sort((a, b) => noteStrength(b) - noteStrength(a) || b.pitch - a.pitch)
        .slice(0, maxNotes)
        .sort((a, b) => a.start - b.start || b.pitch - a.pitch);
      result.push(...selected.map((note) => ({ ...note })));
    }
    index = cursor;
  }

  return result;
}

export function cleanAudioNotes(
  input: NoteEvent[],
  preset: AudioTranscriptionPreset = "balanced"
): AudioCleanResult {
  const config = AUDIO_PRESETS[preset];
  const finite = input
    .filter((note) => Number.isFinite(note.pitch) && Number.isFinite(note.start) && Number.isFinite(note.duration))
    .sort((a, b) => a.start - b.start || b.pitch - a.pitch);

  const inRange = finite.filter((note) => note.pitch >= config.minMidi && note.pitch <= config.maxMidi);
  const longEnough = inRange.filter((note) => note.duration >= config.minDurationMs);
  const amplitudes = longEnough.map((note) => note.velocity ?? 0.65);
  const quantileFloor = quantile(amplitudes, config.amplitudeQuantile);
  const amplitudeFloor = Math.max(config.minAmplitude, quantileFloor - 1e-6);
  const strongEnough = longEnough.filter((note) => (note.velocity ?? 0.65) >= amplitudeFloor);
  const merged = mergeFragments(strongEnough, config.mergeGapMs);
  const densityLimited = limitChordDensity(merged, config.chordWindowMs, config.maxChordNotes);

  return {
    notes: densityLimited,
    stats: {
      rawCount: input.length,
      cleanCount: densityLimited.length,
      removedRange: finite.length - inRange.length,
      removedShort: inRange.length - longEnough.length,
      removedWeak: longEnough.length - strongEnough.length,
      mergedFragments: strongEnough.length - merged.length,
      removedDensity: merged.length - densityLimited.length,
      amplitudeFloor
    }
  };
}
