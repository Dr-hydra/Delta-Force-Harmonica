import { describe, expect, it } from "vitest";
import { decodeScoreSnapshot, encodeScoreSnapshot, scoreSnapshotSummary } from "./scoreCodec";

const notes = [
  { pitch: 60, start: 0, duration: 500, beat: 0, durationBeats: 1 },
  { pitch: 64, start: 500, duration: 500, beat: 1, durationBeats: 1 },
  { pitch: 67, start: 1000, duration: 250, beat: 2, durationBeats: 0.5 }
];

describe("DFHS score codec", () => {
  it("round-trips the authoritative tick timeline", () => {
    const bytes = encodeScoreSnapshot({
      ppq: 480,
      transpose: -2,
      tempos: [
        { beat: 0, time: 0, bpm: 120 },
        { beat: 2, time: 1000, bpm: 90 }
      ],
      timeSignatures: [{ beat: 0, numerator: 4, denominator: 4 }],
      measureStarts: [0, 4],
      notes
    });
    const decoded = decodeScoreSnapshot(bytes);
    expect(decoded.ppq).toBe(480);
    expect(decoded.transpose).toBe(-2);
    expect(decoded.notes.map((note) => [note.pitch, note.beat, note.durationBeats])).toEqual([
      [60, 0, 1],
      [64, 1, 1],
      [67, 2, 0.5]
    ]);
    expect(decoded.tempos.map((tempo) => [tempo.beat, tempo.bpm])).toEqual([[0, 120], [2, 90]]);
  });

  it("drops derived fields and compresses a repetitive score", () => {
    const long = Array.from({ length: 1000 }, (_, index) => ({
      pitch: 60 + (index % 8),
      start: index * 250,
      duration: 200,
      beat: index / 2,
      durationBeats: 0.4,
      velocity: 0.75,
      name: "C4"
    }));
    const bytes = encodeScoreSnapshot({ ppq: 480, notes: long });
    expect(bytes.byteLength).toBeLessThan(10_000);
    const summary = scoreSnapshotSummary(decodeScoreSnapshot(bytes));
    expect(summary.noteCount).toBe(1000);
    expect(summary.durationMs).toBeGreaterThan(200_000);
  });
});
