/**
 * Key timing tiers shared by the macro exports and the desktop player.
 *
 * The game samples input once per frame. A modifier that changes in the same
 * frame as its note sounds the wrong pitch; a key pressed in the frame the
 * previous one was released is missed. The three floors below are therefore
 * physical milliseconds sized in frames, not musical values, and the tier picks
 * how many frames of margin to leave. The desktop app (desktop/DFH.Core/Export/
 * KeySequence.cs) carries the same table; keep both in sync.
 */
export type TimingTierId = "safe" | "standard" | "aggressive";

export interface KeyTiming {
  /** Modifiers go down this early so the game registers them before the note. */
  modifierLeadMs: number;
  /** A key is released this early, and the next key waits this long after a release. */
  releaseGapMs: number;
  /** Shortest hold, so press and release never land in one frame. */
  minNoteMs: number;
}

export interface TimingTier {
  id: TimingTierId;
  label: string;
  hint: string;
  timing: KeyTiming;
}

export const TIMING_TIERS: readonly TimingTier[] = [
  { id: "safe", label: "稳健", hint: "30 fps / 卡顿机器", timing: { modifierLeadMs: 70, releaseGapMs: 70, minNoteMs: 80 } },
  { id: "standard", label: "标准", hint: "60 fps，推荐", timing: { modifierLeadMs: 40, releaseGapMs: 40, minNoteMs: 45 } },
  { id: "aggressive", label: "极限", hint: "高帧率，跟快歌", timing: { modifierLeadMs: 20, releaseGapMs: 18, minNoteMs: 22 } }
] as const;

export const DEFAULT_TIMING_TIER: TimingTierId = "standard";
export const DEFAULT_TIMING: KeyTiming = TIMING_TIERS.find((tier) => tier.id === DEFAULT_TIMING_TIER)!.timing;

const STORAGE_KEY = "dfh-key-timing";

export function isTimingTierId(value: unknown): value is TimingTierId {
  return TIMING_TIERS.some((tier) => tier.id === value);
}

export function timingTier(id: TimingTierId): TimingTier {
  return TIMING_TIERS.find((tier) => tier.id === id) ?? TIMING_TIERS.find((tier) => tier.id === DEFAULT_TIMING_TIER)!;
}

/** The tier describes the player's machine, not one score, so it persists like the macro trigger keys. */
export function loadTimingTier(): TimingTierId {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    return isTimingTierId(stored) ? stored : DEFAULT_TIMING_TIER;
  } catch {
    return DEFAULT_TIMING_TIER;
  }
}

export function saveTimingTier(id: TimingTierId) {
  try {
    localStorage.setItem(STORAGE_KEY, id);
  } catch {
    // Private-mode storage failures must not break exporting.
  }
}
