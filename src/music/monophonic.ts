import type { NoteEvent } from "./types";

/**
 * Converts a possibly polyphonic track into a simple melody.
 * Notes beginning within the same 8 ms window are treated as one chord and the
 * highest note is retained. Overlapping previous notes are shortened so the
 * output becomes monophonic without moving any onset.
 */
export function extractHighestMelody(notes: NoteEvent[]): NoteEvent[] {
  if (notes.length <= 1) return notes.map((note) => ({ ...note }));

  const sorted = [...notes].sort((a, b) => a.start - b.start || b.pitch - a.pitch);
  const picked: NoteEvent[] = [];

  for (let i = 0; i < sorted.length;) {
    const start = sorted[i].start;
    let best = sorted[i];
    let j = i + 1;

    while (j < sorted.length && sorted[j].start - start <= 8) {
      if (sorted[j].pitch > best.pitch) best = sorted[j];
      j += 1;
    }

    const current = { ...best };
    const previous = picked[picked.length - 1];
    if (previous && previous.start + previous.duration > current.start) {
      previous.duration = Math.max(1, current.start - previous.start);
    }

    picked.push(current);
    i = j;
  }

  return picked;
}
