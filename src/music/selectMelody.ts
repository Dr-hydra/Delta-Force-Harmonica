import type { NoteEvent } from './types';

/** Keep original attacks, even when multiple notes share a model grid cell.
 * Only truly simultaneous attacks compete; probability breaks chord ties.
 */
export function selectProbableMelody(notes: NoteEvent[], probabilities: number[], threshold: number): NoteEvent[] {
  const selected = notes.map((note, index) => ({ note, probability: probabilities[index] ?? 0 }))
    .filter((entry) => Number.isFinite(entry.probability) && entry.probability >= threshold)
    .sort((a, b) => a.note.start - b.note.start || b.probability - a.probability || b.note.pitch - a.note.pitch);
  return selected.filter((entry, index) => index === 0 || entry.note.start !== selected[index - 1].note.start)
    .map((entry) => entry.note);
}
