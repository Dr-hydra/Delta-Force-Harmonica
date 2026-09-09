import { Midi } from "@tonejs/midi";
import type { ParsedSong, SongTrack, TempoEvent, TimeSignatureEvent } from "../music/types";

export async function parseMidiFile(file: File): Promise<ParsedSong> {
  const data = await file.arrayBuffer();
  const midi = new Midi(data);
  const ppq = midi.header.ppq;

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
        beat: note.ticks / ppq,
        durationBeats: note.durationTicks / ppq,
        velocity: note.velocity,
        name: note.name
      }))
    }))
    .filter((track) => track.notes.length > 0);

  if (tracks.length === 0) {
    throw new Error("这个 MIDI 中没有可读取的音符轨道。");
  }

  const rawTempos = midi.header.tempos
    .map((tempo) => ({ beat: tempo.ticks / ppq, bpm: tempo.bpm }))
    .sort((a, b) => a.beat - b.beat);
  if (rawTempos.length === 0 || rawTempos[0].beat > 1e-6) {
    rawTempos.unshift({ beat: 0, bpm: 120 });
  }

  const tempos: TempoEvent[] = [];
  let tempoTime = 0;
  for (let index = 0; index < rawTempos.length; index += 1) {
    if (index > 0) {
      const previous = rawTempos[index - 1];
      tempoTime += (rawTempos[index].beat - previous.beat) * 60000 / previous.bpm;
    }
    tempos.push({ beat: rawTempos[index].beat, bpm: rawTempos[index].bpm, time: Math.round(tempoTime) });
  }

  const timeSignatures: TimeSignatureEvent[] = midi.header.timeSignatures
    .map((signature) => ({
      beat: signature.ticks / ppq,
      numerator: signature.timeSignature[0],
      denominator: signature.timeSignature[1]
    }))
    .sort((a, b) => a.beat - b.beat);

  if (timeSignatures.length === 0 || timeSignatures[0].beat > 1e-6) {
    timeSignatures.unshift({ beat: 0, numerator: 4, denominator: 4 });
  }

  return {
    name: file.name.replace(/\.midi?$/i, ""),
    bpm: Math.round(tempos[0]?.bpm || 120),
    duration: Math.round(midi.duration * 1000),
    ppq,
    sourceFormat: "midi",
    tempos,
    timeSignatures,
    measureStarts: [],
    tracks
  };
}
