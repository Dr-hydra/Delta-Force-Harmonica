export type AudioTranscriptionPreset = "solo" | "balanced" | "mix";

export interface AudioPresetConfig {
  label: string;
  description: string;
  onsetThreshold: number;
  frameThreshold: number;
  minNoteFrames: number;
  inferOnsets: boolean;
  minMidi: number;
  maxMidi: number;
  minDurationMs: number;
  minAmplitude: number;
  amplitudeQuantile: number;
  mergeGapMs: number;
  chordWindowMs: number;
  maxChordNotes: number;
}

export const AUDIO_PRESETS: Record<AudioTranscriptionPreset, AudioPresetConfig> = {
  solo: {
    label: "独奏 / 清唱",
    description: "保留更多弱音和装饰音，适合单乐器、清唱与干净录音。",
    onsetThreshold: 0.34,
    frameThreshold: 0.27,
    minNoteFrames: 5,
    inferOnsets: true,
    minMidi: 36,
    maxMidi: 96,
    minDurationMs: 48,
    minAmplitude: 0.12,
    amplitudeQuantile: 0.08,
    mergeGapMs: 58,
    chordWindowMs: 26,
    maxChordNotes: 8
  },
  balanced: {
    label: "标准 / 推荐",
    description: "抑制一部分碎音和弱伴奏，适合作为多数音乐的默认测试档。",
    onsetThreshold: 0.43,
    frameThreshold: 0.3,
    minNoteFrames: 7,
    inferOnsets: true,
    minMidi: 43,
    maxMidi: 90,
    minDurationMs: 72,
    minAmplitude: 0.16,
    amplitudeQuantile: 0.16,
    mergeGapMs: 72,
    chordWindowMs: 32,
    maxChordNotes: 6
  },
  mix: {
    label: "完整混音",
    description: "更强地过滤瞬态、泛音和密集伴奏，适合高品质完整歌曲。",
    onsetThreshold: 0.52,
    frameThreshold: 0.34,
    minNoteFrames: 9,
    inferOnsets: false,
    minMidi: 48,
    maxMidi: 86,
    minDurationMs: 96,
    minAmplitude: 0.2,
    amplitudeQuantile: 0.26,
    mergeGapMs: 86,
    chordWindowMs: 38,
    maxChordNotes: 4
  }
};

export function midiToFrequency(midi: number): number {
  return 440 * 2 ** ((midi - 69) / 12);
}
