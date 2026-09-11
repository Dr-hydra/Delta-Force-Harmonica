import type { HarmonicaCandidate, HarmonicaKey } from "../music/types";

/** Middle C is used as the provisional 1. Replace this after in-game testing. */
export const ROOT_MIDI = 60;

interface BaseKey {
  key: HarmonicaKey;
  degree: 1 | 2 | 3 | 4 | 5 | 6 | 7;
  semitone: number;
  intrinsicOctave: number;
  keyIndex: number;
}

export const BASE_KEYS: readonly BaseKey[] = [
  { key: "Z", degree: 1, semitone: 0, intrinsicOctave: 0, keyIndex: 0 },
  { key: "X", degree: 2, semitone: 2, intrinsicOctave: 0, keyIndex: 1 },
  { key: "C", degree: 3, semitone: 4, intrinsicOctave: 0, keyIndex: 2 },
  { key: "V", degree: 4, semitone: 5, intrinsicOctave: 0, keyIndex: 3 },
  { key: "B", degree: 5, semitone: 7, intrinsicOctave: 0, keyIndex: 4 },
  { key: "N", degree: 6, semitone: 9, intrinsicOctave: 0, keyIndex: 5 },
  { key: "M", degree: 7, semitone: 11, intrinsicOctave: 0, keyIndex: 6 },
  { key: ",", degree: 1, semitone: 12, intrinsicOctave: 1, keyIndex: 7 }
] as const;

export const MAPPING_ASSUMPTIONS = [
  "Z X C V B N M , 对应 1 2 3 4 5 6 7 高音1",
  "升调 = 鼠标右键，降调 = 鼠标左键，半音 = 鼠标中键",
  "升调 / 降调暂按 ±1 八度处理，半音暂按升半音（#）处理",
  "暂定八度修饰与半音修饰可同时按住"
] as const;

const OCTAVE_MODIFIERS = [-1, 0, 1] as const;

export function candidatesForPitch(pitch: number): HarmonicaCandidate[] {
  const candidates: HarmonicaCandidate[] = [];

  for (const base of BASE_KEYS) {
    for (const octaveModifier of OCTAVE_MODIFIERS) {
      for (const sharp of [false, true] as const) {
        const resultingPitch = ROOT_MIDI + base.semitone + octaveModifier * 12 + (sharp ? 1 : 0);
        if (resultingPitch !== pitch) continue;

        candidates.push({
          key: base.key,
          degree: base.degree,
          keyIndex: base.keyIndex,
          intrinsicOctave: base.intrinsicOctave,
          octaveModifier,
          sharp,
          pitch: resultingPitch
        });
      }
    }
  }

  return candidates;
}

export function displayOctave(candidate: HarmonicaCandidate): number {
  return candidate.intrinsicOctave + candidate.octaveModifier;
}

export function midiName(pitch: number): string {
  const names = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
  return `${names[pitch % 12]}${Math.floor(pitch / 12) - 1}`;
}
