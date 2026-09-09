import { Midi } from "@tonejs/midi";
import type { ParsedSong, SongTrack } from "../music/types";

export async function parseMidiFile(file: File): Promise<ParsedSong> {
  const data = await file.arrayBuffer();
  const midi = new Midi(data);

  const tracks: SongTrack[] = midi.tracks
    .map((track, index) => ({
      id: `${index}-${track.channel}-${track.instrument.number}`,
      name: track.name?.trim() || `Track ${index + 1}`,
      channel: track.channel,
      instrument: track.instrument.name || `Program ${track.instrument.number}`,
      notes: track.notes.map((note) => ({
        pitch: note.midi,
        start: Math.round(note.time * 1000),
        duration: Math.max(1, Math.round(note.duration * 1000)),
        velocity: note.velocity,
        name: note.name
      }))
    }))
    .filter((track) => track.notes.length > 0);

  if (tracks.length === 0) {
    throw new Error("这个 MIDI 中没有可读取的音符轨道。");
  }

  const firstTempo = midi.header.tempos[0]?.bpm;

  return {
    name: file.name.replace(/\.midi?$/i, ""),
    bpm: Math.round(firstTempo || 120),
    duration: Math.round(midi.duration * 1000),
    ppq: midi.header.ppq,
    tracks
  };
}
