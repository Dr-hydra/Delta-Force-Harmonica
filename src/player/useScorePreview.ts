import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { GameNote } from "../music/types";

const LOOKAHEAD_MS = 3000;
const SCHEDULER_INTERVAL_MS = 180;

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function midiFrequency(pitch: number) {
  return 440 * Math.pow(2, (pitch - 69) / 12);
}

function firstAudibleIndex(notes: GameNote[], fromMs: number) {
  for (let index = 0; index < notes.length; index += 1) {
    if (notes[index].start + notes[index].duration > fromMs) return index;
  }
  return notes.length;
}

export function useScorePreview(notes: GameNote[]) {
  const duration = useMemo(
    () => notes.reduce((max, note) => Math.max(max, note.start + note.duration), 0),
    [notes]
  );

  const [currentTime, setCurrentTime] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [rate, setRateState] = useState(1);

  const audioContextRef = useRef<AudioContext | null>(null);
  const voicesRef = useRef(new Set<OscillatorNode>());
  const schedulerRef = useRef<number | null>(null);
  const rafRef = useRef<number | null>(null);
  const nextNoteIndexRef = useRef(0);
  const startSongMsRef = useRef(0);
  const startPerformanceMsRef = useRef(0);
  const currentTimeRef = useRef(0);
  const rateRef = useRef(1);
  const playingRef = useRef(false);

  const writeCurrentTime = useCallback((value: number) => {
    currentTimeRef.current = value;
    setCurrentTime(value);
  }, []);

  const songTimeNow = useCallback(() => {
    if (!playingRef.current) return currentTimeRef.current;
    const elapsedRealMs = performance.now() - startPerformanceMsRef.current;
    return clamp(startSongMsRef.current + elapsedRealMs * rateRef.current, 0, duration);
  }, [duration]);

  const stopVoices = useCallback(() => {
    for (const voice of voicesRef.current) {
      try {
        voice.stop();
      } catch {
        // A voice that already ended can safely be ignored.
      }
      try {
        voice.disconnect();
      } catch {
        // Already disconnected.
      }
    }
    voicesRef.current.clear();
  }, []);

  const stopSchedulers = useCallback(() => {
    if (schedulerRef.current !== null) {
      window.clearInterval(schedulerRef.current);
      schedulerRef.current = null;
    }
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
  }, []);

  const scheduleAhead = useCallback(() => {
    const context = audioContextRef.current;
    if (!context || !playingRef.current) return;

    const songNow = songTimeNow();
    const horizon = songNow + LOOKAHEAD_MS * rateRef.current;
    let index = nextNoteIndexRef.current;

    while (index < notes.length) {
      const note = notes[index];
      if (note.start > horizon) break;

      const noteEnd = note.start + note.duration;
      if (noteEnd > songNow) {
        const audibleStart = Math.max(note.start, songNow);
        const startDelaySeconds = Math.max(0, (audibleStart - songNow) / 1000 / rateRef.current);
        const durationSeconds = Math.max(0.035, (noteEnd - audibleStart) / 1000 / rateRef.current);
        const startsAt = context.currentTime + 0.025 + startDelaySeconds;
        const endsAt = startsAt + durationSeconds;

        const oscillator = context.createOscillator();
        const gain = context.createGain();
        const velocity = clamp(note.velocity ?? 0.75, 0.15, 1);
        const level = 0.025 + velocity * 0.045;
        const attack = Math.min(0.012, durationSeconds * 0.18);
        const release = Math.min(0.045, durationSeconds * 0.25);

        oscillator.type = "triangle";
        oscillator.frequency.setValueAtTime(midiFrequency(note.pitch), startsAt);
        gain.gain.setValueAtTime(0.0001, startsAt);
        gain.gain.linearRampToValueAtTime(level, startsAt + attack);
        gain.gain.setValueAtTime(level, Math.max(startsAt + attack, endsAt - release));
        gain.gain.linearRampToValueAtTime(0.0001, endsAt);

        oscillator.connect(gain);
        gain.connect(context.destination);
        voicesRef.current.add(oscillator);
        oscillator.onended = () => {
          voicesRef.current.delete(oscillator);
          try {
            oscillator.disconnect();
            gain.disconnect();
          } catch {
            // Nodes may already have been disconnected by pause/seek.
          }
        };
        oscillator.start(startsAt);
        oscillator.stop(endsAt + 0.01);
      }

      index += 1;
    }

    nextNoteIndexRef.current = index;
  }, [notes, songTimeNow]);

  const tick = useCallback(function frame() {
    if (!playingRef.current) return;
    const now = songTimeNow();
    writeCurrentTime(now);

    if (duration <= 0 || now >= duration - 1) {
      playingRef.current = false;
      setPlaying(false);
      stopSchedulers();
      stopVoices();
      writeCurrentTime(duration);
      return;
    }

    rafRef.current = requestAnimationFrame(frame);
  }, [duration, songTimeNow, stopSchedulers, stopVoices, writeCurrentTime]);

  const begin = useCallback(async (fromMs: number) => {
    if (notes.length === 0 || duration <= 0) return;

    const normalized = clamp(fromMs >= duration - 1 ? 0 : fromMs, 0, duration);
    let context = audioContextRef.current;
    if (!context) {
      context = new AudioContext();
      audioContextRef.current = context;
    }
    await context.resume();

    stopSchedulers();
    stopVoices();
    nextNoteIndexRef.current = firstAudibleIndex(notes, normalized);
    startSongMsRef.current = normalized;
    startPerformanceMsRef.current = performance.now();
    playingRef.current = true;
    setPlaying(true);
    writeCurrentTime(normalized);

    scheduleAhead();
    schedulerRef.current = window.setInterval(scheduleAhead, SCHEDULER_INTERVAL_MS);
    rafRef.current = requestAnimationFrame(tick);
  }, [duration, notes, scheduleAhead, stopSchedulers, stopVoices, tick, writeCurrentTime]);

  const pause = useCallback(() => {
    if (!playingRef.current) return;
    const now = songTimeNow();
    playingRef.current = false;
    setPlaying(false);
    stopSchedulers();
    stopVoices();
    writeCurrentTime(now);
  }, [songTimeNow, stopSchedulers, stopVoices, writeCurrentTime]);

  const toggle = useCallback(() => {
    if (playingRef.current) pause();
    else void begin(currentTimeRef.current);
  }, [begin, pause]);

  const seek = useCallback((value: number) => {
    const target = clamp(value, 0, duration);
    if (playingRef.current) void begin(target);
    else writeCurrentTime(target);
  }, [begin, duration, writeCurrentTime]);

  const restart = useCallback(() => {
    if (playingRef.current) void begin(0);
    else writeCurrentTime(0);
  }, [begin, writeCurrentTime]);

  const setRate = useCallback((next: number) => {
    const safe = clamp(next, 0.5, 1.5);
    const resumeAt = songTimeNow();
    rateRef.current = safe;
    setRateState(safe);
    if (playingRef.current) void begin(resumeAt);
  }, [begin, songTimeNow]);

  useEffect(() => {
    playingRef.current = false;
    setPlaying(false);
    stopSchedulers();
    stopVoices();
    nextNoteIndexRef.current = 0;
    writeCurrentTime(0);
  }, [notes, stopSchedulers, stopVoices, writeCurrentTime]);

  useEffect(() => () => {
    playingRef.current = false;
    stopSchedulers();
    stopVoices();
    const context = audioContextRef.current;
    if (context && context.state !== "closed") void context.close();
  }, [stopSchedulers, stopVoices]);

  const activeIndex = useMemo(() => {
    if (notes.length === 0) return -1;
    let low = 0;
    let high = notes.length - 1;
    let candidate = -1;

    while (low <= high) {
      const middle = Math.floor((low + high) / 2);
      if (notes[middle].start <= currentTime) {
        candidate = middle;
        low = middle + 1;
      } else {
        high = middle - 1;
      }
    }

    if (candidate < 0) return -1;
    const note = notes[candidate];
    return currentTime <= note.start + note.duration + 18 ? candidate : -1;
  }, [currentTime, notes]);

  return {
    activeIndex,
    currentNote: activeIndex >= 0 ? notes[activeIndex] : null,
    currentTime,
    duration,
    playing,
    rate,
    restart,
    seek,
    setRate,
    toggle
  };
}
