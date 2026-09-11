export type AudioTranscriptionPreset = "solo" | "balanced" | "ensemble";

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

/**
 * The three tiers are defined by the shortest note they keep, because that is
 * what separates a melody from busy accompaniment far more reliably than
 * amplitude or register does. Measured on synthetic instrumental fixtures with
 * ground-truth melodies (clean solo / light backing / dense ensemble / a high
 * arpeggio crossing above the melody / a sixteenth-note melody); the tradeoff
 * curve is in docs/AUDIO_PRESETS.md.
 *
 * Note that minNoteFrames (a decode-time frame count, ~11.6 ms per frame) and
 * minDurationMs (a post-decode filter) stack. Pushing both up deletes real
 * melody, so minDurationMs stays just under the frame floor it pairs with.
 */
export const AUDIO_PRESETS: Record<AudioTranscriptionPreset, AudioPresetConfig> = {
  solo: {
    label: "独奏 / 单声部",
    description: "最短音符约 60 ms，保留碎音和装饰音。适合单乐器、单声部的干净录音；伴奏一密就会跟错声部。",
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
    description: "最短音符约 140 ms。多数纯伴奏用这一档，实测均值与最差情况都最好。",
    onsetThreshold: 0.46,
    frameThreshold: 0.34,
    minNoteFrames: 12,
    inferOnsets: false,
    minMidi: 45,
    maxMidi: 88,
    minDurationMs: 110,
    minAmplitude: 0.14,
    amplitudeQuantile: 0,
    mergeGapMs: 86,
    chordWindowMs: 38,
    maxChordNotes: 4
  },
  ensemble: {
    label: "长音优先",
    description: "最短音符约 200 ms，短音全部丢弃。编配厚、有密集琶音时最稳，但会删掉真正的十六分音符。",
    onsetThreshold: 0.46,
    frameThreshold: 0.34,
    minNoteFrames: 17,
    inferOnsets: false,
    minMidi: 45,
    maxMidi: 88,
    minDurationMs: 190,
    minAmplitude: 0.14,
    amplitudeQuantile: 0,
    mergeGapMs: 86,
    chordWindowMs: 38,
    maxChordNotes: 4
  }
};

export function midiToFrequency(midi: number): number {
  return 440 * 2 ** ((midi - 69) / 12);
}
