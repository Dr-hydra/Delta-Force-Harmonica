import { useCallback, useState } from "react";
import type { NoteEvent } from "../music/types";
import {
  copyNoteFragment,
  normalizeNotes,
  pasteNoteFragment,
  selectionEndBeat,
  type EditResult
} from "./editNotes";

export interface ScoreEdits {
  /** The working copy: the edited notes once anything changed, otherwise the base score. */
  notes: NoteEvent[];
  editing: boolean;
  selectedNote: number | null;
  setSelectedNote: (index: number | null) => void;
  selectedNotes: number[];
  selectNote: (index: number, mode?: "replace" | "toggle" | "range") => void;
  selectAll: () => void;
  clearSelection: () => void;
  selectAdjacent: (direction: -1 | 1, extend?: boolean) => void;
  insertionBeat: number | null;
  setInsertionBeat: (beat: number | null) => void;
  editStep: number;
  setEditStep: (step: number) => void;
  canUndo: boolean;
  canRedo: boolean;
  canPaste: boolean;
  applyEdit: (operation: (notes: NoteEvent[], bpm: number) => EditResult) => void;
  copySelection: () => void;
  pasteSelection: () => void;
  duplicateSelection: () => void;
  undo: () => void;
  redo: () => void;
  reset: () => void;
  startBlank: () => void;
}

/**
 * The manual-edit state machine shared by the converter page and the score
 * library. Callers own the base notes; this hook only layers the hand-made copy
 * on top, so changing the import settings keeps working until the first edit.
 */
export function useScoreEdits(baseNotes: NoteEvent[], bpm: number): ScoreEdits {
  const [editedNotes, setEditedNotes] = useState<NoteEvent[] | null>(null);
  const [undoStack, setUndoStack] = useState<Array<{ notes: NoteEvent[]; selected: number | null; selectedMany: number[] }>>([]);
  const [redoStack, setRedoStack] = useState<Array<{ notes: NoteEvent[]; selected: number | null; selectedMany: number[] }>>([]);
  const [selectedNote, setSelectedNote] = useState<number | null>(null);
  const [selectedNotes, setSelectedNotes] = useState<number[]>([]);
  const [insertionBeat, setInsertionBeatState] = useState<number | null>(null);
  const [editStep, setEditStep] = useState(0.5);
  const [clipboard, setClipboard] = useState<NoteEvent[]>([]);

  const notes = editedNotes ?? baseNotes;
  const working = () => editedNotes ?? normalizeNotes(baseNotes, bpm || 120);

  const applyEdit = useCallback((operation: (list: NoteEvent[], tempo: number) => EditResult) => {
    const current = editedNotes ?? normalizeNotes(baseNotes, bpm || 120);
    const result = operation(current, bpm || 120);
    const nextSelected = result.selectedMany ?? (result.selected === null ? [] : [result.selected]);
    if (result.notes === current && result.selected === selectedNote && nextSelected.join(",") === selectedNotes.join(",")) return;
    setUndoStack((stack) => [...stack.slice(-49), { notes: current, selected: selectedNote, selectedMany: selectedNotes }]);
    setRedoStack([]);
    setEditedNotes(result.notes);
    setSelectedNote(result.selected);
    setSelectedNotes(nextSelected);
    setInsertionBeatState(null);
  }, [baseNotes, bpm, editedNotes, selectedNote, selectedNotes]);

  const undo = useCallback(() => {
    const previous = undoStack.at(-1);
    if (!previous) return;
    setUndoStack((stack) => stack.slice(0, -1));
    setRedoStack((stack) => [...stack, { notes: working(), selected: selectedNote, selectedMany: selectedNotes }]);
    setEditedNotes(previous.notes);
    setSelectedNote(previous.selected);
    setSelectedNotes(previous.selectedMany);
    setInsertionBeatState(null);
  }, [baseNotes, bpm, editedNotes, selectedNote, selectedNotes, undoStack]);

  const redo = useCallback(() => {
    const next = redoStack.at(-1);
    if (!next) return;
    setRedoStack((stack) => stack.slice(0, -1));
    setUndoStack((stack) => [...stack, { notes: working(), selected: selectedNote, selectedMany: selectedNotes }]);
    setEditedNotes(next.notes);
    setSelectedNote(next.selected);
    setSelectedNotes(next.selectedMany);
    setInsertionBeatState(null);
  }, [baseNotes, bpm, editedNotes, redoStack, selectedNote, selectedNotes]);

  const reset = useCallback(() => {
    setEditedNotes(null);
    setUndoStack([]);
    setRedoStack([]);
    setSelectedNote(null);
    setSelectedNotes([]);
    setInsertionBeatState(null);
  }, []);

  const startBlank = useCallback(() => {
    setUndoStack((stack) => [...stack, { notes: working(), selected: selectedNote, selectedMany: selectedNotes }]);
    setRedoStack([]);
    setEditedNotes([]);
    setSelectedNote(null);
    setSelectedNotes([]);
    setInsertionBeatState(null);
  }, [baseNotes, bpm, editedNotes, selectedNote, selectedNotes]);

  const selectNote = useCallback((index: number | null) => {
    setSelectedNote(index);
    setSelectedNotes(index === null ? [] : [index]);
    if (index !== null) setInsertionBeatState(null);
  }, []);

  const selectWithMode = useCallback((index: number, mode: "replace" | "toggle" | "range" = "replace") => {
    setInsertionBeatState(null);
    if (mode === "range" && selectedNote !== null) {
      const start = Math.min(selectedNote, index);
      const end = Math.max(selectedNote, index);
      setSelectedNotes(Array.from({ length: end - start + 1 }, (_, offset) => start + offset));
      setSelectedNote(index);
      return;
    }
    if (mode === "toggle") {
      setSelectedNotes((current) => {
        const next = current.includes(index) ? current.filter((value) => value !== index) : [...current, index].sort((a, b) => a - b);
        setSelectedNote(next.includes(index) ? index : (next.at(-1) ?? null));
        return next;
      });
      return;
    }
    setSelectedNote(index);
    setSelectedNotes([index]);
  }, [selectedNote]);

  const setInsertionBeat = useCallback((beat: number | null) => {
    setInsertionBeatState(beat);
    if (beat !== null) setSelectedNote(null);
    if (beat !== null) setSelectedNotes([]);
  }, []);

  const copySelection = useCallback(() => {
    setClipboard(copyNoteFragment(working(), selectedNotes, bpm || 120));
  }, [baseNotes, bpm, editedNotes, selectedNotes]);

  const pasteSelection = useCallback(() => {
    if (clipboard.length === 0) return;
    const current = working();
    const target = insertionBeat ?? selectionEndBeat(current, selectedNotes, bpm || 120);
    applyEdit((list, tempo) => pasteNoteFragment(list, clipboard, target, tempo));
  }, [applyEdit, baseNotes, bpm, clipboard, editedNotes, insertionBeat, selectedNotes]);

  const duplicateSelection = useCallback(() => {
    const current = working();
    const fragment = copyNoteFragment(current, selectedNotes, bpm || 120);
    if (fragment.length === 0) return;
    setClipboard(fragment);
    const target = selectionEndBeat(current, selectedNotes, bpm || 120);
    applyEdit((list, tempo) => pasteNoteFragment(list, fragment, target, tempo));
  }, [applyEdit, baseNotes, bpm, editedNotes, selectedNotes]);

  const selectAll = useCallback(() => {
    const count = working().length;
    const all = Array.from({ length: count }, (_, index) => index);
    setSelectedNotes(all);
    setSelectedNote(all.at(-1) ?? null);
    setInsertionBeatState(null);
  }, [baseNotes, bpm, editedNotes]);

  const clearSelection = useCallback(() => {
    setSelectedNote(null);
    setSelectedNotes([]);
  }, []);

  const selectAdjacent = useCallback((direction: -1 | 1, extend = false) => {
    const count = working().length;
    if (count === 0) return;
    const fallback = direction > 0 ? 0 : count - 1;
    const next = selectedNote === null ? fallback : Math.min(count - 1, Math.max(0, selectedNote + direction));
    if (extend && selectedNote !== null) {
      const start = Math.min(selectedNote, next);
      const end = Math.max(selectedNote, next);
      const additions = Array.from({ length: end - start + 1 }, (_, offset) => start + offset);
      setSelectedNotes((current) => [...new Set([...current, ...additions])].sort((a, b) => a - b));
    } else {
      setSelectedNotes([next]);
    }
    setSelectedNote(next);
    setInsertionBeatState(null);
  }, [baseNotes, bpm, editedNotes, selectedNote]);

  return {
    notes,
    editing: editedNotes !== null,
    selectedNote,
    setSelectedNote: selectNote,
    selectedNotes,
    selectNote: selectWithMode,
    selectAll,
    clearSelection,
    selectAdjacent,
    insertionBeat,
    setInsertionBeat,
    editStep,
    setEditStep,
    canUndo: undoStack.length > 0,
    canRedo: redoStack.length > 0,
    canPaste: clipboard.length > 0,
    applyEdit,
    copySelection,
    pasteSelection,
    duplicateSelection,
    undo,
    redo,
    reset,
    startBlank
  };
}
