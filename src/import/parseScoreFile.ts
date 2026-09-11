import type { ParsedSong } from "../music/types";
import { parseAudioFile } from "../audio/parseAudio";
import type { AudioTranscriptionPreset } from "../audio/presets";
import { parseMidiFile } from "../midi/parseMidi";
import { parseMusicXmlFile } from "../musicxml/parseMusicXml";
import { captureParsedSong } from "../persistence/currentScore";

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
  let parsed: ParsedSong;
  if (/\.midi?$/i.test(file.name)) parsed = await parseMidiFile(file);
  else if (/\.(musicxml|xml|mxl)$/i.test(file.name)) parsed = await parseMusicXmlFile(file);
  else if (/\.(mp3|wav|ogg|flac)$/i.test(file.name) || /^audio\//i.test(file.type)) {
    parsed = await parseAudioFile(file, onProgress, options.audioPreset ?? "balanced");
  } else {
    throw new Error("当前支持 MIDI、MusicXML、MXL，以及纯伴奏 / 器乐的 MP3 / WAV / OGG / FLAC 音频转谱。");
  }
  captureParsedSong(parsed);
  return parsed;
}
