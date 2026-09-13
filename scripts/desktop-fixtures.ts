/**
 * Writes golden fixtures for the desktop port of the score pipeline.
 *
 *   npm run fixtures:desktop
 *
 * Each JSON file holds a DFHS1 snapshot plus everything the web pipeline derives
 * from it: the decoded snapshot, the monophonic pass, the fingering, the best
 * transpose and the final key sequence. desktop/DFH.Core.Tests replays the same
 * snapshot through the C# port and expects identical output, so the two
 * implementations cannot drift apart silently.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildKeySequence, targetId } from "../src/export/keySequence";
import { toMidiFile } from "../src/export/midi";
import { findBestTranspose, optimizeHarmonica } from "../src/harmonica/optimizer";
import { enforceMonophonic } from "../src/music/monophonic";
import type { NoteEvent } from "../src/music/types";
import {
  bytesToBase64Url,
  decodeScoreSnapshot,
  encodeScoreSnapshot,
  type ScoreSnapshotInput
} from "../src/persistence/scoreCodec";

const outDir = join(dirname(fileURLToPath(import.meta.url)), "..", "desktop", "DFH.Core.Tests", "Fixtures");

interface Case {
  name: string;
  snapshot: ScoreSnapshotInput;
}

/** Deterministic LCG so the random fixture is stable across runs. */
function rng(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

function ms(beat: number, bpm: number) {
  return Math.round(beat * 60000 / bpm);
}

function scale(): Case {
  const notes = [60, 62, 64, 65, 67, 69, 71, 72, 71, 69, 67, 65, 64, 62, 60].map((pitch, index) => ({
    pitch, start: index * 420, duration: 330, beat: index, durationBeats: 0.78
  }));
  return { name: "scale", snapshot: { ppq: 480, transpose: 0, tempos: [{ beat: 0, time: 0, bpm: 143 }], measureStarts: [0, 4, 8, 12], notes } };
}

function modifiers(): Case {
  // Every playable pitch from the lowest octave to the highest, then a chromatic
  // run: forces octave and sharp modifiers to be held, switched and combined.
  const pitches: number[] = [];
  for (let pitch = 48; pitch <= 85; pitch += 1) pitches.push(pitch);
  for (let pitch = 84; pitch >= 50; pitch -= 3) pitches.push(pitch);
  pitches.push(47, 86, 90, 40, 60); // out of range mixed in
  const bpm = 100;
  const notes = pitches.map((pitch, index) => ({ pitch, start: ms(index / 2, bpm), duration: ms(0.5, bpm), beat: index / 2, durationBeats: 0.5 }));
  return { name: "modifiers", snapshot: { ppq: 960, transpose: 0, tempos: [{ beat: 0, time: 0, bpm }], timeSignatures: [{ beat: 0, numerator: 2, denominator: 4 }], notes } };
}

function chords(): Case {
  const bpm = 120;
  const notes: NoteEvent[] = [
    // Chord: highest survives.
    { pitch: 60, start: 0, duration: 1000, beat: 0, durationBeats: 2 },
    { pitch: 64, start: 0, duration: 1000, beat: 0, durationBeats: 2 },
    { pitch: 67, start: 20, duration: 1000, beat: 0.04, durationBeats: 2 },
    // Same pitch, the longer one wins.
    { pitch: 72, start: 1000, duration: 200, beat: 2, durationBeats: 0.4 },
    { pitch: 72, start: 1010, duration: 600, beat: 2.02, durationBeats: 1.2 },
    // Overlap that gets truncated at the next onset.
    { pitch: 65, start: 1400, duration: 900, beat: 2.8, durationBeats: 1.8 },
    { pitch: 69, start: 1800, duration: 300, beat: 3.6, durationBeats: 0.6 },
    // Very short note: min hold must kick in.
    { pitch: 71, start: 2200, duration: 8, beat: 4.4, durationBeats: 0.016 },
    { pitch: 74, start: 2215, duration: 400, beat: 4.43, durationBeats: 0.8 },
    // Trailing rest then a single low note needing the octave modifier.
    { pitch: 55, start: 4000, duration: 500, beat: 8, durationBeats: 1 }
  ];
  return { name: "chords", snapshot: { ppq: 480, transpose: 0, tempos: [{ beat: 0, time: 0, bpm }], notes } };
}

function tempoMap(): Case {
  const tempos = [
    { beat: 0, time: 0, bpm: 90 },
    { beat: 6, time: 4000, bpm: 150 },
    { beat: 12, time: 6400, bpm: 72.5 }
  ];
  const notes: NoteEvent[] = [];
  const pattern = [67, 69, 71, 72, 74, 76, 78, 79, 81, 76, 72, 69];
  for (let index = 0; index < 36; index += 1) {
    notes.push({
      pitch: pattern[index % pattern.length] - (index >= 24 ? 12 : 0),
      start: 0,
      duration: 0,
      beat: index * 0.75,
      durationBeats: index % 4 === 3 ? 0.375 : 0.75
    });
  }
  return {
    name: "tempo-map",
    snapshot: {
      ppq: 384,
      transpose: -3,
      tempos,
      timeSignatures: [{ beat: 0, numerator: 3, denominator: 4 }, { beat: 12, numerator: 6, denominator: 8 }],
      measureStarts: [0, 3, 6, 9, 12, 15, 18, 21, 24, 27],
      notes
    }
  };
}

function random(): Case {
  const next = rng(20260913);
  const bpm = 128;
  const notes: NoteEvent[] = [];
  let beat = 0;
  for (let index = 0; index < 400; index += 1) {
    const pitch = 45 + Math.floor(next() * 45);
    const durationBeats = [0.25, 0.5, 0.5, 0.75, 1, 1.5][Math.floor(next() * 6)];
    notes.push({ pitch, start: ms(beat, bpm), duration: ms(durationBeats * (0.6 + next() * 0.8), bpm), beat, durationBeats });
    if (next() < 0.08) {
      // A chord tone on the same onset.
      notes.push({ pitch: pitch - 3 - Math.floor(next() * 9), start: ms(beat, bpm), duration: ms(durationBeats, bpm), beat, durationBeats });
    }
    beat += [0.25, 0.5, 0.5, 1][Math.floor(next() * 4)];
  }
  return { name: "random", snapshot: { ppq: 480, transpose: 5, tempos: [{ beat: 0, time: 0, bpm }], notes } };
}

function plainNote(note: NoteEvent) {
  return { pitch: note.pitch, start: note.start, duration: note.duration, beat: note.beat, durationBeats: note.durationBeats };
}

function build(entry: Case) {
  const bytes = encodeScoreSnapshot(entry.snapshot);
  const decoded = decodeScoreSnapshot(bytes);
  const mono = enforceMonophonic(decoded.notes);
  const conversion = optimizeHarmonica(mono.notes, decoded.transpose);
  const best = findBestTranspose(mono.notes);
  const sequence = buildKeySequence(conversion.notes);
  const bpm = decoded.tempos[0]?.bpm ?? 120;
  const midi = toMidiFile(conversion.notes, { bpm, timeSignatures: decoded.timeSignatures, snapshot: entry.snapshot });

  return {
    name: entry.name,
    snapshotBase64Url: bytesToBase64Url(bytes),
    midiBase64: Buffer.from(midi).toString("base64"),
    decoded: {
      ppq: decoded.ppq,
      transpose: decoded.transpose,
      tempos: decoded.tempos,
      timeSignatures: decoded.timeSignatures,
      measureStarts: decoded.measureStarts,
      notes: decoded.notes.map(plainNote)
    },
    mono: {
      notes: mono.notes.map(plainNote),
      sourceIndices: mono.sourceIndices,
      collapsedChordNotes: mono.collapsedChordNotes,
      truncatedNotes: mono.truncatedNotes
    },
    conversion: {
      notes: conversion.notes.map((note) => ({
        pitch: note.pitch,
        start: note.start,
        duration: note.duration,
        key: note.key,
        degree: note.degree,
        octaveModifier: note.octaveModifier,
        sharp: note.sharp,
        sourceIndex: note.sourceIndex
      })),
      unplayableCount: conversion.unplayable.length,
      cost: conversion.cost,
      modifierChanges: conversion.modifierChanges
    },
    bestTranspose: best.transpose,
    keySequence: {
      actions: sequence.actions.map((action) => ({ time: action.time, target: targetId(action.target), down: action.down })),
      durationMs: sequence.durationMs,
      noteCount: sequence.noteCount,
      droppedChordNotes: sequence.droppedChordNotes,
      truncatedNotes: sequence.truncatedNotes,
      modifierPresses: sequence.modifierPresses
    }
  };
}

mkdirSync(outDir, { recursive: true });
for (const entry of [scale(), modifiers(), chords(), tempoMap(), random()]) {
  const fixture = build(entry);
  writeFileSync(join(outDir, `${entry.name}.json`), JSON.stringify(fixture, null, 1) + "\n");
  console.log(`${entry.name}: ${fixture.conversion.notes.length} notes, ${fixture.keySequence.actions.length} actions, best transpose ${fixture.bestTranspose}`);
}
