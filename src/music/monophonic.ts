import type { NoteEvent } from "./types";

/**
 * Onsets closer than this are treated as one chord rather than as a melodic
 * step. 45 ms matches the minimum onset gap Smart Melody Path allows between
 * two consecutive melody notes, so the two modules agree on what "at the same
 * time" means.
 */
export const CHORD_WINDOW_MS = 45;

export interface MonoResult {
  notes: NoteEvent[];
  /**
   * For every output note, its index in the input array. Callers that let the
   * user edit the input need this: enforcement removes and shortens notes, so
   * output positions do not line up with input positions.
   */
  sourceIndices: number[];
  /** Notes dropped because they sounded together with a kept note. */
  collapsedChordNotes: number;
  /** Notes shortened because the next onset arrived before they ended. */
  truncatedNotes: number;
}

function shorten(note: NoteEvent, next: NoteEvent): NoteEvent {
  const duration = Math.max(1, next.start - note.start);
  const shortened: NoteEvent = { ...note, duration };
  if (note.beat !== undefined && next.beat !== undefined) {
    shortened.durationBeats = Math.max(1 / 96, next.beat - note.beat);
  } else if (note.durationBeats !== undefined && note.duration > 0) {
    shortened.durationBeats = Math.max(1 / 96, note.durationBeats * (duration / note.duration));
  }
  return shortened;
}

/**
 * Makes a note list playable on the in-game harmonica, which sounds exactly one
 * note at a time. Notes starting within CHORD_WINDOW_MS of each other are a
 * chord and only the highest survives; a note still ringing when the next onset
 * arrives is cut short there. No onset ever moves, and the result is a no-op for
 * input that is already monophonic.
 *
 * The highest note wins because the melody sits on top of the accompaniment in
 * almost all of the material this tool takes, and because keeping the top voice
 * is what the score preview and the macro export already assumed separately.
 */
export function enforceMonophonic(notes: NoteEvent[]): MonoResult {
  const indexed = notes
    .map((note, sourceIndex) => ({ note, sourceIndex }))
    .filter(({ note }) => Number.isFinite(note.pitch) && Number.isFinite(note.start) && Number.isFinite(note.duration))
    .sort((a, b) => a.note.start - b.note.start || b.note.pitch - a.note.pitch);

  const picked: Array<{ note: NoteEvent; sourceIndex: number }> = [];
  let collapsedChordNotes = 0;

  for (let i = 0; i < indexed.length;) {
    const groupStart = indexed[i].note.start;
    let best = indexed[i];
    let j = i + 1;

    while (j < indexed.length && indexed[j].note.start - groupStart <= CHORD_WINDOW_MS) {
      const candidate = indexed[j];
      const higher = candidate.note.pitch > best.note.pitch;
      const sameButLonger = candidate.note.pitch === best.note.pitch && candidate.note.duration > best.note.duration;
      if (higher || sameButLonger) best = candidate;
      j += 1;
    }

    collapsedChordNotes += j - i - 1;
    picked.push({ note: { ...best.note }, sourceIndex: best.sourceIndex });
    i = j;
  }

  let truncatedNotes = 0;
  for (let i = 0; i < picked.length - 1; i += 1) {
    const current = picked[i].note;
    const next = picked[i + 1].note;
    if (current.start + current.duration > next.start) {
      picked[i].note = shorten(current, next);
      truncatedNotes += 1;
    }
  }

  return {
    notes: picked.map((entry) => entry.note),
    sourceIndices: picked.map((entry) => entry.sourceIndex),
    collapsedChordNotes,
    truncatedNotes
  };
}

/**
 * Skyline baseline: the melody is whatever note is on top. Density is untouched
 * apart from the chord collapse enforcement performs anyway.
 */
export function extractHighestMelody(notes: NoteEvent[]): NoteEvent[] {
  return enforceMonophonic(notes).notes;
}
