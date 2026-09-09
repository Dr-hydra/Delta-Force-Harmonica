import { candidatesForPitch } from "./mapping";
import type { ConversionResult, GameNote, HarmonicaCandidate, NoteEvent } from "../music/types";

interface State {
  candidate: HarmonicaCandidate;
  cost: number;
  previousIndex: number;
}

function localCost(candidate: HarmonicaCandidate): number {
  return (candidate.sharp ? 0.45 : 0) + (candidate.octaveModifier === 0 ? 0 : 0.22);
}

function transitionCost(a: HarmonicaCandidate, b: HarmonicaCandidate): number {
  let cost = Math.abs(a.keyIndex - b.keyIndex) * 0.16;
  if (a.sharp !== b.sharp) cost += 1.9;
  if (a.octaveModifier !== b.octaveModifier) cost += 2.5 * Math.abs(a.octaveModifier - b.octaveModifier);
  return cost;
}

export function optimizeHarmonica(notes: NoteEvent[], transpose = 0): ConversionResult {
  const playable: Array<{ note: NoteEvent; candidates: HarmonicaCandidate[] }> = [];
  const unplayable: NoteEvent[] = [];

  for (const note of notes) {
    const shifted = { ...note, pitch: note.pitch + transpose };
    const candidates = candidatesForPitch(shifted.pitch);
    if (candidates.length === 0) unplayable.push(shifted);
    else playable.push({ note: shifted, candidates });
  }

  if (playable.length === 0) {
    return { notes: [], unplayable, cost: 0, modifierChanges: 0 };
  }

  const layers: State[][] = playable.map((entry, layerIndex) => {
    if (layerIndex === 0) {
      return entry.candidates.map((candidate) => ({
        candidate,
        cost: localCost(candidate),
        previousIndex: -1
      }));
    }

    const previousLayer = layers[layerIndex - 1];
    return entry.candidates.map((candidate) => {
      let bestCost = Number.POSITIVE_INFINITY;
      let bestIndex = 0;

      previousLayer.forEach((previous, previousIndex) => {
        const cost = previous.cost + transitionCost(previous.candidate, candidate) + localCost(candidate);
        if (cost < bestCost) {
          bestCost = cost;
          bestIndex = previousIndex;
        }
      });

      return { candidate, cost: bestCost, previousIndex: bestIndex };
    });
  });

  const lastLayer = layers[layers.length - 1];
  let index = lastLayer.reduce((best, state, i, array) => state.cost < array[best].cost ? i : best, 0);
  const chosen: HarmonicaCandidate[] = new Array(layers.length);

  for (let layer = layers.length - 1; layer >= 0; layer -= 1) {
    const state = layers[layer][index];
    chosen[layer] = state.candidate;
    index = state.previousIndex;
  }

  const gameNotes: GameNote[] = playable.map((entry, i) => ({ ...entry.note, ...chosen[i] }));
  let modifierChanges = 0;
  for (let i = 1; i < gameNotes.length; i += 1) {
    if (gameNotes[i - 1].sharp !== gameNotes[i].sharp) modifierChanges += 1;
    if (gameNotes[i - 1].octaveModifier !== gameNotes[i].octaveModifier) modifierChanges += 1;
  }

  const minCost = Math.min(...lastLayer.map((state) => state.cost));
  return { notes: gameNotes, unplayable, cost: minCost, modifierChanges };
}

export function findBestTranspose(notes: NoteEvent[]): { transpose: number; result: ConversionResult } {
  let best = { transpose: 0, result: optimizeHarmonica(notes, 0), score: Number.POSITIVE_INFINITY };

  for (let transpose = -12; transpose <= 12; transpose += 1) {
    const result = optimizeHarmonica(notes, transpose);
    const score = result.unplayable.length * 10000 + result.cost + Math.abs(transpose) * 0.08;
    if (score < best.score) best = { transpose, result, score };
  }

  return { transpose: best.transpose, result: best.result };
}
