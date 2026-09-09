import { describe, expect, it } from "vitest";
import { candidatesForPitch } from "./mapping";
import { optimizeHarmonica } from "./optimizer";

const note = (pitch: number, start: number) => ({ pitch, start, duration: 300 });

describe("harmonica mapping", () => {
  it("keeps duplicate enharmonic input paths", () => {
    const f4 = candidatesForPitch(65);
    expect(f4.some((candidate) => candidate.key === "V" && !candidate.sharp)).toBe(true);
    expect(f4.some((candidate) => candidate.key === "C" && candidate.sharp)).toBe(true);
  });

  it("prefers plain diatonic keys for a C-major scale", () => {
    const result = optimizeHarmonica([
      note(60, 0), note(62, 400), note(64, 800), note(65, 1200),
      note(67, 1600), note(69, 2000), note(71, 2400), note(72, 2800)
    ]);

    expect(result.unplayable).toHaveLength(0);
    expect(result.notes.map((item) => item.key)).toEqual(["Z", "X", "C", "V", "B", "N", "M", ","]);
    expect(result.notes.every((item) => !item.sharp)).toBe(true);
  });
});
