import { describe, expect, it } from "vitest";
import { Midi } from "@tonejs/midi";
import { toMidiFile } from "./midi";
import type { GameNote } from "../music/types";

function note(partial: Partial<GameNote>): GameNote {
  return {
    pitch: 60,
    start: 0,
    duration: 500,
    key: "Z",
    degree: 1,
    keyIndex: 0,
    intrinsicOctave: 0,
    octaveModifier: 0,
    sharp: false,
    ...partial
  } as GameNote;
}

describe("toMidiFile", () => {
  it("round-trips the converted pitches and their timing", () => {
    const bytes = toMidiFile(
      [note({ pitch: 60, start: 0, duration: 500 }), note({ pitch: 67, start: 500, duration: 250 })],
      { bpm: 120 }
    );
    const parsed = new Midi(bytes);
    const written = parsed.tracks[0].notes;

    expect(written.map((item) => item.midi)).toEqual([60, 67]);
    // 120 BPM at 480 ppq: a quarter note is 500 ms, an eighth 250 ms.
    expect(written[0].ticks).toBe(0);
    expect(written[0].durationTicks).toBe(480);
    expect(written[1].ticks).toBe(480);
    expect(written[1].durationTicks).toBe(240);
  });

  it("writes the score tempo and time signature into the header", () => {
    const bytes = toMidiFile([note({})], { bpm: 143, timeSignatures: [{ beat: 0, numerator: 3, denominator: 4 }] });
    const parsed = new Midi(bytes);

    // The tempo meta stores whole microseconds per beat, so 143 BPM comes back
    // as 143.0001 — that is the format's resolution, not a rounding bug.
    expect(parsed.header.tempos[0].bpm).toBeCloseTo(143, 3);
    expect(parsed.header.timeSignatures[0].timeSignature).toEqual([3, 4]);
  });

  it("falls back to 120 BPM and 4/4 when the score has neither", () => {
    const parsed = new Midi(toMidiFile([note({})], { bpm: 0 }));

    expect(parsed.header.tempos[0].bpm).toBe(120);
    expect(parsed.header.timeSignatures[0].timeSignature).toEqual([4, 4]);
  });

  it("keeps every note inside the MIDI pitch range", () => {
    const parsed = new Midi(toMidiFile([note({ pitch: 140 }), note({ pitch: -3, start: 600 })], { bpm: 120 }));

    expect(parsed.tracks[0].notes.map((item) => item.midi)).toEqual([127, 0]);
  });

  it("writes a single note track plus the conductor track", () => {
    const parsed = new Midi(toMidiFile([note({})], { bpm: 120 }));

    expect(parsed.tracks).toHaveLength(1);
    expect(parsed.tracks[0].name).toBe("DFH SCORE");
  });
});
