import { describe, expect, it } from "vitest";
import {
  clearLongSilences,
  deleteNote,
  insertNote,
  MAX_PITCH,
  MIN_PITCH,
  moveNote,
  normalizeNotes,
  resizeNote,
  snapAll,
  transposeNote
} from "./editNotes";
import type { NoteEvent } from "../music/types";

const BPM = 120; // 500 ms per beat

function notes(): NoteEvent[] {
  return normalizeNotes([
    { pitch: 60, start: 0, duration: 500, beat: 0, durationBeats: 1 },
    { pitch: 64, start: 500, duration: 500, beat: 1, durationBeats: 1 },
    { pitch: 67, start: 1000, duration: 1000, beat: 2, durationBeats: 2 }
  ], BPM);
}

describe("normalizeNotes", () => {
  it("derives beats from milliseconds when they are missing", () => {
    const [note] = normalizeNotes([{ pitch: 60, start: 750, duration: 250 }], BPM);
    expect(note.beat).toBeCloseTo(1.5, 6);
    expect(note.durationBeats).toBeCloseTo(0.5, 6);
  });

  it("derives milliseconds from beats", () => {
    const [note] = normalizeNotes([{ pitch: 60, start: 0, duration: 0, beat: 3, durationBeats: 0.5 }], BPM);
    expect(note.start).toBe(1500);
    expect(note.duration).toBe(250);
  });
});

describe("transposeNote", () => {
  it("shifts pitch and keeps timing", () => {
    const result = transposeNote(notes(), 1, 2, BPM);
    expect(result.notes[1].pitch).toBe(66);
    expect(result.notes[1].beat).toBeCloseTo(1, 6);
    expect(result.selected).toBe(1);
  });

  it("clamps at the MIDI range and leaves the array alone", () => {
    const source = normalizeNotes([{ pitch: MAX_PITCH, start: 0, duration: 500 }], BPM);
    const up = transposeNote(source, 0, 5, BPM);
    expect(up.notes).toBe(source);
    const low = normalizeNotes([{ pitch: MIN_PITCH, start: 0, duration: 500 }], BPM);
    expect(transposeNote(low, 0, -5, BPM).notes).toBe(low);
  });

  it("reports the new index when a chord re-sorts", () => {
    const source = normalizeNotes([
      { pitch: 60, start: 0, duration: 500, beat: 0, durationBeats: 1 },
      { pitch: 72, start: 0, duration: 500, beat: 0, durationBeats: 1 }
    ], BPM);
    // sorted high pitch first, so raising the lower note past 72 swaps them
    const result = transposeNote(source, 1, 24, BPM);
    expect(result.notes[0].pitch).toBe(84);
    expect(result.selected).toBe(0);
  });
});

describe("moveNote", () => {
  it("shifts the onset and follows the note through re-sorting", () => {
    const result = moveNote(notes(), 0, 2.5, BPM);
    expect(result.notes.map((n) => n.pitch)).toEqual([64, 67, 60]);
    expect(result.selected).toBe(2);
    expect(result.notes[2].start).toBe(1250);
  });

  it("never moves a note before the start of the score", () => {
    const result = moveNote(notes(), 0, -5, BPM);
    expect(result.notes[0].beat).toBe(0);
    expect(result.notes[0].start).toBe(0);
  });
});

describe("resizeNote", () => {
  it("changes length without moving the onset", () => {
    const result = resizeNote(notes(), 1, 1, BPM);
    expect(result.notes[1].durationBeats).toBeCloseTo(2, 6);
    expect(result.notes[1].beat).toBeCloseTo(1, 6);
    expect(result.notes[1].duration).toBe(1000);
  });

  it("keeps a positive length when shrunk past zero", () => {
    const result = resizeNote(notes(), 1, -10, BPM);
    expect(result.notes[1].durationBeats).toBeGreaterThan(0);
    expect(result.notes[1].duration).toBeGreaterThan(0);
  });
});

describe("deleteNote", () => {
  it("removes the note and keeps a valid selection", () => {
    const result = deleteNote(notes(), 2, BPM);
    expect(result.notes).toHaveLength(2);
    expect(result.selected).toBe(1);
  });

  it("clears the selection when the score becomes empty", () => {
    const single = normalizeNotes([{ pitch: 60, start: 0, duration: 500 }], BPM);
    const result = deleteNote(single, 0, BPM);
    expect(result.notes).toHaveLength(0);
    expect(result.selected).toBeNull();
  });
});

describe("insertNote", () => {
  it("starts an empty score at beat zero", () => {
    const result = insertNote([], null, 0.5, BPM);
    expect(result.notes).toHaveLength(1);
    expect(result.notes[0].beat).toBe(0);
    expect(result.notes[0].durationBeats).toBeCloseTo(0.5, 6);
    expect(result.selected).toBe(0);
  });

  it("places the new note after the selected one", () => {
    const result = insertNote(notes(), 1, 0.5, BPM);
    expect(result.notes).toHaveLength(4);
    const inserted = result.notes[result.selected!];
    expect(inserted.beat).toBeCloseTo(2, 6);
    expect(inserted.pitch).toBe(64);
  });

  it("clears the anchor's length so it does not inherit a long note", () => {
    const result = insertNote(notes(), 2, 0.25, BPM);
    expect(result.notes[result.selected!].durationBeats).toBeCloseTo(0.25, 6);
  });
});

describe("snapAll", () => {
  it("rounds onsets and lengths onto the step", () => {
    const source = normalizeNotes([
      { pitch: 60, start: 130, duration: 260 },
      { pitch: 64, start: 640, duration: 520 }
    ], BPM);
    const snapped = snapAll(source, 0.5, BPM);
    for (const note of snapped) {
      expect((note.beat! / 0.5) % 1).toBeCloseTo(0, 6);
      expect((note.durationBeats! / 0.5) % 1).toBeCloseTo(0, 6);
    }
  });

  it("never snaps a length down to zero", () => {
    const source = normalizeNotes([{ pitch: 60, start: 0, duration: 20 }], BPM);
    expect(snapAll(source, 1, BPM)[0].durationBeats).toBeGreaterThanOrEqual(1);
  });
});

describe("clearLongSilences", () => {
  it("removes leading and internal silence at the threshold while preserving short rests", () => {
    const source = normalizeNotes([
      { pitch: 60, start: 5000, duration: 500 },
      { pitch: 62, start: 6000, duration: 500 },
      { pitch: 64, start: 11500, duration: 500 }
    ], BPM);

    const result = clearLongSilences(source, 5, BPM, 2);

    expect(result.notes.map((note) => note.start)).toEqual([0, 1000, 1500]);
    expect(result.notes.map((note) => note.duration)).toEqual([500, 500, 500]);
    expect(result.selected).toBe(2);
  });

  it("returns the original score when no silence reaches the threshold", () => {
    const source = notes();
    expect(clearLongSilences(source, 5, BPM, 1)).toEqual({ notes: source, selected: 1 });
  });
});
