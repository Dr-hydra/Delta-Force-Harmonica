import { describe, expect, it } from "vitest";
import { assignBeats, beatAtTime, measureStarts, quantizeToGrid, timeAtBeat, type BeatGrid } from "./beats";
import type { NoteEvent } from "../music/types";

/** 100 BPM, first beat at 0.1 s, eight beats. */
function grid(interval = 0.6, first = 0.1, count = 8): BeatGrid {
  const detected = Array.from({ length: count }, (_, i) => first + i * interval);
  const head: number[] = [];
  for (let t = detected[0] - interval; t > -interval; t -= interval) head.unshift(t);
  return {
    bpm: 60 / interval,
    beats: [...head, ...detected],
    medianInterval: interval,
    detectedCount: count,
    attempt: 0
  };
}

describe("beatAtTime / timeAtBeat", () => {
  it("round-trips a time through the beat axis", () => {
    const g = grid();
    for (const seconds of [0, 0.35, 1.2, 2.9, 4.4]) {
      expect(timeAtBeat(g, beatAtTime(g, seconds))).toBeCloseTo(seconds, 6);
    }
  });

  it("puts consecutive detected beats one beat apart", () => {
    const g = grid();
    const first = beatAtTime(g, 0.1);
    const second = beatAtTime(g, 0.7);
    expect(second - first).toBeCloseTo(1, 6);
  });

  it("follows a drifting grid instead of one constant tempo", () => {
    const drifting: BeatGrid = {
      bpm: 100,
      beats: [0, 0.6, 1.1, 1.5],
      medianInterval: 0.55,
      detectedCount: 4,
      attempt: 0
    };
    // second interval is 0.5 s, so its midpoint is half a beat in
    expect(beatAtTime(drifting, 0.85)).toBeCloseTo(1.5, 6);
  });

  it("extrapolates before the first beat without going negative in assignBeats", () => {
    const g = grid();
    const notes: NoteEvent[] = [{ pitch: 60, start: 0, duration: 200 }];
    expect(assignBeats(notes, g)[0].beat).toBeGreaterThanOrEqual(0);
  });
});

describe("quantizeToGrid", () => {
  it("snaps onsets to the requested subdivision", () => {
    const g = grid();
    // 0.72 s is 0.033 s past the second detected beat
    const notes: NoteEvent[] = [{ pitch: 60, start: 733, duration: 560 }];
    const [snapped] = quantizeToGrid(notes, g, 2);
    expect(snapped.beat! % 0.5).toBeCloseTo(0, 6);
    expect(snapped.durationBeats! % 0.5).toBeCloseTo(0, 6);
    expect(snapped.start).toBeCloseTo(700, 0);
  });

  it("keeps a short note as one cell rather than dropping it", () => {
    const g = grid();
    const notes: NoteEvent[] = [{ pitch: 60, start: 700, duration: 200 }];
    const [snapped] = quantizeToGrid(notes, g, 2);
    expect(snapped.durationBeats).toBeCloseTo(0.5, 6);
    expect(snapped.duration).toBeGreaterThan(0);
  });

  it("drops a note shorter than half a cell", () => {
    const g = grid();
    const notes: NoteEvent[] = [{ pitch: 60, start: 700, duration: 40 }];
    expect(quantizeToGrid(notes, g, 2)).toHaveLength(0);
  });

  it("is a no-op when subdivisions is zero", () => {
    const g = grid();
    const notes: NoteEvent[] = [{ pitch: 60, start: 733, duration: 560 }];
    expect(quantizeToGrid(notes, g, 0)).toBe(notes);
  });

  it("never emits a negative start", () => {
    const g = grid();
    const notes: NoteEvent[] = [{ pitch: 60, start: 0, duration: 300 }];
    for (const note of quantizeToGrid(notes, g, 4)) {
      expect(note.start).toBeGreaterThanOrEqual(0);
      expect(note.beat).toBeGreaterThanOrEqual(0);
    }
  });
});

describe("measureStarts", () => {
  it("spaces starts by the bar length and covers the grid", () => {
    const g = grid(0.6, 0.1, 9);
    const starts = measureStarts(g, 4);
    expect(starts[0]).toBe(0);
    expect(starts[1]).toBe(4);
    expect(starts.at(-1)).toBeLessThanOrEqual(g.beats.length - 1);
  });

  it("returns nothing for a non-positive bar length", () => {
    expect(measureStarts(grid(), 0)).toEqual([]);
  });
});
