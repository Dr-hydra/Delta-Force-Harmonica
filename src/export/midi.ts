import { Midi } from "@tonejs/midi";
import type { GameNote, TimeSignatureEvent } from "../music/types";
import {
  base64UrlToBytes,
  bytesToBase64Url,
  decodeScoreSnapshot,
  encodeScoreSnapshot,
  type ScoreSnapshot,
  type ScoreSnapshotInput
} from "../persistence/scoreCodec";

export interface MidiExportOptions {
  bpm: number;
  timeSignatures?: TimeSignatureEvent[];
  /**
   * The pre-fingering score behind the exported notes. When given, it is
   * embedded as a DFHS1 text event so the desktop player can rebuild the exact
   * same fingering instead of guessing from bare pitches.
   */
  snapshot?: ScoreSnapshotInput;
}

const DEFAULT_BPM = 120;
const DEFAULT_SIGNATURE: [number, number] = [4, 4];
const MAX_PITCH = 127;

/** Header text written into every export; the desktop app checks it for legacy files. */
export const MIDI_HEADER_NAME = "Delta Force Harmonica";
export const MIDI_TRACK_NAME = "DFH SCORE";
/** Text meta event prefix followed by the base64url DFHS1 snapshot. */
export const MIDI_SNAPSHOT_PREFIX = "DFHS1 ";

/**
 * Encodes the generated harmonica score as a standard MIDI file. The notes are
 * the converted result — post transpose, already collapsed to one note at a
 * time — so the file plays back exactly what the preview plays, not the
 * imported source. Keys and modifier state are not in the note data; when a
 * snapshot is supplied they travel in a text meta event instead.
 */
export function toMidiFile(notes: GameNote[], options: MidiExportOptions): Uint8Array {
  const bpm = options.bpm > 0 ? options.bpm : DEFAULT_BPM;
  const midi = new Midi();

  // midi-file writes meta text one byte per code point, so a Chinese title would
  // desync the length prefix. Everything inside the file stays ASCII; the
  // download name carries the song title instead. base64url is ASCII too.
  midi.header.name = MIDI_HEADER_NAME;
  midi.header.setTempo(bpm);
  const signature = options.timeSignatures?.[0];
  midi.header.timeSignatures = [
    { ticks: 0, timeSignature: signature ? [signature.numerator, signature.denominator] : DEFAULT_SIGNATURE }
  ];
  if (options.snapshot) {
    midi.header.meta = [{
      ticks: 0,
      type: "text",
      text: MIDI_SNAPSHOT_PREFIX + bytesToBase64Url(encodeScoreSnapshot(options.snapshot))
    }];
  }
  midi.header.update();

  const track = midi.addTrack();
  track.name = MIDI_TRACK_NAME;

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

/**
 * Reads the snapshot a previous export embedded, or null when the file has none.
 * Mirrors what the desktop app does with the same bytes.
 */
export function readMidiSnapshot(data: ArrayLike<number> | ArrayBuffer): ScoreSnapshot | null {
  const midi = new Midi(data as ArrayBuffer);
  const event = midi.header.meta.find((item) => item.type === "text" && item.text.startsWith(MIDI_SNAPSHOT_PREFIX));
  if (!event) return null;
  return decodeScoreSnapshot(base64UrlToBytes(event.text.slice(MIDI_SNAPSHOT_PREFIX.length)));
}
