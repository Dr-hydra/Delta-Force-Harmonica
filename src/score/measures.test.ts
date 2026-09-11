import { describe, expect, it } from "vitest";
import type { GameNote } from "../music/types";
import { buildScoreMeasures, durationLabel } from "./measures";

function gameNote(beat: number, durationBeats = 1): GameNote {
  return {
    pitch: 60,
    start: beat * 500,
    duration: durationBeats * 500,
    beat,
    durationBeats,
    sourceIndex: 0,
    key: "Z",
    degree: 1,
    keyIndex: 0,
    intrinsicOctave: 0,
    octaveModifier: 0,
    sharp: false
  };
}

describe("score measure layout", () => {
  it("splits a 3/4 score on bar boundaries", () => {
    const measures = buildScoreMeasures(
      [gameNote(0), gameNote(2), gameNote(3), gameNote(5)],
      [{ beat: 0, numerator: 3, denominator: 4 }],
      120
    );
    expect(measures).toHaveLength(2);
    expect(measures[0].notes.map((item) => item.beat)).toEqual([0, 2]);
    expect(measures[1].notes.map((item) => item.beat)).toEqual([3, 5]);
  });

  it("preserves an explicit pickup measure", () => {
    const measures = buildScoreMeasures(
      [gameNote(0, 1), gameNote(1), gameNote(4)],
      [{ beat: 0, numerator: 4, denominator: 4 }],
      120,
      [0, 1]
    );
    expect(measures[0].lengthBeats).toBe(1);
    expect(measures[1].startBeat).toBe(1);
  });

  it("labels common note values", () => {
    expect(durationLabel(1)).toBe("4");
    expect(durationLabel(0.5)).toBe("8");
    expect(durationLabel(1.5)).toBe("4·");
    expect(durationLabel(3)).toBe("2·");
  });
});
