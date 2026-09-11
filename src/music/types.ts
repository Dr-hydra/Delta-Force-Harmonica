export interface NoteEvent {
  pitch: number;
  start: number;
  duration: number;
  beat?: number;
  durationBeats?: number;
  velocity?: number;
  name?: string;
}

export interface TempoEvent {
  beat: number;
  time: number;
  bpm: number;
}

export interface TimeSignatureEvent {
  beat: number;
  numerator: number;
  denominator: number;
}

export type SourceFormat = "midi" | "musicxml" | "mxl" | "audio";
export type AudioPresetId = "solo" | "balanced" | "ensemble";

export interface AudioCleanStats {
  rawCount: number;
  cleanCount: number;
  removedRange: number;
  removedShort: number;
  removedWeak: number;
  mergedFragments: number;
  removedDensity: number;
  amplitudeFloor: number;
}

export interface AudioBeatGrid {
  bpm: number;
  /** Beat times in seconds, extrapolated backwards so the first entry is <= 0. */
  beats: number[];
  medianInterval: number;
  /** Beats the detector actually reported, before backward extrapolation. */
  detectedCount: number;
  /** Which entry of the retry ladder succeeded; 0 means the strict defaults did. */
  attempt: number;
}

export interface AudioAnalysisInfo {
  preset: AudioPresetId;
  rawNotes: NoteEvent[];
  cleanedNotes: NoteEvent[];
  stats: AudioCleanStats;
  /** Absent when beat tracking found nothing usable; the score then falls back to 120 BPM. */
  beatGrid?: AudioBeatGrid;
  /** Why beat tracking produced no grid, shown when beatGrid is absent. */
  beatFailure?: string;
}

export interface SongTrack {
  id: string;
  name: string;
  channel: number;
  instrument: string;
  notes: NoteEvent[];
}

export interface ParsedSong {
  name: string;
  bpm: number;
  duration: number;
  ppq: number;
  sourceFormat: SourceFormat;
  tempos: TempoEvent[];
  timeSignatures: TimeSignatureEvent[];
  measureStarts: number[];
  tracks: SongTrack[];
  audioAnalysis?: AudioAnalysisInfo;
}

export type HarmonicaKey = "Z" | "X" | "C" | "V" | "B" | "N" | "M" | ",";

export interface HarmonicaCandidate {
  key: HarmonicaKey;
  degree: 1 | 2 | 3 | 4 | 5 | 6 | 7;
  keyIndex: number;
  intrinsicOctave: number;
  octaveModifier: -1 | 0 | 1;
  sharp: boolean;
  pitch: number;
}

export interface GameNote extends NoteEvent, HarmonicaCandidate {
  /** Position of this note in the array handed to optimizeHarmonica. */
  sourceIndex: number;
}

export interface ConversionResult {
  notes: GameNote[];
  unplayable: NoteEvent[];
  cost: number;
  modifierChanges: number;
}
