export interface NoteEvent {
  pitch: number;
  start: number;
  duration: number;
  velocity?: number;
  name?: string;
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
  tracks: SongTrack[];
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
