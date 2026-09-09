import type { NoteEvent, ParsedSong } from "../music/types";

const MODEL_SAMPLE_RATE = 22050;
const FALLBACK_BPM = 120;
const MAX_AUDIO_BYTES = 40 * 1024 * 1024;
const MAX_AUDIO_SECONDS = 12 * 60;

export interface AudioParseProgress {
  label: string;
  value: number;
}

export type AudioParseProgressCallback = (progress: AudioParseProgress) => void;

function report(callback: AudioParseProgressCallback | undefined, label: string, value: number) {
  callback?.({ label, value: Math.max(0, Math.min(1, value)) });
}

async function decodeAudio(file: File): Promise<AudioBuffer> {
  const context = new AudioContext();
  try {
    return await context.decodeAudioData(await file.arrayBuffer());
  } finally {
    await context.close().catch(() => undefined);
  }
}

async function resampleToMono(buffer: AudioBuffer): Promise<AudioBuffer> {
  if (buffer.sampleRate === MODEL_SAMPLE_RATE && buffer.numberOfChannels === 1) return buffer;

  const frameCount = Math.max(1, Math.ceil(buffer.duration * MODEL_SAMPLE_RATE));
  const offline = new OfflineAudioContext(1, frameCount, MODEL_SAMPLE_RATE);
  const source = offline.createBufferSource();
  source.buffer = buffer;
  source.connect(offline.destination);
  source.start();
  return offline.startRendering();
}

function modelUrl() {
  return new URL("./basic-pitch/model.json", document.baseURI).href;
}

function toNoteEvents(notes: Array<{
  startTimeSeconds: number;
  durationSeconds: number;
  pitchMidi: number;
  amplitude: number;
}>): NoteEvent[] {
  return notes
    .map((note) => ({
      pitch: Math.round(note.pitchMidi),
      start: Math.max(0, Math.round(note.startTimeSeconds * 1000)),
      duration: Math.max(20, Math.round(note.durationSeconds * 1000)),
      velocity: Math.max(0, Math.min(1, note.amplitude))
    }))
    .filter((note) => note.pitch >= 21 && note.pitch <= 108 && Number.isFinite(note.start) && Number.isFinite(note.duration))
    .sort((a, b) => a.start - b.start || b.pitch - a.pitch);
}

export async function parseAudioFile(
  file: File,
  onProgress?: AudioParseProgressCallback
): Promise<ParsedSong> {
  if (file.size > MAX_AUDIO_BYTES) {
    throw new Error("音频实验版暂限制单文件 40 MB，建议先截取较短片段测试。");
  }

  report(onProgress, "正在解码音频", 0.03);
  const decoded = await decodeAudio(file);
  if (decoded.duration > MAX_AUDIO_SECONDS) {
    throw new Error("音频实验版暂限制 12 分钟以内，建议先截取片段测试。");
  }

  report(onProgress, "正在转换为 22.05 kHz 单声道", 0.1);
  const prepared = await resampleToMono(decoded);

  report(onProgress, "正在加载轻量音高模型", 0.16);
  const {
    BasicPitch,
    addPitchBendsToNoteEvents,
    noteFramesToTime,
    outputToNotesPoly
  } = await import("@spotify/basic-pitch");

  const frames: number[][] = [];
  const onsets: number[][] = [];
  const contours: number[][] = [];
  const engine = new BasicPitch(modelUrl());

  await engine.evaluateModel(
    prepared,
    (frameChunk, onsetChunk, contourChunk) => {
      frames.push(...frameChunk);
      onsets.push(...onsetChunk);
      contours.push(...contourChunk);
    },
    (percent) => report(onProgress, "AI 正在识别音符", 0.18 + percent * 0.72)
  );

  report(onProgress, "正在整理音符事件", 0.93);
  const detected = noteFramesToTime(
    addPitchBendsToNoteEvents(
      contours,
      outputToNotesPoly(frames, onsets, 0.25, 0.25, 5)
    )
  );
  const notes = toNoteEvents(detected);

  if (notes.length === 0) {
    throw new Error("没有识别到稳定音符。可以换一个更清晰的独奏、清唱或提高音量后再试。");
  }

  report(onProgress, "音频转录完成", 1);
  const title = file.name.replace(/\.[^.]+$/, "") || "Audio transcription";

  return {
    name: title,
    bpm: FALLBACK_BPM,
    duration: Math.round(decoded.duration * 1000),
    ppq: 480,
    sourceFormat: "audio",
    tempos: [{ beat: 0, time: 0, bpm: FALLBACK_BPM }],
    timeSignatures: [{ beat: 0, numerator: 4, denominator: 4 }],
    measureStarts: [],
    tracks: [{
      id: "audio-basic-pitch",
      name: "Audio Transcription",
      channel: 0,
      instrument: "Basic Pitch · mixed audio",
      notes
    }]
  };
}
