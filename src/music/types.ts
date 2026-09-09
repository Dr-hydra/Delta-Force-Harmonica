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
export type AudioPresetId = "solo" | "balanced" | "mix";

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

export interface AudioAnalysisInfo {
  preset: AudioPresetId;
  rawNotes: NoteEvent[];
  cleanedNotes: NoteEvent[];
  stats: AudioCleanStats;
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

export interface GameNote extends NoteEvent, HarmonicaCandidate {}

export interface ConversionResult {
  notes: GameNote[];
  unplayable: NoteEvent[];
  cost: number;
  modifierChanges: number;
}
