import { describe, expect, it } from "vitest";
import { cleanAudioNotes } from "./cleanNotes";
import type { NoteEvent } from "../music/types";

describe("cleanAudioNotes", () => {
  it("merges nearby fragments of the same pitch", () => {
    const notes: NoteEvent[] = [
      { pitch: 60, start: 0, duration: 120, velocity: 0.9 },
      { pitch: 60, start: 150, duration: 120, velocity: 0.85 },
      { pitch: 67, start: 420, duration: 200, velocity: 0.9 }
    ];

    const result = cleanAudioNotes(notes, "solo");
    const c4 = result.notes.filter((note) => note.pitch === 60);
    expect(c4).toHaveLength(1);
    expect(c4[0].duration).toBeGreaterThanOrEqual(270);
    expect(result.stats.mergedFragments).toBe(1);
  });

  it("caps dense full-mix onset groups", () => {
    const notes: NoteEvent[] = [60, 62, 64, 65, 67, 69, 71]
      .map((pitch) => ({ pitch, start: 1000, duration: 240, velocity: 0.9 }));

    const result = cleanAudioNotes(notes, "mix");
    expect(result.notes.length).toBeLessThanOrEqual(4);
    expect(result.stats.removedDensity).toBeGreaterThan(0);
  });
});
