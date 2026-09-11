import MusicTempo from "music-tempo";
import type { AudioBeatGrid, NoteEvent } from "../music/types";

/** music-tempo's default hop of 441 samples assumes 44.1 kHz for its 10 ms time step. */
export const BEAT_SAMPLE_RATE = 44100;

/**
 * Beatroot caps detection at 60 / minBeatInterval BPM. The library's own README
 * warns that a high ceiling invites double-tempo answers, and 200 BPM (the
 * default 0.3) does exactly that on ordinary 96-100 BPM material. 180 BPM is
 * high enough for real songs and removes the octave error.
 */
const MIN_BEAT_INTERVAL = 0.333;
const MAX_BEAT_INTERVAL = 1;

/**
 * Beatroot throws when every tempo agent expires without accepting a beat,
 * which soft or sparsely-percussive arrangements do hit. The library's README
 * points at expiryTime for material with near-silence, and a lower peak
 * threshold admits weaker onsets, so relaxed retries are tried before giving up.
 */
const ATTEMPTS = [
  { minBeatInterval: MIN_BEAT_INTERVAL, maxBeatInterval: MAX_BEAT_INTERVAL },
  { minBeatInterval: MIN_BEAT_INTERVAL, maxBeatInterval: MAX_BEAT_INTERVAL, expiryTime: 40 },
  { minBeatInterval: MIN_BEAT_INTERVAL, maxBeatInterval: MAX_BEAT_INTERVAL, expiryTime: 40, peakThreshold: 0.2 },
  { minBeatInterval: MIN_BEAT_INTERVAL, maxBeatInterval: MAX_BEAT_INTERVAL, expiryTime: 60, peakThreshold: 0.1 }
] as const;

/** Single definition lives in music/types so ParsedSong can carry it. */
export type BeatGrid = AudioBeatGrid;

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[sorted.length >> 1];
}

export type BeatFailure =
  | { reason: "too-short" }
  | { reason: "detector-error"; detail: string }
  | { reason: "too-few-beats"; detected: number }
  | { reason: "bad-tempo"; bpm: number };

export type BeatDetection = { ok: true; grid: BeatGrid } | ({ ok: false } & BeatFailure);

export function describeBeatFailure(failure: BeatFailure): string {
  switch (failure.reason) {
    case "too-short":
      return "音频不足 2 秒，无法估算节拍。";
    case "detector-error":
      return `节拍检测出错：${failure.detail}`;
    case "too-few-beats":
      return `只检出 ${failure.detected} 个拍点，不足以构成网格——通常是打击乐太弱或速度不稳。`;
    case "bad-tempo":
      return `估出的速度不可用（${failure.bpm}）。`;
  }
}

/**
 * Beatroot only reports beats, never downbeats, so the beat axis is anchored on
 * the first detected beat extrapolated back past zero. That keeps every note at
 * a non-negative beat position, but it means the bar phase is a guess: bar one
 * may well start on what a listener hears as beat three.
 */
export function detectBeatGrid(samples: Float32Array): BeatDetection {
  if (samples.length < BEAT_SAMPLE_RATE * 2) return { ok: false, reason: "too-short" };

  let detected: number[] = [];
  let bpm = 0;
  let attempt = 0;
  let lastError = "";
  for (; attempt < ATTEMPTS.length; attempt++) {
    try {
      const result = new MusicTempo(samples, ATTEMPTS[attempt]);
      const beats = result.beats.filter((beat) => Number.isFinite(beat));
      const tempo = Number(result.tempo);
      if (beats.length >= 4 && Number.isFinite(tempo) && tempo > 0) {
        detected = beats;
        bpm = tempo;
        break;
      }
      lastError = `拍点太少（${beats.length}）`;
    } catch (reason) {
      // Beatroot throws a bare string, not an Error.
      lastError = reason instanceof Error ? reason.message : String(reason);
    }
  }
  if (detected.length < 4) {
    return lastError.includes("拍点太少")
      ? { ok: false, reason: "too-few-beats", detected: detected.length }
      : { ok: false, reason: "detector-error", detail: lastError };
  }
  if (!Number.isFinite(bpm) || bpm <= 0) return { ok: false, reason: "bad-tempo", bpm };

  const intervals: number[] = [];
  for (let i = 1; i < detected.length; i++) intervals.push(detected[i] - detected[i - 1]);
  const medianInterval = median(intervals);
  if (!(medianInterval > 0)) return { ok: false, reason: "bad-tempo", bpm };

  const head: number[] = [];
  for (let time = detected[0] - medianInterval; time > -medianInterval; time -= medianInterval) {
    head.unshift(time);
  }

  return {
    ok: true,
    grid: { bpm, beats: [...head, ...detected], medianInterval, detectedCount: detected.length, attempt }
  };
}

/**
 * Piecewise-linear position on the beat axis, so a grid that drifts in tempo
 * still maps times correctly instead of assuming one constant BPM.
 */
export function beatAtTime(grid: BeatGrid, seconds: number): number {
  const { beats, medianInterval } = grid;
  if (seconds <= beats[0]) return (seconds - beats[0]) / medianInterval;
  const last = beats.length - 1;
  if (seconds >= beats[last]) return last + (seconds - beats[last]) / medianInterval;

  let low = 0;
  let high = last;
  while (high - low > 1) {
    const mid = (low + high) >> 1;
    if (beats[mid] <= seconds) low = mid;
    else high = mid;
  }
  const span = beats[high] - beats[low];
  return low + (span > 0 ? (seconds - beats[low]) / span : 0);
}

export function timeAtBeat(grid: BeatGrid, beat: number): number {
  const { beats, medianInterval } = grid;
  if (beat <= 0) return beats[0] + beat * medianInterval;
  const last = beats.length - 1;
  if (beat >= last) return beats[last] + (beat - last) * medianInterval;
  const index = Math.floor(beat);
  const fraction = beat - index;
  return beats[index] + (beats[index + 1] - beats[index]) * fraction;
}

/** Fills in beat / durationBeats so the score can lay out real bars. */
export function assignBeats(notes: NoteEvent[], grid: BeatGrid): NoteEvent[] {
  return notes.map((note) => {
    const beat = beatAtTime(grid, note.start / 1000);
    const end = beatAtTime(grid, (note.start + note.duration) / 1000);
    return { ...note, beat: Math.max(0, beat), durationBeats: Math.max(1 / 32, end - beat) };
  });
}

/**
 * Snaps onsets and releases to a subdivision of the beat. Times in milliseconds
 * are rewritten too, so playback and the score agree.
 */
export function quantizeToGrid(notes: NoteEvent[], grid: BeatGrid, subdivisions: number): NoteEvent[] {
  if (subdivisions < 1) return notes;
  const step = 1 / subdivisions;
  const snap = (beat: number) => Math.round(beat / step) * step;

  const out: NoteEvent[] = [];
  for (const note of notes) {
    const rawBeat = beatAtTime(grid, note.start / 1000);
    const rawEnd = beatAtTime(grid, (note.start + note.duration) / 1000);
    let beat = snap(rawBeat);
    let end = snap(rawEnd);
    if (end <= beat) {
      // Anything at least half a cell long is worth keeping as one cell.
      if (rawEnd - rawBeat < step * 0.5) continue;
      end = beat + step;
    }
    if (beat < 0) {
      end -= beat;
      beat = 0;
    }
    const startMs = Math.round(timeAtBeat(grid, beat) * 1000);
    const endMs = Math.round(timeAtBeat(grid, end) * 1000);
    out.push({
      ...note,
      start: Math.max(0, startMs),
      duration: Math.max(20, endMs - startMs),
      beat,
      durationBeats: end - beat
    });
  }
  return out;
}

/** Measure start positions on the beat axis, for ParsedSong.measureStarts. */
export function measureStarts(grid: BeatGrid, beatsPerMeasure: number): number[] {
  if (beatsPerMeasure <= 0) return [];
  const total = grid.beats.length - 1;
  const starts: number[] = [];
  for (let beat = 0; beat <= total; beat += beatsPerMeasure) starts.push(beat);
  return starts;
}
