import type { NoteEvent } from "../music/types";

export const MIN_PITCH = 21;
export const MAX_PITCH = 108;
const MIN_DURATION_BEATS = 1 / 32;

export interface EditResult {
  notes: NoteEvent[];
  /** Index of the edited note after re-sorting, or null when it was removed. */
  selected: number | null;
}

const msPerBeat = (bpm: number) => 60000 / Math.max(1, bpm);

/**
 * Beat position is the authoritative field for editing, because that is what the
 * score lays bars out from; the millisecond fields are derived so playback and
 * the macro export stay in step with what is on screen.
 */
function toBeats(note: NoteEvent, bpm: number) {
  const perBeat = msPerBeat(bpm);
  return {
    beat: note.beat ?? note.start / perBeat,
    durationBeats: note.durationBeats ?? Math.max(MIN_DURATION_BEATS, note.duration / perBeat)
  };
}

function sync(note: NoteEvent, bpm: number): NoteEvent {
  const perBeat = msPerBeat(bpm);
  const { beat, durationBeats } = toBeats(note, bpm);
  const safeBeat = Math.max(0, beat);
  const safeDuration = Math.max(MIN_DURATION_BEATS, durationBeats);
  return {
    ...note,
    beat: safeBeat,
    durationBeats: safeDuration,
    start: Math.max(0, Math.round(safeBeat * perBeat)),
    duration: Math.max(20, Math.round(safeDuration * perBeat))
  };
}

/** Brings every note into a consistent beat/millisecond state and sorts it. */
export function normalizeNotes(notes: NoteEvent[], bpm: number): NoteEvent[] {
  return notes
    .map((note) => sync(note, bpm))
    .sort((a, b) => (a.beat ?? 0) - (b.beat ?? 0) || b.pitch - a.pitch);
}

/** Re-sorts after an edit and reports where the edited note ended up. */
function commit(notes: NoteEvent[], edited: NoteEvent | null, bpm: number): EditResult {
  const editedIndex = edited ? notes.indexOf(edited) : -1;
  const synced = notes.map((note) => sync(note, bpm));
  const target = editedIndex >= 0 ? synced[editedIndex] : null;
  const sorted = [...synced].sort((a, b) => (a.beat ?? 0) - (b.beat ?? 0) || b.pitch - a.pitch);
  const selected = target ? sorted.indexOf(target) : -1;
  return { notes: sorted, selected: selected === -1 ? null : selected };
}

function replace(notes: NoteEvent[], index: number, next: NoteEvent, bpm: number): EditResult {
  const copy = [...notes];
  copy[index] = next;
  return commit(copy, next, bpm);
}

export function transposeNote(notes: NoteEvent[], index: number, semitones: number, bpm: number): EditResult {
  const note = notes[index];
  if (!note) return { notes, selected: index };
  const pitch = Math.min(MAX_PITCH, Math.max(MIN_PITCH, note.pitch + semitones));
  if (pitch === note.pitch) return { notes, selected: index };
  return replace(notes, index, { ...note, pitch }, bpm);
}

/** Shifts the onset while keeping the length. */
export function moveNote(notes: NoteEvent[], index: number, beats: number, bpm: number): EditResult {
  const note = notes[index];
  if (!note) return { notes, selected: index };
  const { beat, durationBeats } = toBeats(note, bpm);
  return replace(notes, index, { ...note, beat: Math.max(0, beat + beats), durationBeats }, bpm);
}

/** Grows or shrinks the length, keeping the onset. */
export function resizeNote(notes: NoteEvent[], index: number, beats: number, bpm: number): EditResult {
  const note = notes[index];
  if (!note) return { notes, selected: index };
  const { beat, durationBeats } = toBeats(note, bpm);
  return replace(notes, index, {
    ...note,
    beat,
    durationBeats: Math.max(MIN_DURATION_BEATS, durationBeats + beats)
  }, bpm);
}

export function deleteNote(notes: NoteEvent[], index: number, bpm: number): EditResult {
  if (!notes[index]) return { notes, selected: index };
  const remaining = notes.filter((_, i) => i !== index);
  const result = commit(remaining, null, bpm);
  if (result.notes.length === 0) return { notes: result.notes, selected: null };
  return { notes: result.notes, selected: Math.min(index, result.notes.length - 1) };
}

/**
 * Inserts a note after the selected one, at the next free step. With nothing
 * selected it starts a score at beat 0, which is how a hand-built tab begins.
 */
export function insertNote(notes: NoteEvent[], index: number | null, stepBeats: number, bpm: number): EditResult {
  const step = Math.max(MIN_DURATION_BEATS, stepBeats);
  const anchor = index !== null ? notes[index] : undefined;
  if (!anchor) {
    const first = sync({ pitch: 60, start: 0, duration: 0, beat: 0, durationBeats: step, velocity: 0.8 }, bpm);
    return commit([...notes, first], first, bpm);
  }
  const { beat, durationBeats } = toBeats(anchor, bpm);
  const next: NoteEvent = {
    ...anchor,
    beat: beat + Math.max(step, durationBeats),
    durationBeats: step,
    velocity: anchor.velocity ?? 0.8
  };
  return commit([...notes, next], next, bpm);
}

/** Rounds every onset and length onto a subdivision of the beat. */
export function snapAll(notes: NoteEvent[], stepBeats: number, bpm: number): NoteEvent[] {
  const step = Math.max(MIN_DURATION_BEATS, stepBeats);
  const snap = (value: number) => Math.round(value / step) * step;
  return normalizeNotes(
    notes.map((note) => {
      const { beat, durationBeats } = toBeats(note, bpm);
      return { ...note, beat: Math.max(0, snap(beat)), durationBeats: Math.max(step, snap(durationBeats)) };
    }),
    bpm
  );
}
