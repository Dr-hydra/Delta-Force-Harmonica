import type { NoteEvent, ParsedSong, TempoEvent, TimeSignatureEvent } from "../music/types";
import { DEFAULT_SCORE_PPQ, type ScoreSnapshotInput } from "./scoreCodec";

interface OptimizationState {
  notes: NoteEvent[];
  transpose: number;
}

export interface CurrentConverterScore {
  projectKey: string;
  title: string;
  snapshot: ScoreSnapshotInput;
}

let parsedSong: ParsedSong | null = null;
let sourceRevision = 0;
let optimization: OptimizationState | null = null;

export function captureParsedSong(song: ParsedSong) {
  parsedSong = song;
  sourceRevision += 1;
}

export function captureOptimization(notes: NoteEvent[], transpose: number) {
  optimization = { notes, transpose };
}

function visibleTitle() {
  if (typeof document === "undefined") return "";
  return document.querySelector<HTMLElement>(".song-head h2")?.textContent?.trim() ?? "";
}

function visibleFormat() {
  if (typeof document === "undefined") return "";
  return document.querySelector<HTMLElement>(".source-format-tag")?.textContent?.trim().toUpperCase() ?? "";
}

function fallbackTempos(bpm: number): TempoEvent[] {
  return [{ beat: 0, time: 0, bpm }];
}

function fallbackSignatures(): TimeSignatureEvent[] {
  return [{ beat: 0, numerator: 4, denominator: 4 }];
}

/**
 * Returns exactly what the converter is currently previewing: source/editor notes
 * plus the active transpose. Source metadata is captured when a file finishes
 * parsing, so variable tempo maps survive cloud save/publish as well.
 */
export function readCurrentConverterScore(): CurrentConverterScore | null {
  if (!optimization?.notes.length) return null;

  const titleFromUi = visibleTitle();
  const demo = visibleFormat() === "DEMO" || titleFromUi === "C 大调音阶 Demo";
  const song = demo ? null : parsedSong;
  const title = titleFromUi || song?.name || "未命名乐谱";
  const bpm = demo ? 143 : song?.bpm || 120;

  return {
    projectKey: demo ? "demo" : song ? `source-${sourceRevision}` : "blank",
    title,
    snapshot: {
      ppq: song?.ppq || DEFAULT_SCORE_PPQ,
      transpose: optimization.transpose,
      tempos: song?.tempos?.length ? song.tempos : fallbackTempos(bpm),
      timeSignatures: demo
        ? fallbackSignatures()
        : song?.timeSignatures?.length ? song.timeSignatures : fallbackSignatures(),
      measureStarts: demo ? [0, 4, 8, 12] : song?.measureStarts ?? [],
      notes: optimization.notes
    }
  };
}
