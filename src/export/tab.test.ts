import { describe, expect, it } from "vitest";
import { toTabText } from "./tab";
import type { GameNote } from "../music/types";

function note(partial: Partial<GameNote>): GameNote {
  return {
    pitch: 60, start: 0, duration: 400, beat: 0, durationBeats: 1,
    key: "Z", degree: 1, keyIndex: 0, intrinsicOctave: 0, octaveModifier: 0, sharp: false,
    ...partial
  } as GameNote;
}

const options = {
  songName: "T",
  bpm: 120,
  timeSignatures: [{ beat: 0, numerator: 4, denominator: 4 }],
  measureStarts: [0]
};

describe("toTabText", () => {
  it("reads the upper 1 as 1' but needs no octave key", () => {
    const text = toTabText([note({ pitch: 72, beat: 0, key: ",", degree: 1, keyIndex: 7, intrinsicOctave: 1 })], options);
    const degrees = text.split("\n").find((line) => line.startsWith("  简谱"))!;
    const keys = text.split("\n").find((line) => line.startsWith("  键位"))!;
    expect(degrees).toContain("1'");
    expect(keys).toContain(",");
    expect(keys).not.toContain(",+");
  });

  it("marks a held octave key on the key line", () => {
    const text = toTabText([note({ pitch: 48, octaveModifier: -1 })], options);
    const keys = text.split("\n").find((line) => line.startsWith("  键位"))!;
    expect(keys).toContain("Z-");
  });

  it("marks semitones on both lines", () => {
    const text = toTabText([note({ pitch: 61, sharp: true })], options);
    expect(text.split("\n").find((line) => line.startsWith("  简谱"))!).toContain("#1");
    expect(text.split("\n").find((line) => line.startsWith("  键位"))!).toContain("Z#");
  });
});
