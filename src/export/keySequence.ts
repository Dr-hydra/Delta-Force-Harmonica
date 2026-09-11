import type { GameNote, HarmonicaKey } from "../music/types";

export type MouseButton = "left" | "middle" | "right";

/** A single physical input: either a keyboard key or a mouse button. */
export type InputTarget =
  | { kind: "key"; name: string }
  | { kind: "mouse"; button: MouseButton };

export const key = (name: string): InputTarget => ({ kind: "key", name });
export const mouse = (button: MouseButton): InputTarget => ({ kind: "mouse", button });

export function targetId(target: InputTarget): string {
  return target.kind === "key" ? `key:${target.name}` : `mouse:${target.button}`;
}

export function targetLabel(target: InputTarget): string {
  if (target.kind === "key") return target.name;
  return target.button === "left" ? "左键" : target.button === "right" ? "右键" : "中键";
}

/**
 * Physical inputs the game listens on. The eight note keys come from the in-game
 * UI; the three modifiers are mouse buttons.
 */
export interface InputBinding {
  notes: Record<HarmonicaKey, InputTarget>;
  octaveUp: InputTarget;
  octaveDown: InputTarget;
  semitone: InputTarget;
}

export const GAME_BINDING: InputBinding = {
  notes: {
    Z: key("z"), X: key("x"), C: key("c"), V: key("v"),
    B: key("b"), N: key("n"), M: key("m"), ",": key("comma")
  },
  octaveUp: mouse("right"),
  octaveDown: mouse("left"),
  semitone: mouse("middle")
};

export interface InputAction {
  /** Milliseconds from the start of the sequence. */
  time: number;
  target: InputTarget;
  down: boolean;
}

export interface KeySequenceOptions {
  binding?: InputBinding;
  /** Modifiers go down this early so the game registers them before the note. */
  modifierLeadMs?: number;
  /** Notes are released early by this much so a repeated pitch retriggers. */
  releaseGapMs?: number;
  minNoteMs?: number;
}

export interface KeySequence {
  actions: InputAction[];
  durationMs: number;
  binding: InputBinding;
  noteCount: number;
  /** Simultaneous notes beyond the first, dropped because a tab line is monophonic. */
  droppedChordNotes: number;
  /** Notes cut short because the next note started before they ended. */
  truncatedNotes: number;
  modifierPresses: number;
}

const DEFAULTS = { modifierLeadMs: 12, releaseGapMs: 18, minNoteMs: 30 };

function modifierTargets(note: GameNote, binding: InputBinding): InputTarget[] {
  const targets: InputTarget[] = [];
  if (note.octaveModifier > 0) targets.push(binding.octaveUp);
  else if (note.octaveModifier < 0) targets.push(binding.octaveDown);
  if (note.sharp) targets.push(binding.semitone);
  return targets;
}

/**
 * Flattens optimized notes into an absolute-time press/release stream. Modifiers
 * are held across consecutive notes that need the same ones, so the optimizer's
 * work on minimising modifier changes carries through to the macro.
 */
export function buildKeySequence(notes: GameNote[], options: KeySequenceOptions = {}): KeySequence {
  const binding = options.binding ?? GAME_BINDING;
  const leadMs = options.modifierLeadMs ?? DEFAULTS.modifierLeadMs;
  const releaseGapMs = options.releaseGapMs ?? DEFAULTS.releaseGapMs;
  const minNoteMs = options.minNoteMs ?? DEFAULTS.minNoteMs;

  const sorted = [...notes].sort((a, b) => a.start - b.start || b.pitch - a.pitch);
  const actions: InputAction[] = [];
  let held: InputTarget[] = [];
  let lastTime = 0;
  let noteCount = 0;
  let droppedChordNotes = 0;
  let truncatedNotes = 0;
  let modifierPresses = 0;

  for (let i = 0; i < sorted.length; i++) {
    const note = sorted[i];
    const previous = sorted[i - 1];
    if (previous && note.start <= previous.start) {
      droppedChordNotes++;
      continue;
    }

    // Only one key can sound at a time, so a note that runs into the next one
    // is cut rather than overlapped.
    let end = note.start + note.duration;
    const next = sorted[i + 1];
    if (next && next.start < end) {
      end = next.start;
      truncatedNotes++;
    }

    const wanted = modifierTargets(note, binding);
    const wantedIds = wanted.map(targetId);
    const heldIds = held.map(targetId);
    const switchTime = Math.max(lastTime, note.start - leadMs);
    for (const target of held) {
      if (!wantedIds.includes(targetId(target))) actions.push({ time: switchTime, target, down: false });
    }
    for (const target of wanted) {
      if (!heldIds.includes(targetId(target))) {
        actions.push({ time: switchTime, target, down: true });
        modifierPresses++;
      }
    }
    held = wanted;

    const noteTarget = binding.notes[note.key];
    const down = Math.max(switchTime, note.start);
    const up = Math.max(down + minNoteMs, end - releaseGapMs);
    actions.push({ time: down, target: noteTarget, down: true });
    actions.push({ time: up, target: noteTarget, down: false });
    lastTime = up;
    noteCount++;
  }

  for (const target of held) actions.push({ time: lastTime, target, down: false });

  // Releases sort before presses at the same instant so an input is never left down.
  actions.sort((a, b) => a.time - b.time || Number(a.down) - Number(b.down));

  return {
    actions,
    durationMs: actions.length ? actions[actions.length - 1].time : 0,
    binding,
    noteCount,
    droppedChordNotes,
    truncatedNotes,
    modifierPresses
  };
}

/** Absolute times converted to the inter-event delays both macro formats use. */
export function toDelays(actions: InputAction[]): Array<InputAction & { delay: number }> {
  let previous = 0;
  return actions.map((action) => {
    const delay = Math.max(0, Math.round(action.time - previous));
    previous = action.time;
    return { ...action, delay };
  });
}

export function bindingTargets(binding: InputBinding): InputTarget[] {
  const seen = new Map<string, InputTarget>();
  for (const target of [...Object.values(binding.notes), binding.octaveUp, binding.octaveDown, binding.semitone]) {
    seen.set(targetId(target), target);
  }
  return [...seen.values()];
}
