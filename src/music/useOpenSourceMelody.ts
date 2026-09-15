import { useEffect, useRef, useState } from 'react';
import type { NoteEvent } from './types';
import type { OpenSourceAlgorithm, MelodyWorkerMessage } from './openSourceTypes';

type Result = Extract<MelodyWorkerMessage, { type: 'result' }>;
interface State {
  notes: NoteEvent[];
  algorithm: OpenSourceAlgorithm;
  bpm: number;
  result?: Result;
  progress?: string;
  error?: string;
}

export function useOpenSourceMelody(notes: NoteEvent[], bpm: number, algorithm: OpenSourceAlgorithm | null) {
  const [state, setState] = useState<State | null>(null);
  const cache = useRef(new WeakMap<NoteEvent[], Map<string, Result>>());
  useEffect(() => {
    if (!algorithm || !notes.length) return;
    const key = `${algorithm}:${bpm}`;
    const cached = cache.current.get(notes)?.get(key);
    if (cached) { setState({ notes, bpm, algorithm, result: cached }); return; }
    setState({ notes, bpm, algorithm, progress: '正在准备算法…' });
    const worker = new Worker(new URL('./melody.worker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = (event: MessageEvent<MelodyWorkerMessage>) => {
      const message = event.data;
      if (message.type === 'result') {
        const entries = cache.current.get(notes) ?? new Map<string, Result>();
        entries.set(key, message);
        cache.current.set(notes, entries);
        setState({ notes, bpm, algorithm, result: message });
        worker.terminate();
      } else if (message.type === 'progress') {
        setState({ notes, bpm, algorithm, progress: message.message });
      } else {
        setState({ notes, bpm, algorithm, error: message.message });
        worker.terminate();
      }
    };
    worker.onerror = (event) => {
      setState({ notes, bpm, algorithm, error: event.message || '算法运行失败，请切换原版重试' });
      worker.terminate();
    };
    worker.postMessage({ algorithm, notes, bpm, baseUrl: new URL('.', document.baseURI).href });
    // Switching tracks/modes cancels both the computation and any stale result.
    return () => worker.terminate();
  }, [notes, bpm, algorithm]);
  const current = state?.notes === notes && state.algorithm === algorithm && state.bpm === bpm ? state : null;
  return { result: current?.result, error: current?.error,
    progress: current?.progress ?? (algorithm && notes.length ? '正在准备算法…' : ''),
    pending: Boolean(algorithm && notes.length && !current?.result && !current?.error) };
}
