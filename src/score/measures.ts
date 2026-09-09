import type { GameNote, TimeSignatureEvent } from "../music/types";

export interface ScoreMeasureNote {
  note: GameNote;
  index: number;
  beat: number;
  durationBeats: number;
  offsetBeats: number;
}

export interface ScoreMeasure {
  number: number;
  startBeat: number;
  endBeat: number;
  lengthBeats: number;
  numerator: number;
  denominator: number;
  notes: ScoreMeasureNote[];
}

const EPSILON = 1e-6;

function noteBeat(note: GameNote, bpm: number): number {
  if (note.beat !== undefined) return note.beat;
  return note.start * bpm / 60000;
}

function noteDurationBeats(note: GameNote, bpm: number): number {
  if (note.durationBeats !== undefined) return note.durationBeats;
  return Math.max(1 / 96, note.duration * bpm / 60000);
}

function normalizeSignatures(events: TimeSignatureEvent[]): TimeSignatureEvent[] {
  const sorted = [...events]
    .filter((event) => event.numerator > 0 && event.denominator > 0)
    .sort((a, b) => a.beat - b.beat);
  if (sorted.length === 0 || sorted[0].beat > EPSILON) {
    sorted.unshift({ beat: 0, numerator: 4, denominator: 4 });
  }
  return sorted;
}

function signatureAt(beat: number, signatures: TimeSignatureEvent[]): TimeSignatureEvent {
  let current = signatures[0];
  for (let index = 1; index < signatures.length; index += 1) {
    if (signatures[index].beat > beat + EPSILON) break;
    current = signatures[index];
  }
  return current;
}

function nextSignatureAfter(beat: number, signatures: TimeSignatureEvent[]): TimeSignatureEvent | undefined {
  return signatures.find((event) => event.beat > beat + EPSILON);
}

function normalizedStarts(starts: number[], maxBeat: number): number[] {
  const result = [...starts]
    .filter((beat) => Number.isFinite(beat) && beat >= 0 && beat <= maxBeat + EPSILON)
    .sort((a, b) => a - b)
    .filter((beat, index, array) => index === 0 || Math.abs(beat - array[index - 1]) > EPSILON);
  if (result.length > 0 && result[0] > EPSILON) result.unshift(0);
  return result;
}

function deriveStarts(maxBeat: number, signatures: TimeSignatureEvent[]): number[] {
  const starts = [0];
  let cursor = 0;
  let guard = 0;
  while (cursor < maxBeat - EPSILON && guard < 10000) {
    guard += 1;
    const signature = signatureAt(cursor, signatures);
    const nominalLength = signature.numerator * 4 / signature.denominator;
    const nextSignature = nextSignatureAfter(cursor, signatures);
    let next = cursor + nominalLength;
    if (nextSignature && nextSignature.beat < next - EPSILON) next = nextSignature.beat;
    if (next <= cursor + EPSILON) next = cursor + Math.max(1 / 16, nominalLength);
    cursor = next;
    if (cursor < maxBeat - EPSILON) starts.push(cursor);
  }
  return starts;
}

export function buildScoreMeasures(
  notes: GameNote[],
  timeSignatures: TimeSignatureEvent[],
  bpm: number,
  explicitMeasureStarts: number[] = []
): ScoreMeasure[] {
  if (notes.length === 0) return [];
  const safeBpm = bpm > 0 ? bpm : 120;
  const signatures = normalizeSignatures(timeSignatures);
  const noteData = notes.map((note, index) => {
    const beat = noteBeat(note, safeBpm);
    const durationBeats = noteDurationBeats(note, safeBpm);
    return { note, index, beat, durationBeats };
  });
  const maxBeat = Math.max(...noteData.map((item) => item.beat + item.durationBeats));

  let starts = normalizedStarts(explicitMeasureStarts, maxBeat);
  if (starts.length === 0) starts = deriveStarts(maxBeat, signatures);
  else {
    let cursor = starts[starts.length - 1];
    let guard = 0;
    while (cursor < maxBeat - EPSILON && guard < 10000) {
      guard += 1;
      const signature = signatureAt(cursor, signatures);
      const nominalLength = signature.numerator * 4 / signature.denominator;
      const next = cursor + nominalLength;
      if (next >= maxBeat - EPSILON) break;
      cursor = next;
      starts.push(cursor);
    }
  }

  return starts.map((startBeat, measureIndex) => {
    const signature = signatureAt(startBeat, signatures);
    const nominalLength = signature.numerator * 4 / signature.denominator;
    const nextExplicit = starts[measureIndex + 1];
    const endBeat = nextExplicit ?? Math.max(startBeat + nominalLength, maxBeat);
    const lengthBeats = Math.max(1 / 16, endBeat - startBeat);
    const measureNotes = noteData
      .filter((item) => item.beat >= startBeat - EPSILON && item.beat < endBeat - EPSILON)
      .map((item) => ({ ...item, offsetBeats: Math.max(0, item.beat - startBeat) }));

    return {
      number: measureIndex + 1,
      startBeat,
      endBeat,
      lengthBeats,
      numerator: signature.numerator,
      denominator: signature.denominator,
      notes: measureNotes
    };
  });
}

export function durationLabel(beats: number): string {
  const value = Math.max(0, beats);
  const candidates: Array<[number, string]> = [
    [4, "1"], [3, "2·"], [2, "2"], [1.5, "4·"], [1, "4"],
    [0.75, "8·"], [0.5, "8"], [0.375, "16·"], [0.25, "16"], [0.125, "32"]
  ];
  const match = candidates.find(([candidate]) => Math.abs(candidate - value) < 0.04);
  return match ? match[1] : `${Math.round(value * 100) / 100}b`;
}
