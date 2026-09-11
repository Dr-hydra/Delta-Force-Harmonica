import { describe, expect, it } from "vitest";
import { candidatesForPitch, modifierLabel } from "./mapping";

function labelFor(pitch: number, match: Partial<{ sharp: boolean; octaveModifier: number }>) {
  const candidate = candidatesForPitch(pitch).find(
    (item) => item.sharp === match.sharp && item.octaveModifier === match.octaveModifier
  );
  if (!candidate) throw new Error(`no candidate for ${pitch}`);
  return modifierLabel(candidate);
}

describe("modifierLabel", () => {
  it("is empty when the plain key already sounds the pitch", () => {
    expect(labelFor(60, { sharp: false, octaveModifier: 0 })).toBe("");
  });

  it("marks the octave modifiers with the arrows the keycaps print", () => {
    expect(labelFor(72, { sharp: false, octaveModifier: 1 })).toBe("↑");
    expect(labelFor(48, { sharp: false, octaveModifier: -1 })).toBe("↓");
  });

  it("marks the semitone modifier separately", () => {
    expect(labelFor(61, { sharp: true, octaveModifier: 0 })).toBe("#");
  });

  it("keeps both modifiers when a note needs them at once", () => {
    expect(labelFor(73, { sharp: true, octaveModifier: 1 })).toBe("↑#");
  });
});
