import { useCallback, useState } from "react";
import type { NoteEvent } from "../music/types";
import { normalizeNotes, type EditResult } from "./editNotes";

export interface ScoreEdits {
  /** The working copy: the edited notes once anything changed, otherwise the base score. */
  notes: NoteEvent[];
  editing: boolean;
  selectedNote: number | null;
  setSelectedNote: (index: number | null) => void;
  editStep: number;
  setEditStep: (step: number) => void;
  canUndo: boolean;
  canRedo: boolean;
  applyEdit: (operation: (notes: NoteEvent[], bpm: number) => EditResult) => void;
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
  const [undoStack, setUndoStack] = useState<NoteEvent[][]>([]);
  const [redoStack, setRedoStack] = useState<NoteEvent[][]>([]);
  const [selectedNote, setSelectedNote] = useState<number | null>(null);
  const [editStep, setEditStep] = useState(0.5);

  const notes = editedNotes ?? baseNotes;
  const working = () => editedNotes ?? normalizeNotes(baseNotes, bpm || 120);

  const applyEdit = useCallback((operation: (list: NoteEvent[], tempo: number) => EditResult) => {
    const current = editedNotes ?? normalizeNotes(baseNotes, bpm || 120);
    const result = operation(current, bpm || 120);
    if (result.notes === current && result.selected === selectedNote) return;
    setUndoStack((stack) => [...stack.slice(-49), current]);
    setRedoStack([]);
    setEditedNotes(result.notes);
    setSelectedNote(result.selected);
  }, [baseNotes, bpm, editedNotes, selectedNote]);

  const undo = useCallback(() => {
    const previous = undoStack.at(-1);
    if (!previous) return;
    setUndoStack((stack) => stack.slice(0, -1));
    setRedoStack((stack) => [...stack, working()]);
    setEditedNotes(previous);
    setSelectedNote((index) => (index !== null ? Math.min(index, previous.length - 1) : null));
  }, [baseNotes, bpm, editedNotes, undoStack]);

  const redo = useCallback(() => {
    const next = redoStack.at(-1);
    if (!next) return;
    setRedoStack((stack) => stack.slice(0, -1));
    setUndoStack((stack) => [...stack, working()]);
    setEditedNotes(next);
    setSelectedNote((index) => (index !== null ? Math.min(index, next.length - 1) : null));
  }, [baseNotes, bpm, editedNotes, redoStack]);

  const reset = useCallback(() => {
    setEditedNotes(null);
    setUndoStack([]);
    setRedoStack([]);
    setSelectedNote(null);
  }, []);

  const startBlank = useCallback(() => {
    setUndoStack((stack) => [...stack, working()]);
    setRedoStack([]);
    setEditedNotes([]);
    setSelectedNote(null);
  }, [baseNotes, bpm, editedNotes]);

  return {
    notes,
    editing: editedNotes !== null,
    selectedNote,
    setSelectedNote,
    editStep,
    setEditStep,
    canUndo: undoStack.length > 0,
    canRedo: redoStack.length > 0,
    applyEdit,
    undo,
    redo,
    reset,
    startBlank
  };
}
