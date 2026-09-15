import { describe, expect, it } from "vitest";
import { extractSmartMelody } from "./smartMelody";
import type { NoteEvent } from "./types";

describe("extractSmartMelody", () => {
  it("follows an inner melody through short high ornaments instead of taking the skyline", () => {
    const notes = [0, 500, 1000, 1500].flatMap((start, i) => [
      { pitch: 67 + i, start, duration: 480, velocity: 0.9 },
      { pitch: 88 - i, start, duration: 65, velocity: 0.35 },
      { pitch: 48, start, duration: 160, velocity: 0.5 }
    ]);
    expect(extractSmartMelody(notes).map((note) => note.pitch)).toEqual([67, 68, 69, 70]);
  });

  it("tracks a long hold across hundreds of accompaniment onsets", () => {
    const notes: NoteEvent[] = [
      { pitch: 76, start: 0, duration: 20000, velocity: 0.9 },
      ...Array.from({ length: 200 }, (_, i) => ({ pitch: 48 + i % 5, start: i * 100, duration: 55, velocity: 0.4 })),
      { pitch: 77, start: 20000, duration: 600, velocity: 0.9 }
    ];
    expect(extractSmartMelody(notes).map((note) => note.pitch)).toEqual([76, 77]);
  });

  it("does not let unison doublings change the extracted voice", () => {
    const notes = [0, 500, 1000].flatMap((start, i) => [
      { pitch: 72 + i, start, duration: 480, velocity: 0.8 },
      { pitch: 48, start, duration: 200, velocity: 0.6 }
    ]);
    const doubled = notes.flatMap((note) => note.pitch === 48 ? Array(20).fill(note) : [note]);
    expect(extractSmartMelody(doubled)).toEqual(extractSmartMelody(notes));
  });

  it("is invariant to leading silence and input order", () => {
    const notes = [0, 500, 1000].flatMap((start, i) => [
      { pitch: 72 + i, start, duration: 480 },
      { pitch: 48, start, duration: 200 }
    ]);
    const shifted = notes.map((note) => ({ ...note, start: note.start + 12000 })).reverse();
    expect(extractSmartMelody(shifted).map((note) => ({ ...note, start: note.start - 12000 })))
      .toEqual(extractSmartMelody(notes));
  });

  it("preserves repeated attacks, fast runs, rests and octave jumps in a solo line", () => {
    const notes: NoteEvent[] = [
      { pitch: 60, start: 0, duration: 100 },
      { pitch: 60, start: 100, duration: 100 },
      { pitch: 72, start: 200, duration: 70 },
      { pitch: 74, start: 280, duration: 70 },
      { pitch: 48, start: 1200, duration: 200 }
    ];
    expect(extractSmartMelody(notes)).toEqual(notes);
  });

  it("trims MIDI legato while keeping repeated attacks and beat duration consistent", () => {
    const notes: NoteEvent[] = [
      { pitch: 60, start: 0, duration: 520, beat: 0, durationBeats: 1.04 },
      { pitch: 60, start: 500, duration: 500, beat: 1, durationBeats: 1 }
    ];
    const result = extractSmartMelody(notes);
    expect(result).toHaveLength(2);
    expect(result[0]).toMatchObject({ duration: 500, durationBeats: 1 });
    expect(notes[0].duration).toBe(520);
  });

  it("keeps independent phrases after a rest even when one is weak and short", () => {
    const notes: NoteEvent[] = [
      { pitch: 76, start: 0, duration: 300, velocity: 1 },
      { pitch: 60, start: 0, duration: 300, velocity: 0.8 },
      { pitch: 52, start: 1400, duration: 80, velocity: 0.3 },
      { pitch: 40, start: 1400, duration: 80, velocity: 0.2 }
    ];
    expect(extractSmartMelody(notes).map((note) => note.start)).toEqual([0, 1400]);
  });

  it("keeps repeated notes in a polyphonic passage without merging the rhythm", () => {
    const notes = [0, 400, 800].flatMap((start) => [
      { pitch: 76, start, duration: 400, velocity: 0.9 },
      { pitch: 48, start, duration: 180, velocity: 0.5 }
    ]);
    expect(extractSmartMelody(notes).map(({ pitch, start }) => ({ pitch, start })))
      .toEqual([0, 400, 800].map((start) => ({ pitch: 76, start })));
  });

  it("selects the same voice when the same arrangement is played at a different tempo", () => {
    const notes = [0, 400, 800].flatMap((start, i) => [
      { pitch: 72 + i * 2, start, duration: 380, velocity: 0.85 },
      { pitch: 48 + i, start, duration: 120, velocity: 0.5 },
      { pitch: 55 + i, start: start + 200, duration: 80, velocity: 0.5 }
    ]);
    const faster = notes.map((note) => ({ ...note, start: note.start / 2, duration: note.duration / 2 }));
    expect(extractSmartMelody(faster, { bpm: 240 }).map((note) => note.pitch))
      .toEqual(extractSmartMelody(notes, { bpm: 120 }).map((note) => note.pitch));
  });

  it("ignores invalid events even for a single-note input", () => {
    expect(extractSmartMelody([{ pitch: 60, start: 0, duration: -1 }])).toEqual([]);
    expect(extractSmartMelody([{ pitch: NaN, start: 0, duration: 100 }])).toEqual([]);
    expect(extractSmartMelody([])).toEqual([]);
  });

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
