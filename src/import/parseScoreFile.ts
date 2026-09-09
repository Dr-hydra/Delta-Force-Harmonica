import type { ParsedSong } from "../music/types";
import { parseAudioFile } from "../audio/parseAudio";
import type { AudioTranscriptionPreset } from "../audio/presets";
import { parseMidiFile } from "../midi/parseMidi";
import { parseMusicXmlFile } from "../musicxml/parseMusicXml";

export interface ParseProgress {
  label: string;
  value: number;
}

export interface ParseScoreOptions {
  audioPreset?: AudioTranscriptionPreset;
}

export type ParseProgressCallback = (progress: ParseProgress) => void;

export const SCORE_FILE_ACCEPT = [
  ".mid", ".midi", ".musicxml", ".xml", ".mxl",
  ".mp3", ".wav", ".ogg", ".flac",
  "audio/midi", "audio/x-midi",
  "audio/mpeg", "audio/wav", "audio/x-wav", "audio/ogg", "audio/flac",
  "application/vnd.recordare.musicxml", "application/vnd.recordare.musicxml+xml"
].join(",");

export async function parseScoreFile(
  file: File,
  onProgress?: ParseProgressCallback,
  options: ParseScoreOptions = {}
): Promise<ParsedSong> {
  if (/\.midi?$/i.test(file.name)) return parseMidiFile(file);
  if (/\.(musicxml|xml|mxl)$/i.test(file.name)) return parseMusicXmlFile(file);
  if (/\.(mp3|wav|ogg|flac)$/i.test(file.name) || /^audio\//i.test(file.type)) {
    return parseAudioFile(file, onProgress, options.audioPreset ?? "balanced");
  }
  throw new Error("当前支持 MIDI、MusicXML、MXL，以及实验性的 MP3 / WAV / OGG / FLAC 音频转谱。");
}
