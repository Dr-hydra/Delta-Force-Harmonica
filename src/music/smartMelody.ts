import type { NoteEvent } from "./types";
import { CHORD_WINDOW_MS, enforceMonophonic } from "./monophonic";

interface MelodyCandidate {
  note: NoteEvent;
  localScore: number;
  group: number;
}

const MAX_GROUP_CANDIDATES = 12;
const BEAM_WIDTH = 64;
const PHRASE_GAP_MS = 600;
const NOTE_INSERTION_COST = 1.6;

export interface MelodyOptions {
  bpm?: number;
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function localScore(note: NoteEvent, pitchRank: number, groupSize: number, timeScale: number): number {
  const velocity = clamp01(note.velocity ?? 0.65);
  const duration = note.duration / timeScale;
  const durationScore = clamp01(Math.log2(1 + duration / 55) / 4.3);
  const registerScore = 1 - clamp01(Math.abs(note.pitch - 69) / 38);
  const shortPenalty = duration < 75 ? 0.72 : duration < 120 ? 0.28 : 0;
  const beatAccent = note.beat !== undefined && Number.isFinite(note.beat)
    ? (Math.abs(note.beat - Math.round(note.beat)) < 1 / 24 ? 0.18 : 0) : 0;
  const densityPenalty = Math.min(0.58, Math.max(0, groupSize - 4) * 0.075);

  return 0.72
    + pitchRank * 1.12
    + durationScore * 0.92
    + velocity * 0.52
    + registerScore * 0.22
    + beatAccent
    - shortPenalty
    - densityPenalty;
}

function pruneOnsetGroups(notes: NoteEvent[], timeScale: number): MelodyCandidate[] {
  const sorted = [...notes]
    .filter((note) => Number.isFinite(note.start) && Number.isFinite(note.duration) && Number.isFinite(note.pitch))
    .sort((a, b) => a.start - b.start || b.pitch - a.pitch);
  const candidates: MelodyCandidate[] = [];

  for (let index = 0; index < sorted.length;) {
    const start = sorted[index].start;
    const group: NoteEvent[] = [];
    let cursor = index;
    while (cursor < sorted.length && sorted[cursor].start - start <= CHORD_WINDOW_MS) {
      group.push(sorted[cursor]);
      cursor += 1;
    }

    // Unison doublings must not fill the candidate budget or bias pitch rank.
    const unique = new Map<number, NoteEvent>();
    for (const note of group) {
      const previous = unique.get(note.pitch);
      if (!previous || localScore(note, 0, 1, timeScale) > localScore(previous, 0, 1, timeScale)) {
        unique.set(note.pitch, note);
      }
    }
    const byPitch = [...unique.values()].sort((a, b) => a.pitch - b.pitch);
    const scored = byPitch.map((note) => {
      const rankIndex = byPitch.findIndex((candidate) => candidate === note);
      const pitchRank = byPitch.length <= 1 ? 0.58 : rankIndex / (byPitch.length - 1);
      return { note, localScore: localScore(note, pitchRank, byPitch.length, timeScale), group: index };
    });

    scored
      .sort((a, b) => b.localScore - a.localScore || b.note.pitch - a.note.pitch)
      .slice(0, MAX_GROUP_CANDIDATES)
      .forEach((candidate) => candidates.push(candidate));

    index = cursor;
  }

  return candidates.sort((a, b) => a.note.start - b.note.start || b.note.pitch - a.note.pitch);
}

function transitionScore(a: NoteEvent, b: NoteEvent, timeScale: number): number {
  if (b.start - a.start <= CHORD_WINDOW_MS) return Number.NEGATIVE_INFINITY;
  const onsetGap = (b.start - a.start) / timeScale;

  const aEnd = a.start + a.duration;
  const overlap = Math.max(0, aEnd - b.start) / timeScale;
  const silence = Math.max(0, b.start - aEnd) / timeScale;
  const jump = Math.abs(b.pitch - a.pitch);
  let score = -0.56;

  if (overlap > 120) score -= Math.min(3.8, overlap / 210);
  else if (overlap > 0) score -= overlap / 310;

  if (silence <= 85) score += 0.58;
  else if (silence <= 320) score += 0.26 - silence / 1500;
  else score -= Math.min(2.45, (silence - 320) / 900);

  if (jump <= 2) score += 0.84;
  else if (jump <= 5) score += 0.52;
  else if (jump <= 7) score += 0.24;
  else if (jump <= 12) score -= (jump - 7) * 0.14;
  else score -= 0.95 + (jump - 12) * 0.12;

  if (onsetGap < 90) score -= 2.2;
  else if (onsetGap < 135) score -= 0.82;

  if (jump === 0 && onsetGap < 190) score -= 0.32;
  return score;
}

interface PathNode {
  note: NoteEvent;
  previous: PathNode | null;
}

interface VoiceState {
  score: number;
  path: PathNode | null;
}

function coverage(note: NoteEvent | undefined, from: number, to: number, timeScale: number): number {
  if (!note) return 0;
  const sounding = Math.max(0, Math.min(to, note.start + note.duration) - Math.max(from, note.start));
  return sounding / (500 * timeScale) * 0.9;
}

/** Beam search over onset groups, with an explicit hold/skip alternative.
 * Every state advances through the same elapsed time. Sustained notes earn
 * coverage while accompaniment passes, rather than losing to note-count alone.
 * Linked paths avoid copying the whole score at every onset; states ending on
 * the same candidate have identical futures, so only the best one is retained.
 */
function bestPathForSegment(segment: MelodyCandidate[], timeScale: number): NoteEvent[] {
  if (segment.length === 0) return [];
  let beam: VoiceState[] = [{ score: 0, path: null }];
  let boundary = segment[0].note.start;

  for (let index = 0; index < segment.length;) {
    let end = index + 1;
    while (end < segment.length && segment[end].group === segment[index].group) end += 1;
    const group = segment.slice(index, end);
    const nextBoundary = group[group.length - 1].note.start;
    const next: VoiceState[] = beam.map((state) => ({
      score: state.score + coverage(state.path?.note, boundary, nextBoundary, timeScale),
      path: state.path
    }));

    for (const candidate of group) {
      let bestScore = Number.NEGATIVE_INFINITY;
      let previous: PathNode | null = null;
      for (const state of beam) {
        const last = state.path?.note;
        const transition = last ? transitionScore(last, candidate.note, timeScale) : 0;
        const score = state.score
          + coverage(last, boundary, candidate.note.start, timeScale)
          + candidate.localScore - NOTE_INSERTION_COST + transition
          + coverage(candidate.note, candidate.note.start, nextBoundary, timeScale);
        if (score > bestScore) {
          bestScore = score;
          previous = state.path;
        }
      }
      if (Number.isFinite(bestScore)) next.push({ score: bestScore, path: { note: candidate.note, previous } });
    }
    beam = next.sort((a, b) => b.score - a.score).slice(0, BEAM_WIDTH);
    boundary = nextBoundary;
    index = end;
  }

  const endTime = segment.reduce((end, item) => Math.max(end, item.note.start + item.note.duration), boundary);
  const best = beam.reduce((a, b) =>
    b.score + coverage(b.path?.note, boundary, endTime, timeScale)
      > a.score + coverage(a.path?.note, boundary, endTime, timeScale) ? b : a);
  const path: NoteEvent[] = [];
  for (let cursor = best.path; cursor; cursor = cursor.previous) path.push({ ...cursor.note });
  // Even a very short/quiet isolated phrase should remain audible.
  if (path.length === 0) {
    const strongest = segment.reduce((a, b) => b.localScore > a.localScore ? b : a);
    return [{ ...strongest.note }];
  }
  return path.reverse();
}

function isSingleVoice(notes: NoteEvent[], timeScale: number): boolean {
  return notes.every((note, index) => {
    if (index === 0) return true;
    const previous = notes[index - 1];
    const overlap = previous.start + previous.duration - note.start;
    // Small MIDI legato overlaps are articulation, not a second voice.
    return note.start - previous.start > CHORD_WINDOW_MS
      && overlap <= Math.min(60 * timeScale, previous.duration * 0.2);
  });
}

/**
 * Heuristic melody extraction for browser use. It keeps several candidates per
 * onset group and uses a bounded beam to track coherent voices and held notes instead
 * of selecting the highest note independently at every chord. A fixed insertion
 * cost prevents dense short accompaniment from winning merely by having more notes.
 */
export function extractSmartMelody(notes: NoteEvent[], options: MelodyOptions = {}): NoteEvent[] {
  const bpm = options.bpm ?? 120;
  const timeScale = Number.isFinite(bpm) && bpm > 0 ? Math.max(0.3, Math.min(3, 120 / bpm)) : 1;
  const sorted = notes.filter((note) => Number.isFinite(note.start) && note.start >= 0
    && Number.isFinite(note.duration) && note.duration > 0 && Number.isFinite(note.pitch))
    .sort((a, b) => a.start - b.start || b.pitch - a.pitch);
  const segments: NoteEvent[][] = [];
  let current: NoteEvent[] = [];
  let soundingEnd = Number.NEGATIVE_INFINITY;

  for (const note of sorted) {
    // Split at silence, not at onset distance: long held notes belong to their
    // following phrase. Separate phrases must not compete for one global path.
    if (current.length > 0 && note.start - soundingEnd > PHRASE_GAP_MS * timeScale) {
      segments.push(current);
      current = [];
    }
    current.push(note);
    soundingEnd = Math.max(soundingEnd, note.start + note.duration);
  }
  if (current.length > 0) segments.push(current);

  return enforceMonophonic(segments.flatMap((segment) => isSingleVoice(segment, timeScale)
    ? segment
    : bestPathForSegment(pruneOnsetGroups(segment, timeScale), timeScale))).notes;
}
