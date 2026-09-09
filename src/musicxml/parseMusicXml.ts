import { strFromU8, unzipSync } from "fflate";
import type { NoteEvent, ParsedSong, SongTrack, TempoEvent, TimeSignatureEvent } from "../music/types";

const STEP_TO_SEMITONE: Record<string, number> = {
  C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11
};

const BEAT_UNIT_TO_QUARTERS: Record<string, number> = {
  whole: 4,
  half: 2,
  quarter: 1,
  eighth: 0.5,
  "16th": 0.25,
  "32nd": 0.125,
  "64th": 0.0625
};

function children(element: Element, localName?: string): Element[] {
  const list = Array.from(element.children);
  return localName ? list.filter((item) => item.localName === localName) : list;
}

function child(element: Element, localName: string): Element | undefined {
  return children(element, localName)[0];
}

function descendants(element: ParentNode, localName: string): Element[] {
  return Array.from(element.querySelectorAll("*")).filter((item) => item.localName === localName);
}

function text(element: Element | undefined): string {
  return element?.textContent?.trim() || "";
}

function numberText(element: Element | undefined, fallback = 0): number {
  const value = Number(text(element));
  return Number.isFinite(value) ? value : fallback;
}

function parseDocument(xml: string): XMLDocument {
  const document = new DOMParser().parseFromString(xml, "application/xml");
  if (descendants(document, "parsererror").length > 0) {
    throw new Error("MusicXML 不是有效的 XML 文档。");
  }
  return document;
}

function pitchToMidi(note: Element): number | null {
  const pitch = child(note, "pitch");
  if (!pitch) return null;
  const step = text(child(pitch, "step")).toUpperCase();
  const base = STEP_TO_SEMITONE[step];
  const octave = numberText(child(pitch, "octave"), Number.NaN);
  if (base === undefined || !Number.isFinite(octave)) return null;
  const alter = numberText(child(pitch, "alter"), 0);
  return Math.round((octave + 1) * 12 + base + alter);
}

function tempoFromDirection(direction: Element): number | null {
  const sound = descendants(direction, "sound")[0];
  const soundTempo = Number(sound?.getAttribute("tempo"));
  if (Number.isFinite(soundTempo) && soundTempo > 0) return soundTempo;

  const metronome = descendants(direction, "metronome")[0];
  if (!metronome) return null;
  const perMinute = numberText(child(metronome, "per-minute"), Number.NaN);
  if (!Number.isFinite(perMinute) || perMinute <= 0) return null;
  const unit = text(child(metronome, "beat-unit")) || "quarter";
  let quarters = BEAT_UNIT_TO_QUARTERS[unit] ?? 1;
  const dots = children(metronome, "beat-unit-dot").length;
  if (dots === 1) quarters *= 1.5;
  if (dots >= 2) quarters *= 1.75;
  return perMinute * quarters;
}

function normalizeTempos(events: Array<{ beat: number; bpm: number }>): TempoEvent[] {
  const sorted = [...events]
    .filter((event) => Number.isFinite(event.beat) && Number.isFinite(event.bpm) && event.bpm > 0)
    .sort((a, b) => a.beat - b.beat);
  const deduped: Array<{ beat: number; bpm: number }> = [];
  for (const event of sorted) {
    const previous = deduped[deduped.length - 1];
    if (previous && Math.abs(previous.beat - event.beat) < 1e-6) previous.bpm = event.bpm;
    else deduped.push({ ...event });
  }
  if (deduped.length === 0 || deduped[0].beat > 1e-6) deduped.unshift({ beat: 0, bpm: 120 });

  const result: TempoEvent[] = [];
  let time = 0;
  for (let index = 0; index < deduped.length; index += 1) {
    if (index > 0) {
      const previous = deduped[index - 1];
      time += (deduped[index].beat - previous.beat) * 60000 / previous.bpm;
    }
    result.push({ beat: deduped[index].beat, bpm: deduped[index].bpm, time: Math.round(time) });
  }
  return result;
}

function normalizeTimeSignatures(events: TimeSignatureEvent[]): TimeSignatureEvent[] {
  const sorted = [...events]
    .filter((event) => event.numerator > 0 && event.denominator > 0)
    .sort((a, b) => a.beat - b.beat);
  const deduped: TimeSignatureEvent[] = [];
  for (const event of sorted) {
    const previous = deduped[deduped.length - 1];
    if (previous && Math.abs(previous.beat - event.beat) < 1e-6) {
      previous.numerator = event.numerator;
      previous.denominator = event.denominator;
    } else {
      deduped.push({ ...event });
    }
  }
  if (deduped.length === 0 || deduped[0].beat > 1e-6) {
    deduped.unshift({ beat: 0, numerator: 4, denominator: 4 });
  }
  return deduped;
}

function beatToMs(beat: number, tempos: TempoEvent[]): number {
  let event = tempos[0];
  for (let index = 1; index < tempos.length; index += 1) {
    if (tempos[index].beat > beat) break;
    event = tempos[index];
  }
  return event.time + (beat - event.beat) * 60000 / event.bpm;
}

interface BeatNote {
  pitch: number;
  beat: number;
  durationBeats: number;
  velocity: number;
}

interface ParsedPartBeatData {
  id: string;
  name: string;
  notes: BeatNote[];
  tempoEvents: Array<{ beat: number; bpm: number }>;
  timeSignatures: TimeSignatureEvent[];
  measureStarts: number[];
}

function parsePart(part: Element, partName: string): ParsedPartBeatData {
  let divisions = 1;
  let numerator = 4;
  let denominator = 4;
  let partBeat = 0;
  const notes: BeatNote[] = [];
  const tempoEvents: Array<{ beat: number; bpm: number }> = [];
  const timeSignatures: TimeSignatureEvent[] = [];
  const measureStarts: number[] = [];

  for (const measure of children(part, "measure")) {
    measureStarts.push(partBeat);
    let cursorDiv = 0;
    let maxCursorDiv = 0;
    let lastNoteStartDiv = 0;

    for (const item of children(measure)) {
      if (item.localName === "attributes") {
        const nextDivisions = numberText(child(item, "divisions"), divisions);
        if (nextDivisions > 0) divisions = nextDivisions;
        const time = child(item, "time");
        if (time) {
          const nextNumerator = numberText(child(time, "beats"), numerator);
          const nextDenominator = numberText(child(time, "beat-type"), denominator);
          if (nextNumerator > 0 && nextDenominator > 0) {
            numerator = nextNumerator;
            denominator = nextDenominator;
            timeSignatures.push({ beat: partBeat + cursorDiv / divisions, numerator, denominator });
          }
        }
        continue;
      }

      if (item.localName === "direction") {
        const bpm = tempoFromDirection(item);
        if (bpm) {
          const offset = numberText(child(item, "offset"), 0);
          tempoEvents.push({ beat: partBeat + (cursorDiv + offset) / divisions, bpm });
        }
        continue;
      }

      if (item.localName === "backup") {
        cursorDiv = Math.max(0, cursorDiv - numberText(child(item, "duration"), 0));
        continue;
      }

      if (item.localName === "forward") {
        cursorDiv += numberText(child(item, "duration"), 0);
        maxCursorDiv = Math.max(maxCursorDiv, cursorDiv);
        continue;
      }

      if (item.localName !== "note") continue;
      const durationDiv = Math.max(0, numberText(child(item, "duration"), 0));
      const isChord = Boolean(child(item, "chord"));
      const startDiv = isChord ? lastNoteStartDiv : cursorDiv;
      if (!isChord) lastNoteStartDiv = startDiv;
      const midi = child(item, "rest") ? null : pitchToMidi(item);
      if (midi !== null) {
        notes.push({
          pitch: midi,
          beat: partBeat + startDiv / divisions,
          durationBeats: Math.max(1 / 96, durationDiv / divisions),
          velocity: 0.8
        });
      }
      if (!isChord) cursorDiv += durationDiv;
      maxCursorDiv = Math.max(maxCursorDiv, cursorDiv, startDiv + durationDiv);
    }

    const actualLength = maxCursorDiv / divisions;
    const expectedLength = numerator * 4 / denominator;
    partBeat += actualLength > 1e-6 ? actualLength : expectedLength;
  }

  return {
    id: part.getAttribute("id") || partName,
    name: partName,
    notes,
    tempoEvents,
    timeSignatures,
    measureStarts
  };
}

export function parseMusicXmlText(xml: string, fallbackName = "MusicXML Score", sourceFormat: "musicxml" | "mxl" = "musicxml"): ParsedSong {
  const document = parseDocument(xml);
  const root = document.documentElement;
  if (root.localName !== "score-partwise") {
    throw new Error("当前版本支持 MusicXML score-partwise；score-timewise 暂未支持。");
  }

  const partNames = new Map<string, string>();
  for (const scorePart of descendants(root, "score-part")) {
    const id = scorePart.getAttribute("id");
    if (id) partNames.set(id, text(child(scorePart, "part-name")) || id);
  }

  const parsedParts = children(root, "part").map((part, index) => {
    const id = part.getAttribute("id") || `P${index + 1}`;
    return parsePart(part, partNames.get(id) || `Part ${index + 1}`);
  }).filter((part) => part.notes.length > 0);

  if (parsedParts.length === 0) throw new Error("这个 MusicXML 中没有可读取的音符。");

  const tempos = normalizeTempos(parsedParts.flatMap((part) => part.tempoEvents));
  const timeSignatures = normalizeTimeSignatures(parsedParts.flatMap((part) => part.timeSignatures));

  const tracks: SongTrack[] = parsedParts.map((part, index) => ({
    id: `${index}-${part.id}`,
    name: part.name,
    channel: index,
    instrument: "MusicXML Part",
    notes: part.notes.map<NoteEvent>((note) => ({
      pitch: note.pitch,
      beat: note.beat,
      durationBeats: note.durationBeats,
      start: Math.round(beatToMs(note.beat, tempos)),
      duration: Math.max(1, Math.round(beatToMs(note.beat + note.durationBeats, tempos) - beatToMs(note.beat, tempos))),
      velocity: note.velocity
    }))
  }));

  const lastBeat = Math.max(...parsedParts.flatMap((part) => part.notes.map((note) => note.beat + note.durationBeats)));
  const title = text(descendants(root, "work-title")[0]) || text(descendants(root, "movement-title")[0]) || fallbackName;

  return {
    name: title,
    bpm: Math.round(tempos[0].bpm),
    duration: Math.round(beatToMs(lastBeat, tempos)),
    ppq: 480,
    sourceFormat,
    tempos,
    timeSignatures,
    measureStarts: parsedParts[0].measureStarts,
    tracks
  };
}

function readMxlXml(bytes: Uint8Array): string {
  const archive = unzipSync(bytes);
  const containerBytes = archive["META-INF/container.xml"];
  if (containerBytes) {
    const container = parseDocument(strFromU8(containerBytes));
    const rootfile = descendants(container, "rootfile")[0]?.getAttribute("full-path");
    if (rootfile && archive[rootfile]) return strFromU8(archive[rootfile]);
  }

  const candidate = Object.keys(archive).find((path) => /\.(musicxml|xml)$/i.test(path) && !path.startsWith("META-INF/"));
  if (!candidate) throw new Error("MXL 压缩包中没有找到 MusicXML 主文件。");
  return strFromU8(archive[candidate]);
}

export async function parseMusicXmlFile(file: File): Promise<ParsedSong> {
  const fallbackName = file.name.replace(/\.(musicxml|xml|mxl)$/i, "");
  if (/\.mxl$/i.test(file.name)) {
    const xml = readMxlXml(new Uint8Array(await file.arrayBuffer()));
    return parseMusicXmlText(xml, fallbackName, "mxl");
  }
  return parseMusicXmlText(await file.text(), fallbackName, "musicxml");
}
