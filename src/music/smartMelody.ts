import type { NoteEvent } from "./types";

interface MelodyCandidate {
  note: NoteEvent;
  localScore: number;
}

const ONSET_GROUP_MS = 36;
const MAX_GROUP_CANDIDATES = 5;
const MAX_PREDECESSORS = 140;
const MAX_LINK_MS = 4500;
const PHRASE_GAP_MS = 2600;

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function localScore(note: NoteEvent, pitchRank: number, groupSize: number): number {
  const velocity = clamp01(note.velocity ?? 0.65);
  const durationScore = clamp01(Math.log2(1 + Math.max(0, note.duration) / 55) / 4.3);
  const registerScore = 1 - clamp01(Math.abs(note.pitch - 69) / 38);
  const shortPenalty = note.duration < 75 ? 0.72 : note.duration < 120 ? 0.28 : 0;
  const densityPenalty = Math.min(0.58, Math.max(0, groupSize - 4) * 0.075);

  return 0.72
    + pitchRank * 1.12
    + durationScore * 0.92
    + velocity * 0.52
    + registerScore * 0.22
    - shortPenalty
    - densityPenalty;
}

function pruneOnsetGroups(notes: NoteEvent[]): MelodyCandidate[] {
  const sorted = [...notes]
    .filter((note) => Number.isFinite(note.start) && Number.isFinite(note.duration) && Number.isFinite(note.pitch))
    .sort((a, b) => a.start - b.start || b.pitch - a.pitch);
  const candidates: MelodyCandidate[] = [];

  for (let index = 0; index < sorted.length;) {
    const start = sorted[index].start;
    const group: NoteEvent[] = [];
    let cursor = index;
    while (cursor < sorted.length && sorted[cursor].start - start <= ONSET_GROUP_MS) {
      group.push(sorted[cursor]);
      cursor += 1;
    }

    const byPitch = [...group].sort((a, b) => a.pitch - b.pitch);
    const scored = group.map((note) => {
      const rankIndex = byPitch.findIndex((candidate) => candidate === note);
      const pitchRank = byPitch.length <= 1 ? 0.58 : rankIndex / (byPitch.length - 1);
      return { note, localScore: localScore(note, pitchRank, group.length) };
    });

    scored
      .sort((a, b) => b.localScore - a.localScore || b.note.pitch - a.note.pitch)
      .slice(0, MAX_GROUP_CANDIDATES)
      .forEach((candidate) => candidates.push(candidate));

    index = cursor;
  }

  return candidates.sort((a, b) => a.note.start - b.note.start || b.note.pitch - a.note.pitch);
}

function transitionScore(a: NoteEvent, b: NoteEvent): number {
  const onsetGap = b.start - a.start;
  if (onsetGap < 45) return Number.NEGATIVE_INFINITY;

  const aEnd = a.start + a.duration;
  const overlap = Math.max(0, aEnd - b.start);
  const silence = Math.max(0, b.start - aEnd);
  const jump = Math.abs(b.pitch - a.pitch);
  let score = -0.56;

  if (overlap > 120) score -= Math.min(3.8, overlap / 210);
  else if (overlap > 0) score -= overlap / 310;

  if (silence <= 85) score += 0.58;
  else if (silence <= 320) score += 0.26 - silence / 1500;
  else score -= Math.min(2.45, (silence - 320) / 900);

  if (jump <= 2) score += 0.84;
  else if (jump <= 5) score += 0.52;
  else if (jump <= 7) score += 0.24;
  else if (jump <= 12) score -= (jump - 7) * 0.14;
  else score -= 0.95 + (jump - 12) * 0.12;

  if (onsetGap < 90) score -= 2.2;
  else if (onsetGap < 135) score -= 0.82;

  if (jump === 0 && onsetGap < 190) score -= 0.32;
  return score;
}

function bestPathForSegment(segment: MelodyCandidate[]): NoteEvent[] {
  if (segment.length === 0) return [];
  if (segment.length === 1) return [{ ...segment[0].note }];

  const dp = new Array<number>(segment.length).fill(Number.NEGATIVE_INFINITY);
  const previous = new Array<number>(segment.length).fill(-1);

  for (let j = 0; j < segment.length; j += 1) {
    dp[j] = segment[j].localScore - 0.18;
    let inspected = 0;

    for (let i = j - 1; i >= 0 && inspected < MAX_PREDECESSORS; i -= 1) {
      const delta = segment[j].note.start - segment[i].note.start;
      if (delta > MAX_LINK_MS) break;
      inspected += 1;
      const transition = transitionScore(segment[i].note, segment[j].note);
      if (!Number.isFinite(transition)) continue;
      const candidateScore = dp[i] + segment[j].localScore + transition;
      if (candidateScore > dp[j]) {
        dp[j] = candidateScore;
        previous[j] = i;
      }
    }
  }

  let bestIndex = 0;
  for (let index = 1; index < dp.length; index += 1) {
    const tailBonus = segment[index].note.start / Math.max(1, segment[segment.length - 1].note.start) * 0.12;
    const bestTailBonus = segment[bestIndex].note.start / Math.max(1, segment[segment.length - 1].note.start) * 0.12;
    if (dp[index] + tailBonus > dp[bestIndex] + bestTailBonus) bestIndex = index;
  }

  const path: NoteEvent[] = [];
  for (let cursor = bestIndex; cursor >= 0; cursor = previous[cursor]) {
    path.push({ ...segment[cursor].note });
    if (previous[cursor] < 0) break;
  }
  return path.reverse();
}

function normalizeMonophonic(notes: NoteEvent[]): NoteEvent[] {
  const result: NoteEvent[] = [];
  for (const source of notes.sort((a, b) => a.start - b.start || b.pitch - a.pitch)) {
    const note = { ...source };
    const previous = result[result.length - 1];

    if (previous && previous.pitch === note.pitch) {
      const gap = note.start - (previous.start + previous.duration);
      if (gap <= 90) {
        const end = Math.max(previous.start + previous.duration, note.start + note.duration);
        previous.duration = Math.max(1, end - previous.start);
        previous.velocity = Math.max(previous.velocity ?? 0, note.velocity ?? 0);
        continue;
      }
    }

    if (previous && previous.start + previous.duration > note.start) {
      previous.duration = Math.max(1, note.start - previous.start);
      if (previous.beat !== undefined && note.beat !== undefined) {
        previous.durationBeats = Math.max(1 / 96, note.beat - previous.beat);
      }
    }
    result.push(note);
  }
  return result;
}

/**
 * Heuristic melody extraction for browser use. It keeps several candidates per
 * onset group and searches for a globally coherent voice-leading path instead
 * of selecting the highest note independently at every chord.
 */
export function extractSmartMelody(notes: NoteEvent[]): NoteEvent[] {
  if (notes.length <= 1) return notes.map((note) => ({ ...note }));
  const candidates = pruneOnsetGroups(notes);
  if (candidates.length <= 1) return candidates.map((candidate) => ({ ...candidate.note }));

  const segments: MelodyCandidate[][] = [];
  let current: MelodyCandidate[] = [];
  let previousStart = candidates[0].note.start;

  for (const candidate of candidates) {
    if (current.length > 0 && candidate.note.start - previousStart > PHRASE_GAP_MS) {
      segments.push(current);
      current = [];
    }
    current.push(candidate);
    previousStart = candidate.note.start;
  }
  if (current.length > 0) segments.push(current);

  return normalizeMonophonic(segments.flatMap(bestPathForSegment));
}
