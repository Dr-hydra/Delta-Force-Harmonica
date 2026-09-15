import * as tf from '@tensorflow/tfjs';
import type { NoteEvent } from './types';

export interface SymbolicWeights {
  first: tf.Tensor4D;
  second: tf.Tensor4D;
  switch: boolean;
}

/** Port of the pretrained Lasagne CNN, including InverseLayer's Jacobian.
 * The inverse of the sigmoid convolution is J^T * incoming, not just a
 * transposed convolution. Weights are tied to the two forward convolutions.
 * Upstream: LIMUNIMI/Symbolic-Melody-Identification, MIT (see public/licenses).
 */
export function predictWindow(input: tf.Tensor4D, weights: SymbolicWeights): tf.Tensor4D {
  return tf.tidy(() => {
    const first = tf.conv2d(input, weights.first, 1, 'valid');
    const second = tf.sigmoid(tf.conv2d(first, weights.second, 1, 'valid'));
    const gradient = second.mul(second).mul(tf.scalar(1).sub(second)) as tf.Tensor4D;
    const inverseSecond = tf.conv2dTranspose(gradient, weights.second, first.shape, 1, 'valid');
    const output = tf.sigmoid(tf.conv2dTranspose(inverseSecond, weights.first, input.shape, 1, 'valid'));
    return input.mul(weights.switch ? tf.scalar(1).sub(output) : output) as tf.Tensor4D;
  });
}

// Match NumPy's ties-to-even rounding used by the training piano rolls.
export function roundFrame(value: number): number {
  const floor = Math.floor(value);
  return value - floor === 0.5 ? floor + floor % 2 : Math.round(value);
}

export async function identifyMelody(notes: NoteEvent[], bpm: number, baseUrl: string,
  progress: (message: string) => void): Promise<number[]> {
  if (!notes.length) return [];
  progress('正在加载 CNN 主旋律模型…');
  try {
    if (!await tf.setBackend('webgl')) await tf.setBackend('cpu');
  } catch { await tf.setBackend('cpu'); }
  await tf.ready();
  const [metadataResponse, weightsResponse] = await Promise.all([
    fetch(new URL('melody/symbolic-pop.json', baseUrl)),
    fetch(new URL('melody/symbolic-pop.data', baseUrl))
  ]);
  if (!metadataResponse.ok || !weightsResponse.ok) throw new Error('CNN 模型文件加载失败');
  const metadata: { shapes: [number, number, number, number][]; switch: boolean } = await metadataResponse.json();
  const buffer = new Float32Array(await weightsResponse.arrayBuffer());
  const size = metadata.shapes[0].reduce((a, b) => a * b, 1);
  const weights: SymbolicWeights = {
    first: tf.tensor4d(buffer.slice(0, size), metadata.shapes[0]),
    second: tf.tensor4d(buffer.slice(size), metadata.shapes[1]),
    switch: metadata.switch
  };
  try {
    const beatMs = 60000 / (bpm > 0 ? bpm : 120);
    const positions = notes.map((note) => {
      const beat = note.beat ?? note.start / beatMs;
      const duration = note.durationBeats ?? note.duration / beatMs;
      const start = Math.max(0, roundFrame(beat * 8));
      return { pitch: note.pitch, start, end: Math.max(start + 1, roundFrame((beat + duration) * 8) - 1) };
    });
    const frames = positions.reduce((end, note) => Math.max(end, note.end), 1);
    if (frames > 131072) throw new Error('曲目过长，请截取片段后运行 CNN 主旋律识别');
    // Only the model's grid is quantized. Original note onsets and durations
    // remain untouched when probabilities are mapped back to the input notes.
    const sums = new Float32Array(128 * frames);
    const counts = new Uint8Array(frames);
    for (let start = -32; start < frames; start += 32) {
      progress(`CNN 正在识别主旋律 ${Math.round((start + 32) / (frames + 32) * 100)}%`);
      const data = new Float32Array(128 * 64);
      for (const note of positions) {
        if (!Number.isInteger(note.pitch) || note.pitch < 0 || note.pitch > 127) continue;
        const left = Math.max(0, note.start - start);
        const right = Math.min(64, note.end - start);
        if (right > left) data.fill(1, note.pitch * 64 + left, note.pitch * 64 + right);
      }
      const input = tf.tensor4d(data, [1, 128, 64, 1]);
      const prediction = predictWindow(input, weights);
      let values: Float32Array | Int32Array | Uint8Array;
      try { values = await prediction.data(); }
      finally { input.dispose(); prediction.dispose(); }
      for (let local = 0; local < 64; local += 1) {
        const frame = start + local;
        if (frame < 0 || frame >= frames) continue;
        counts[frame] += 1;
        for (let pitch = 0; pitch < 128; pitch += 1) sums[pitch * frames + frame] += values[pitch * 64 + local];
      }
    }
    return positions.map((note) => {
      if (!Number.isInteger(note.pitch) || note.pitch < 0 || note.pitch > 127) return 0;
      const values: number[] = [];
      for (let frame = note.start; frame < note.end; frame += 1) {
        values.push(sums[note.pitch * frames + frame] / Math.max(1, counts[frame]));
      }
      values.sort((a, b) => a - b);
      const middle = Math.floor(values.length / 2);
      return values.length % 2 ? values[middle] : (values[middle - 1] + values[middle]) / 2;
    });
  } finally { weights.first.dispose(); weights.second.dispose(); }
}
