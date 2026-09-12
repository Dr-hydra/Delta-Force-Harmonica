import type { NoteEvent } from "../music/types";
import { enforceMonophonic } from "../music/monophonic";

export const MIN_PITCH = 21;
export const MAX_PITCH = 108;
const MIN_DURATION_BEATS = 1 / 32;

export interface EditResult {
  notes: NoteEvent[];
  /** Index of the edited note after re-sorting, or null when it was removed. */
  selected: number | null;
  /** All selected indices after a batch edit. */
  selectedMany?: number[];
}

const msPerBeat = (bpm: number) => 60000 / Math.max(1, bpm);

/** Converts a horizontal pointer movement into a quantized beat delta. */
export function snapDragDelta(
  pixelDelta: number,
  laneWidth: number,
  measureBeats: number,
  stepBeats: number
) {
  if (!Number.isFinite(pixelDelta) || laneWidth <= 0 || measureBeats <= 0) return 0;
  const step = Math.max(MIN_DURATION_BEATS, stepBeats);
  const raw = pixelDelta / laneWidth * measureBeats;
  return Math.round(raw / step) * step;
}

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

function commitMany(notes: NoteEvent[], edited: NoteEvent[], bpm: number): EditResult {
  const editedSet = new Set(edited);
  const synced = notes.map((note) => sync(note, bpm));
  const selectedTargets = synced.filter((_, index) => editedSet.has(notes[index]));
  const sorted = [...synced].sort((a, b) => (a.beat ?? 0) - (b.beat ?? 0) || b.pitch - a.pitch);
  const selectedMany = selectedTargets.map((note) => sorted.indexOf(note)).filter((index) => index >= 0).sort((a, b) => a - b);
  return { notes: sorted, selected: selectedMany.at(-1) ?? null, selectedMany };
}

function validIndices(notes: NoteEvent[], indices: number[]) {
  return [...new Set(indices)].filter((index) => index >= 0 && index < notes.length).sort((a, b) => a - b);
}

export function transposeNotes(notes: NoteEvent[], indices: number[], semitones: number, bpm: number): EditResult {
  const selected = new Set(validIndices(notes, indices));
  if (selected.size === 0) return { notes, selected: null, selectedMany: [] };
  const edited: NoteEvent[] = [];
  const changed = notes.map((note, index) => {
    if (!selected.has(index)) return note;
    const next = { ...note, pitch: Math.min(MAX_PITCH, Math.max(MIN_PITCH, note.pitch + semitones)) };
    edited.push(next);
    return next;
  });
  return commitMany(changed, edited, bpm);
}

export function moveNotes(notes: NoteEvent[], indices: number[], beats: number, bpm: number): EditResult {
  const selected = new Set(validIndices(notes, indices));
  if (selected.size === 0) return { notes, selected: null, selectedMany: [] };
  const minimumBeat = Math.min(...[...selected].map((index) => toBeats(notes[index], bpm).beat));
  const safeDelta = Math.max(beats, -minimumBeat);
  const edited: NoteEvent[] = [];
  const changed = notes.map((note, index) => {
    if (!selected.has(index)) return note;
    const timing = toBeats(note, bpm);
    const next = { ...note, beat: timing.beat + safeDelta, durationBeats: timing.durationBeats };
    edited.push(next);
    return next;
  });
  return commitMany(changed, edited, bpm);
}

export function resizeNotes(notes: NoteEvent[], indices: number[], beats: number, bpm: number): EditResult {
  const selected = new Set(validIndices(notes, indices));
  if (selected.size === 0) return { notes, selected: null, selectedMany: [] };
  const edited: NoteEvent[] = [];
  const changed = notes.map((note, index) => {
    if (!selected.has(index)) return note;
    const timing = toBeats(note, bpm);
    const next = { ...note, beat: timing.beat, durationBeats: Math.max(MIN_DURATION_BEATS, timing.durationBeats + beats) };
    edited.push(next);
    return next;
  });
  return commitMany(changed, edited, bpm);
}

export function deleteNotes(notes: NoteEvent[], indices: number[], bpm: number): EditResult {
  const selected = validIndices(notes, indices);
  if (selected.length === 0) return { notes, selected: null, selectedMany: [] };
  const removed = new Set(selected);
  const remaining = normalizeNotes(notes.filter((_, index) => !removed.has(index)), bpm);
  if (remaining.length === 0) return { notes: [], selected: null, selectedMany: [] };
  const nextIndex = Math.min(selected[0], remaining.length - 1);
  return { notes: remaining, selected: nextIndex, selectedMany: [nextIndex] };
}

/** Copies a selection as a beat-relative fragment suitable for internal paste. */
export function copyNoteFragment(notes: NoteEvent[], indices: number[], bpm: number): NoteEvent[] {
  const selected = validIndices(notes, indices).map((index) => notes[index]);
  if (selected.length === 0) return [];
  const normalized = normalizeNotes(selected, bpm);
  const firstBeat = Math.min(...normalized.map((note) => toBeats(note, bpm).beat));
  return normalizeNotes(normalized.map((note) => {
    const timing = toBeats(note, bpm);
    return { ...note, beat: timing.beat - firstBeat, durationBeats: timing.durationBeats };
  }), bpm);
}

/** Pastes a beat-relative fragment and makes enough room in the following phrase. */
export function pasteNoteFragment(notes: NoteEvent[], fragment: NoteEvent[], atBeat: number, bpm: number): EditResult {
  if (fragment.length === 0) return { notes, selected: null, selectedMany: [] };
  const source = normalizeNotes(fragment, bpm);
  const targetBeat = Math.max(0, atBeat);
  const span = Math.max(...source.map((note) => {
    const timing = toBeats(note, bpm);
    return timing.beat + timing.durationBeats;
  }));
  const next = notes.find((note) => toBeats(note, bpm).beat >= targetBeat);
  const nextBeat = next ? toBeats(next, bpm).beat : null;
  const push = nextBeat !== null && nextBeat < targetBeat + span ? targetBeat + span - nextBeat : 0;
  const shifted = push > 0
    ? notes.map((note) => {
      const timing = toBeats(note, bpm);
      return timing.beat >= nextBeat!
        ? { ...note, beat: timing.beat + push, durationBeats: timing.durationBeats }
        : note;
    })
    : [...notes];
  const pasted = source.map((note) => {
    const timing = toBeats(note, bpm);
    return { ...note, beat: targetBeat + timing.beat, durationBeats: timing.durationBeats };
  });
  return commitMany([...shifted, ...pasted], pasted, bpm);
}

export function selectionEndBeat(notes: NoteEvent[], indices: number[], bpm: number) {
  const selected = validIndices(notes, indices);
  if (selected.length === 0) return 0;
  return Math.max(...selected.map((index) => {
    const timing = toBeats(notes[index], bpm);
    return timing.beat + timing.durationBeats;
  }));
}

/** Commits the same chord-collapse and overlap-truncation used by preview/export. */
export function resolveEditConflicts(
  notes: NoteEvent[],
  selectedIndices: number[],
  bpm: number
): EditResult {
  const normalized = normalizeNotes(notes, bpm);
  const selected = new Set(validIndices(normalized, selectedIndices));
  const mono = enforceMonophonic(normalized);
  if (mono.collapsedChordNotes === 0 && mono.truncatedNotes === 0) {
    return { notes, selected: selectedIndices.at(-1) ?? null, selectedMany: selectedIndices };
  }
  const resolved = normalizeNotes(mono.notes, bpm);
  const selectedMany = mono.sourceIndices
    .map((sourceIndex, outputIndex) => selected.has(sourceIndex) ? outputIndex : -1)
    .filter((index) => index >= 0);
  return { notes: resolved, selected: selectedMany.at(-1) ?? null, selectedMany };
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

/** Sets the editable musical values in one transaction. */
export function setNoteValues(
  notes: NoteEvent[],
  index: number,
  values: { pitch: number; beat: number; durationBeats: number },
  bpm: number
): EditResult {
  const note = notes[index];
  if (!note) return { notes, selected: index };
  const pitch = Math.min(MAX_PITCH, Math.max(MIN_PITCH, Math.round(values.pitch)));
  const beat = Math.max(0, values.beat);
  const durationBeats = Math.max(MIN_DURATION_BEATS, values.durationBeats);
  return replace(notes, index, { ...note, pitch, beat, durationBeats }, bpm);
}

export function deleteNote(notes: NoteEvent[], index: number, bpm: number): EditResult {
  if (!notes[index]) return { notes, selected: index };
  const remaining = notes.filter((_, i) => i !== index);
  const result = commit(remaining, null, bpm);
  if (result.notes.length === 0) return { notes: result.notes, selected: null };
  return { notes: result.notes, selected: Math.min(index, result.notes.length - 1) };
}

/**
 * Removes a note and pulls the following phrase to the deleted onset. Relative
 * timing from the next note onward is preserved; deleting the tail behaves like
 * a normal delete because there is nothing left to pull forward.
 */
export function deleteNoteAndClose(notes: NoteEvent[], index: number, bpm: number): EditResult {
  const target = notes[index];
  if (!target) return { notes, selected: index };
  const targetBeat = toBeats(target, bpm).beat;
  const next = notes.slice(index + 1).find((note) => toBeats(note, bpm).beat > targetBeat);
  if (!next) return deleteNote(notes, index, bpm);

  const nextBeat = toBeats(next, bpm).beat;
  const shift = Math.max(0, nextBeat - targetBeat);
  let selectedTarget: NoteEvent | null = null;
  const remaining = notes
    .filter((_, current) => current !== index)
    .map((note) => {
      const { beat, durationBeats } = toBeats(note, bpm);
      const shifted = beat >= nextBeat ? { ...note, beat: Math.max(0, beat - shift), durationBeats } : note;
      if (note === next) selectedTarget = shifted;
      return shifted;
    });
  const result = commit(remaining, selectedTarget, bpm);
  return { notes: result.notes, selected: result.selected };
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

/**
 * Inserts at an explicit beat selected on the score. If the remaining rest is
 * shorter than the new note, the following phrase is pushed just far enough to
 * make room instead of creating a silent overlap that is later truncated.
 */
export function insertNoteAt(notes: NoteEvent[], beat: number, stepBeats: number, bpm: number): EditResult {
  const step = Math.max(MIN_DURATION_BEATS, stepBeats);
  const safeBeat = Math.max(0, beat);
  const next = notes.find((note) => toBeats(note, bpm).beat >= safeBeat);
  const nextBeat = next ? toBeats(next, bpm).beat : null;
  const push = nextBeat !== null && nextBeat < safeBeat + step ? safeBeat + step - nextBeat : 0;

  const shifted = push > 0
    ? notes.map((note) => {
      const timing = toBeats(note, bpm);
      return timing.beat >= nextBeat!
        ? { ...note, beat: timing.beat + push, durationBeats: timing.durationBeats }
        : note;
    })
    : [...notes];
  const previous = [...shifted].reverse().find((note) => toBeats(note, bpm).beat < safeBeat);
  const pitchSource = previous ?? next;
  const inserted = sync({
    pitch: pitchSource?.pitch ?? 60,
    start: 0,
    duration: 0,
    beat: safeBeat,
    durationBeats: step,
    velocity: pitchSource?.velocity ?? 0.8
  }, bpm);
  return commit([...shifted, inserted], inserted, bpm);
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

/**
 * Removes silent spans at or above the requested length. Shorter rests are
 * preserved, while later notes are shifted left in both beat and millisecond
 * time so playback and exports remain aligned.
 */
export function clearLongSilences(
  notes: NoteEvent[],
  thresholdSeconds: number,
  bpm: number,
  selected: number | null = null
): EditResult {
  if (notes.length === 0 || !Number.isFinite(thresholdSeconds) || thresholdSeconds <= 0) {
    return { notes, selected };
  }

  const thresholdBeats = thresholdSeconds * 1000 / msPerBeat(bpm);
  let removedBeats = 0;
  let soundingUntil = 0;
  let changed = false;

  const shifted = notes.map((note) => {
    const { beat, durationBeats } = toBeats(note, bpm);
    const silence = beat - soundingUntil;
    if (silence >= thresholdBeats) {
      removedBeats += silence;
      changed = true;
    }

    soundingUntil = Math.max(soundingUntil, beat + durationBeats);
    return removedBeats > 0 ? { ...note, beat: beat - removedBeats, durationBeats } : note;
  });

  if (!changed) return { notes, selected };
  return {
    notes: normalizeNotes(shifted, bpm),
    selected: selected === null ? null : Math.min(selected, shifted.length - 1)
  };
}
