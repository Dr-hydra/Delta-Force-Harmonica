import type { NoteEvent } from './types';

export type OpenSourceAlgorithm = 'symbolic';
export interface MelodyRequest {
  algorithm: OpenSourceAlgorithm;
  notes: NoteEvent[];
  bpm: number;
  baseUrl: string;
}
export type MelodyWorkerMessage =
  | { type: 'progress'; message: string }
  | { type: 'result'; probabilities?: number[] }
  | { type: 'error'; message: string };
