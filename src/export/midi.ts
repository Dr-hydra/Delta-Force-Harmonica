import { Midi } from "@tonejs/midi";
import type { GameNote, TimeSignatureEvent } from "../music/types";

export interface MidiExportOptions {
  bpm: number;
  timeSignatures?: TimeSignatureEvent[];
}

const DEFAULT_BPM = 120;
const DEFAULT_SIGNATURE: [number, number] = [4, 4];
const MAX_PITCH = 127;

/**
 * Encodes the generated harmonica score as a standard MIDI file. The notes are
 * the converted result — post transpose, already collapsed to one note at a
 * time — so the file plays back exactly what the preview plays, not the
 * imported source. Keys and modifier state are not in the file; the macro
 * exports carry those.
 */
export function toMidiFile(notes: GameNote[], options: MidiExportOptions): Uint8Array {
  const bpm = options.bpm > 0 ? options.bpm : DEFAULT_BPM;
  const midi = new Midi();

  // midi-file writes meta text one byte per code point, so a Chinese title would
  // desync the length prefix. Everything inside the file stays ASCII; the
  // download name carries the song title instead.
  midi.header.name = "Delta Force Harmonica";
  midi.header.setTempo(bpm);
  const signature = options.timeSignatures?.[0];
  midi.header.timeSignatures = [
    { ticks: 0, timeSignature: signature ? [signature.numerator, signature.denominator] : DEFAULT_SIGNATURE }
  ];
  midi.header.update();

  const track = midi.addTrack();
  track.name = "DFH SCORE";

  const ppq = midi.header.ppq;
  const toTicks = (ms: number) => Math.max(0, Math.round((ms / 60000) * bpm * ppq));

  for (const note of notes) {
    const ticks = toTicks(note.start);
    track.addNote({
      midi: Math.max(0, Math.min(MAX_PITCH, Math.round(note.pitch))),
      ticks,
      durationTicks: Math.max(1, toTicks(note.start + note.duration) - ticks),
      velocity: 0.75
    });
  }

  return midi.toArray();
}
