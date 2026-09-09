import { describe, expect, it } from "vitest";
import { extractSmartMelody } from "./smartMelody";
import type { NoteEvent } from "./types";

describe("extractSmartMelody", () => {
  it("keeps a sustained upper melody instead of cutting to short accompaniment", () => {
    const notes: NoteEvent[] = [
      { pitch: 76, start: 0, duration: 780, velocity: 0.86 },
      { pitch: 60, start: 0, duration: 100, velocity: 0.8 },
      { pitch: 67, start: 200, duration: 90, velocity: 0.72 },
      { pitch: 60, start: 400, duration: 90, velocity: 0.72 },
      { pitch: 67, start: 600, duration: 90, velocity: 0.72 },
      { pitch: 77, start: 800, duration: 720, velocity: 0.86 },
      { pitch: 62, start: 800, duration: 110, velocity: 0.78 },
      { pitch: 69, start: 1000, duration: 90, velocity: 0.7 },
      { pitch: 62, start: 1200, duration: 90, velocity: 0.7 }
    ];

    const melody = extractSmartMelody(notes);
    expect(melody.map((note) => note.pitch)).toContain(76);
    expect(melody.map((note) => note.pitch)).toContain(77);
    expect(melody.filter((note) => note.start > 0 && note.start < 780).length).toBe(0);
  });

  it("returns an ordered monophonic path", () => {
    const notes: NoteEvent[] = [
      { pitch: 72, start: 0, duration: 300, velocity: 0.8 },
      { pitch: 60, start: 0, duration: 250, velocity: 0.8 },
      { pitch: 74, start: 320, duration: 300, velocity: 0.8 },
      { pitch: 62, start: 320, duration: 250, velocity: 0.8 },
      { pitch: 76, start: 640, duration: 300, velocity: 0.8 },
      { pitch: 64, start: 640, duration: 250, velocity: 0.8 }
    ];

    const melody = extractSmartMelody(notes);
    expect(melody.length).toBeGreaterThanOrEqual(2);
    for (let index = 1; index < melody.length; index += 1) {
      expect(melody[index].start).toBeGreaterThan(melody[index - 1].start);
      expect(melody[index - 1].start + melody[index - 1].duration).toBeLessThanOrEqual(melody[index].start);
    }
  });
});
