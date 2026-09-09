import type { ParsedSong } from "../music/types";
import { parseMidiFile } from "../midi/parseMidi";
import { parseMusicXmlFile } from "../musicxml/parseMusicXml";

export const SCORE_FILE_ACCEPT = ".mid,.midi,.musicxml,.xml,.mxl,audio/midi,audio/x-midi,application/vnd.recordare.musicxml,application/vnd.recordare.musicxml+xml";

export async function parseScoreFile(file: File): Promise<ParsedSong> {
  if (/\.midi?$/i.test(file.name)) return parseMidiFile(file);
  if (/\.(musicxml|xml|mxl)$/i.test(file.name)) return parseMusicXmlFile(file);
  throw new Error("当前支持 MIDI、MusicXML 与 MXL。ABC 和简谱文本会在后续版本加入。");
}
