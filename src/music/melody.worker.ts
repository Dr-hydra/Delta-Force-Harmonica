import type { MelodyRequest, MelodyWorkerMessage } from './openSourceTypes';

function post(message: MelodyWorkerMessage) { self.postMessage(message); }

self.onmessage = async (event: MessageEvent<MelodyRequest>) => {
  try {
    const request = event.data;
    const { identifyMelody } = await import('./symbolicMelody');
    post({ type: 'result', probabilities: await identifyMelody(request.notes, request.bpm, request.baseUrl,
      (message) => post({ type: 'progress', message })) });
  } catch (error) {
    post({ type: 'error', message: error instanceof Error ? error.message : String(error) });
  }
};
