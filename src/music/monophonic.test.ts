import { describe, expect, it } from "vitest";
import type { NoteEvent } from "./types";
import { CHORD_WINDOW_MS, enforceMonophonic } from "./monophonic";

function note(pitch: number, start: number, duration: number, beat?: number, durationBeats?: number): NoteEvent {
  return { pitch, start, duration, beat, durationBeats };
}

describe("monophonic enforcement", () => {
  it("leaves an already monophonic line untouched", () => {
    const input = [note(60, 0, 400), note(62, 500, 400), note(64, 1000, 400)];
    const result = enforceMonophonic(input);
    expect(result.notes).toEqual(input);
    expect(result.collapsedChordNotes).toBe(0);
    expect(result.truncatedNotes).toBe(0);
    expect(result.sourceIndices).toEqual([0, 1, 2]);
  });

  it("keeps the top note of a chord", () => {
    const result = enforceMonophonic([note(60, 0, 400), note(64, 0, 400), note(67, 0, 400)]);
    expect(result.notes.map((item) => item.pitch)).toEqual([67]);
    expect(result.collapsedChordNotes).toBe(2);
  });

  it("treats sloppy onsets inside the chord window as simultaneous", () => {
    const result = enforceMonophonic([note(60, 0, 400), note(67, CHORD_WINDOW_MS, 400)]);
    expect(result.notes.map((item) => item.pitch)).toEqual([67]);
    expect(result.collapsedChordNotes).toBe(1);
  });

  it("treats onsets past the chord window as separate notes", () => {
    const result = enforceMonophonic([note(60, 0, 400), note(67, CHORD_WINDOW_MS + 1, 400)]);
    expect(result.notes.map((item) => item.pitch)).toEqual([60, 67]);
    expect(result.collapsedChordNotes).toBe(0);
  });

  it("cuts a ringing note at the next onset instead of moving it", () => {
    const result = enforceMonophonic([note(60, 0, 1000), note(62, 400, 300)]);
    expect(result.notes[0].start).toBe(0);
    expect(result.notes[0].duration).toBe(400);
    expect(result.notes[1]).toEqual(note(62, 400, 300));
    expect(result.truncatedNotes).toBe(1);
  });

  it("keeps beat length in step when it truncates", () => {
    const result = enforceMonophonic([note(60, 0, 1000, 0, 2), note(62, 500, 500, 1, 1)]);
    expect(result.notes[0].durationBeats).toBe(1);
  });

  it("derives beat length proportionally when the next note has no beat", () => {
    const result = enforceMonophonic([note(60, 0, 1000, 0, 2), note(62, 500, 500)]);
    expect(result.notes[0].durationBeats).toBeCloseTo(1, 6);
  });

  it("reports where each surviving note came from", () => {
    // Index 0 is the low chord tone, index 1 the top one that survives.
    const result = enforceMonophonic([note(60, 0, 400), note(67, 0, 400), note(62, 500, 400)]);
    expect(result.sourceIndices).toEqual([1, 2]);
  });

  it("truncation never leaves a note shorter than the chord window", () => {
    const result = enforceMonophonic([note(60, 0, 5000), note(62, 46, 400), note(64, 200, 400)]);
    for (const item of result.notes) expect(item.duration).toBeGreaterThan(CHORD_WINDOW_MS);
  });

  it("drops notes with non-finite fields", () => {
    const result = enforceMonophonic([note(60, 0, 400), note(Number.NaN, 500, 400)]);
    expect(result.notes).toHaveLength(1);
  });

  it("handles an empty list", () => {
    expect(enforceMonophonic([])).toEqual({
      notes: [],
      sourceIndices: [],
      collapsedChordNotes: 0,
      truncatedNotes: 0
    });
  });
});
