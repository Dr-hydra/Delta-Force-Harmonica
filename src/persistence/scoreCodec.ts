import { deflateSync, inflateSync } from "fflate";
import type { NoteEvent, TempoEvent, TimeSignatureEvent } from "../music/types";

const MAGIC = [0x44, 0x46, 0x48, 0x53] as const; // DFHS
export const DFHS_VERSION = 1;
export const DEFAULT_SCORE_PPQ = 480;

export interface ScoreSnapshotInput {
  ppq?: number;
  transpose?: number;
  tempos?: TempoEvent[];
  timeSignatures?: TimeSignatureEvent[];
  measureStarts?: number[];
  notes: NoteEvent[];
}

export interface ScoreSnapshot {
  version: number;
  ppq: number;
  transpose: number;
  tempos: TempoEvent[];
  timeSignatures: TimeSignatureEvent[];
  measureStarts: number[];
  notes: NoteEvent[];
}

class Writer {
  private bytes: number[] = [];

  u8(value: number) {
    this.bytes.push(value & 0xff);
  }

  varint(value: number) {
    let current = Math.max(0, Math.round(value));
    if (!Number.isSafeInteger(current)) throw new Error("DFHS integer exceeds the safe range");
    do {
      let byte = current % 128;
      current = Math.floor(current / 128);
      if (current > 0) byte |= 0x80;
      this.bytes.push(byte);
    } while (current > 0);
  }

  finish() {
    return Uint8Array.from(this.bytes);
  }
}

class Reader {
  private offset = 0;
  constructor(private readonly bytes: Uint8Array) {}

  u8() {
    if (this.offset >= this.bytes.length) throw new Error("DFHS data is truncated");
    return this.bytes[this.offset++];
  }

  varint() {
    let result = 0;
    let shift = 1;
    for (;;) {
      const byte = this.u8();
      result += (byte & 0x7f) * shift;
      if (!(byte & 0x80)) return result;
      shift *= 128;
      if (shift > 2 ** 49) throw new Error("DFHS varint is too large");
    }
  }
}

function clampInteger(value: number, min: number, max: number, fallback: number) {
  if (!Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, Math.round(value)));
}

function zigzag(value: number) {
  const integer = Math.trunc(value);
  return integer >= 0 ? integer * 2 : -integer * 2 - 1;
}

function unzigzag(value: number) {
  return value % 2 === 0 ? value / 2 : -(value + 1) / 2;
}

function normalizedTempos(input: TempoEvent[] | undefined): TempoEvent[] {
  const sorted = (input ?? [])
    .filter((item) => Number.isFinite(item.beat) && Number.isFinite(item.bpm) && item.bpm > 0)
    .map((item) => ({ beat: Math.max(0, item.beat), bpm: item.bpm, time: 0 }))
    .sort((a, b) => a.beat - b.beat);
  if (!sorted.length || sorted[0].beat > 1e-7) sorted.unshift({ beat: 0, bpm: 120, time: 0 });

  const deduped: TempoEvent[] = [];
  for (const event of sorted) {
    const previous = deduped.at(-1);
    if (previous && Math.abs(previous.beat - event.beat) < 1e-7) {
      previous.bpm = event.bpm;
    } else {
      deduped.push({ ...event });
    }
  }

  let time = 0;
  for (let index = 0; index < deduped.length; index += 1) {
    if (index > 0) {
      const previous = deduped[index - 1];
      time += (deduped[index].beat - previous.beat) * 60000 / previous.bpm;
    }
    deduped[index].time = Math.round(time);
  }
  return deduped;
}

function normalizedSignatures(input: TimeSignatureEvent[] | undefined): TimeSignatureEvent[] {
  const sorted = (input ?? [])
    .filter((item) => Number.isFinite(item.beat) && item.numerator > 0 && item.denominator > 0)
    .map((item) => ({
      beat: Math.max(0, item.beat),
      numerator: clampInteger(item.numerator, 1, 32, 4),
      denominator: clampInteger(item.denominator, 1, 64, 4)
    }))
    .sort((a, b) => a.beat - b.beat);
  if (!sorted.length || sorted[0].beat > 1e-7) sorted.unshift({ beat: 0, numerator: 4, denominator: 4 });
  return sorted;
}

export function beatToMs(beat: number, tempos: TempoEvent[]) {
  const target = Math.max(0, beat);
  let active = tempos[0] ?? { beat: 0, bpm: 120, time: 0 };
  for (const event of tempos) {
    if (event.beat > target) break;
    active = event;
  }
  return active.time + (target - active.beat) * 60000 / active.bpm;
}

export function msToBeat(ms: number, tempos: TempoEvent[]) {
  const target = Math.max(0, ms);
  let active = tempos[0] ?? { beat: 0, bpm: 120, time: 0 };
  for (const event of tempos) {
    if (event.time > target) break;
    active = event;
  }
  return active.beat + (target - active.time) * active.bpm / 60000;
}

function canonicalNotes(notes: NoteEvent[], ppq: number, tempos: TempoEvent[]) {
  return notes
    .filter((note) => Number.isFinite(note.pitch) && Number.isFinite(note.start) && Number.isFinite(note.duration))
    .map((note) => {
      const beat = Number.isFinite(note.beat) ? Math.max(0, note.beat as number) : msToBeat(note.start, tempos);
      const durationBeats = Number.isFinite(note.durationBeats)
        ? Math.max(1 / ppq, note.durationBeats as number)
        : Math.max(1 / ppq, msToBeat(note.start + note.duration, tempos) - beat);
      return {
        startTick: Math.max(0, Math.round(beat * ppq)),
        durationTick: Math.max(1, Math.round(durationBeats * ppq)),
        pitch: clampInteger(note.pitch, 0, 127, 60)
      };
    })
    .sort((a, b) => a.startTick - b.startTick || a.pitch - b.pitch || a.durationTick - b.durationTick);
}

/**
 * DFHS1 stores only authoritative score data: integer ticks, tempo/signature maps,
 * optional explicit measure starts and MIDI pitches. Millisecond timing, note names,
 * velocity and harmonica fingering are derived when the score is opened.
 */
export function encodeScoreSnapshot(input: ScoreSnapshotInput): Uint8Array {
  const ppq = clampInteger(input.ppq ?? DEFAULT_SCORE_PPQ, 24, 9600, DEFAULT_SCORE_PPQ);
  const transpose = clampInteger(input.transpose ?? 0, -48, 48, 0);
  const tempos = normalizedTempos(input.tempos);
  const signatures = normalizedSignatures(input.timeSignatures);
  const measures = [...new Set((input.measureStarts ?? [])
    .filter(Number.isFinite)
    .map((beat) => Math.max(0, Math.round(beat * ppq))))].sort((a, b) => a - b);
  const notes = canonicalNotes(input.notes, ppq, tempos);

  const writer = new Writer();
  MAGIC.forEach((byte) => writer.u8(byte));
  writer.u8(DFHS_VERSION);
  writer.varint(ppq);
  writer.varint(zigzag(transpose));

  writer.varint(tempos.length);
  let previousTick = 0;
  for (const tempo of tempos) {
    const tick = Math.max(previousTick, Math.round(tempo.beat * ppq));
    writer.varint(tick - previousTick);
    writer.varint(Math.max(1, Math.round(tempo.bpm * 100)));
    previousTick = tick;
  }

  writer.varint(signatures.length);
  previousTick = 0;
  for (const signature of signatures) {
    const tick = Math.max(previousTick, Math.round(signature.beat * ppq));
    writer.varint(tick - previousTick);
    writer.varint(signature.numerator);
    writer.varint(signature.denominator);
    previousTick = tick;
  }

  writer.varint(measures.length);
  previousTick = 0;
  for (const tick of measures) {
    writer.varint(tick - previousTick);
    previousTick = tick;
  }

  writer.varint(notes.length);
  previousTick = 0;
  for (const note of notes) {
    writer.varint(note.startTick - previousTick);
    writer.varint(note.durationTick);
    writer.u8(note.pitch);
    previousTick = note.startTick;
  }

  return deflateSync(writer.finish(), { level: 9 });
}

export function decodeScoreSnapshot(compressed: Uint8Array): ScoreSnapshot {
  const reader = new Reader(inflateSync(compressed));
  for (const byte of MAGIC) if (reader.u8() !== byte) throw new Error("Not a DFHS score");
  const version = reader.u8();
  if (version !== DFHS_VERSION) throw new Error(`Unsupported DFHS version ${version}`);

  const ppq = reader.varint();
  if (ppq < 24 || ppq > 9600) throw new Error("Invalid DFHS PPQ");
  const transpose = unzigzag(reader.varint());

  const tempoCount = reader.varint();
  if (tempoCount > 4096) throw new Error("DFHS contains too many tempo events");
  const tempos: TempoEvent[] = [];
  let tick = 0;
  let time = 0;
  for (let index = 0; index < tempoCount; index += 1) {
    tick += reader.varint();
    const bpm = reader.varint() / 100;
    const beat = tick / ppq;
    if (index > 0) {
      const previous = tempos[index - 1];
      time += (beat - previous.beat) * 60000 / previous.bpm;
    }
    tempos.push({ beat, bpm, time: Math.round(time) });
  }
  if (!tempos.length) tempos.push({ beat: 0, bpm: 120, time: 0 });

  const signatureCount = reader.varint();
  if (signatureCount > 1024) throw new Error("DFHS contains too many time signatures");
  const timeSignatures: TimeSignatureEvent[] = [];
  tick = 0;
  for (let index = 0; index < signatureCount; index += 1) {
    tick += reader.varint();
    timeSignatures.push({
      beat: tick / ppq,
      numerator: reader.varint(),
      denominator: reader.varint()
    });
  }
  if (!timeSignatures.length) timeSignatures.push({ beat: 0, numerator: 4, denominator: 4 });

  const measureCount = reader.varint();
  if (measureCount > 100_000) throw new Error("DFHS contains too many measures");
  const measureStarts: number[] = [];
  tick = 0;
  for (let index = 0; index < measureCount; index += 1) {
    tick += reader.varint();
    measureStarts.push(tick / ppq);
  }

  const noteCount = reader.varint();
  if (noteCount > 1_000_000) throw new Error("DFHS contains too many notes");
  const notes: NoteEvent[] = [];
  tick = 0;
  for (let index = 0; index < noteCount; index += 1) {
    tick += reader.varint();
    const durationTick = reader.varint();
    const pitch = reader.u8();
    const beat = tick / ppq;
    const durationBeats = Math.max(1 / ppq, durationTick / ppq);
    const start = beatToMs(beat, tempos);
    const end = beatToMs(beat + durationBeats, tempos);
    notes.push({
      pitch,
      start: Math.round(start),
      duration: Math.max(1, Math.round(end - start)),
      beat,
      durationBeats
    });
  }

  return { version, ppq, transpose, tempos, timeSignatures, measureStarts, notes };
}

export function scoreSnapshotSummary(snapshot: ScoreSnapshot) {
  const last = snapshot.notes.reduce((max, note) => Math.max(max, (note.beat ?? 0) + (note.durationBeats ?? 0)), 0);
  return {
    noteCount: snapshot.notes.length,
    bpm: snapshot.tempos[0]?.bpm ?? 120,
    durationBeats: last,
    durationMs: Math.round(beatToMs(last, snapshot.tempos))
  };
}

export function bytesToBase64Url(bytes: Uint8Array) {
  let binary = "";
  for (let index = 0; index < bytes.length; index += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
  }
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

export function base64UrlToBytes(value: string) {
  const padded = value.replaceAll("-", "+").replaceAll("_", "/") + "=".repeat((4 - value.length % 4) % 4);
  return Uint8Array.from(atob(padded), (char) => char.charCodeAt(0));
}
