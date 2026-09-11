import { bindingTargets, targetLabel, toDelays, type InputTarget, type KeySequence } from "./keySequence";

export interface LogitechOptions {
  songName: string;
  /**
   * Physical input that starts playback. G HUB Lua only dispatches events for
   * G-keys and mouse buttons, so an ordinary keyboard key such as F10 can never
   * be used here.
   */
  trigger?: LogitechTrigger;
  /** Lock key turned on to abort. Polled because Sleep blocks the event thread. */
  stopLock?: StopLock;
  transpose?: number;
}

export type TriggerSource = "mouse" | "gkey";

export interface LogitechTrigger {
  source: TriggerSource;
  value: number;
}

/** Lock keys readable through IsKeyLockOn, the only interrupt Sleep cannot block. */
export type StopLock = "capslock" | "scrolllock" | "numlock";

export const TRIGGER_DEFAULT: LogitechTrigger = { source: "mouse", value: 4 };

/** G HUB's assignment list exposes 20 mouse buttons and 18 G keys. */
export const TRIGGER_MAX: Record<TriggerSource, number> = { mouse: 20, gkey: 18 };

export const STOP_LOCKS: Array<{ id: StopLock; label: string }> = [
  { id: "capslock", label: "Caps Lock" },
  { id: "scrolllock", label: "Scroll Lock" },
  { id: "numlock", label: "Num Lock" }
];

const SETTINGS_KEY = "dfh-logitech-settings";

export interface LogitechSettings {
  trigger: LogitechTrigger;
  stopLock: StopLock;
}

export const LOGITECH_SETTINGS_DEFAULT: LogitechSettings = {
  trigger: TRIGGER_DEFAULT,
  stopLock: "capslock"
};

/**
 * The start key and stop lock describe the user's own mouse and keyboard rather
 * than one score, so they are persisted: the score library exports a macro that
 * matches whatever the converter export panel was last configured with.
 */
export function loadLogitechSettings(): LogitechSettings {
  try {
    const parsed = JSON.parse(localStorage.getItem(SETTINGS_KEY) || "") as Partial<LogitechSettings>;
    const source: TriggerSource = parsed.trigger?.source === "gkey" ? "gkey" : TRIGGER_DEFAULT.source;
    const value = Number(parsed.trigger?.value);
    const stopLock = STOP_LOCKS.some((entry) => entry.id === parsed.stopLock)
      ? (parsed.stopLock as StopLock)
      : LOGITECH_SETTINGS_DEFAULT.stopLock;
    return {
      // A stored value outside the source's range would produce a macro whose
      // arg can never fire, so clamp it back to something G HUB can dispatch.
      trigger: {
        source,
        value: Number.isInteger(value) ? Math.min(Math.max(1, value), TRIGGER_MAX[source]) : TRIGGER_DEFAULT.value
      },
      stopLock
    };
  } catch {
    return { ...LOGITECH_SETTINGS_DEFAULT };
  }
}

export function saveLogitechSettings(settings: LogitechSettings) {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  } catch {
    // Private-mode storage failures must not break exporting.
  }
}

const STOP_LOCK_LABELS = Object.fromEntries(
  STOP_LOCKS.map((entry) => [entry.id, entry.label])
) as Record<StopLock, string>;

/**
 * PressMouseButton / ReleaseMouseButton take Microsoft's button order.
 * Note that OnEvent's MOUSE_BUTTON_PRESSED arg uses Logitech's own order, where
 * 2 is right and 3 is middle -- the two are swapped. Only the output functions
 * are used here, so this table is the correct one.
 */
const MOUSE_BUTTONS = { left: 1, middle: 2, right: 3 } as const;

function luaString(value: string): string {
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

function pressCall(target: InputTarget, down: boolean): string {
  if (target.kind === "mouse") {
    return `${down ? "PressMouseButton" : "ReleaseMouseButton"}(${MOUSE_BUTTONS[target.button]})`;
  }
  return `${down ? "PressKey" : "ReleaseKey"}(${luaString(target.name)})`;
}

/**
 * Emits a Logitech G HUB script. The API is documented in "Logitech G HUB Lua
 * API — Overview and Reference": OnEvent(event, arg) is the entry point,
 * PressKey/ReleaseKey take lowercase key names, and Sleep(ms) blocks.
 *
 * Sleep blocking is why playback cannot be interrupted by another key press:
 * the handler owns the thread until it returns, so no event is dispatched while
 * the macro runs. A lock key is polled between events instead, which never
 * collides with a bound input because IsKeyLockOn reads the lock state rather
 * than the key. Only a *change* in that state aborts, so a lock that happened to
 * be engaged before playback started cannot kill the run on the first check.
 */
export function toLogitechLua(sequence: KeySequence, options: LogitechOptions): string {
  const trigger = options.trigger ?? TRIGGER_DEFAULT;
  const stopLock = options.stopLock ?? "capslock";
  const triggerLabel = trigger.source === "gkey" ? `G${trigger.value}` : `mouse button ${trigger.value}`;
  const delayed = toDelays(sequence.actions);
  const targets = bindingTargets(sequence.binding);
  const keyNames = targets.filter((target) => target.kind === "key").map((target) => luaString(target.name));
  const mouseButtons = targets
    .filter((target): target is Extract<InputTarget, { kind: "mouse" }> => target.kind === "mouse")
    .map((target) => MOUSE_BUTTONS[target.button]);

  const lines: string[] = [];
  lines.push("-- Delta Force Harmonica -- Logitech G HUB macro");
  lines.push(`-- ${options.songName}`);
  lines.push(
    `-- ${sequence.noteCount} notes, ${(sequence.durationMs / 1000).toFixed(1)} s` +
      (options.transpose ? `, transpose ${options.transpose > 0 ? "+" : ""}${options.transpose}` : "")
  );
  lines.push("--");
  lines.push("-- Paste into G HUB: profile -> SCRIPTING -> Script, then save.");
  lines.push(`-- Press ${triggerLabel} to play. Toggle ${STOP_LOCK_LABELS[stopLock]} to abort.`);
  lines.push("--");
  lines.push("-- Bindings:");
  lines.push(`--   notes       ${Object.entries(sequence.binding.notes).map(([k, v]) => `${k}=${targetLabel(v)}`).join(" ")}`);
  lines.push(`--   octave up   ${targetLabel(sequence.binding.octaveUp)}`);
  lines.push(`--   octave down ${targetLabel(sequence.binding.octaveDown)}`);
  lines.push(`--   semitone    ${targetLabel(sequence.binding.semitone)}`);
  lines.push("--");
  lines.push("-- PressMouseButton uses Microsoft order (1 left, 2 middle, 3 right).");
  lines.push("-- OnEvent reports mouse buttons in Logitech order (1 left, 2 right, 3 middle),");
  lines.push("-- so the trigger arg above follows OnEvent, not the output table.");
  lines.push("");
  lines.push(`local KEYS = { ${keyNames.join(", ")} }`);
  lines.push(`local MOUSE = { ${mouseButtons.join(", ")} }`);
  lines.push("");
  lines.push(`OutputLogMessage("DFH: script loaded, press ${triggerLabel} to play\\n")`);
  lines.push("");
  lines.push("local function releaseAll()");
  lines.push("  for _, k in ipairs(KEYS) do ReleaseKey(k) end");
  lines.push("  for _, b in ipairs(MOUSE) do ReleaseMouseButton(b) end");
  lines.push("end");
  lines.push("");
  lines.push("-- Playback aborts on a *change* to the stop lock rather than on it being on,");
  lines.push("-- so a lock already engaged before playback cannot kill the run.");
  lines.push("local lockBaseline = false");
  lines.push("");
  lines.push("local function aborted()");
  lines.push(`  if IsKeyLockOn("${stopLock}") ~= lockBaseline then`);
  lines.push("    releaseAll()");
  lines.push(`    OutputLogMessage("DFH: aborted (${STOP_LOCK_LABELS[stopLock]} toggled)\\n")`);
  lines.push("    return true");
  lines.push("  end");
  lines.push("  return false");
  lines.push("end");
  lines.push("");
  lines.push("local function play()");
  lines.push('  OutputLogMessage("DFH: start\\n")');
  lines.push("  releaseAll()");
  lines.push(`  lockBaseline = IsKeyLockOn("${stopLock}")`);

  for (const action of delayed) {
    if (action.delay > 0) {
      lines.push(`  Sleep(${action.delay})`);
      // Only worth checking where the script is already yielding.
      lines.push("  if aborted() then return end");
    }
    lines.push(`  ${pressCall(action.target, action.down)}`);
  }

  lines.push("  releaseAll()");
  lines.push('  OutputLogMessage("DFH: done\\n")');
  lines.push("end");
  lines.push("");
  lines.push("function OnEvent(event, arg)");
  lines.push(`  if event == "${trigger.source === "gkey" ? "G_PRESSED" : "MOUSE_BUTTON_PRESSED"}" and arg == ${trigger.value} then`);
  lines.push("    play()");
  lines.push("  end");
  lines.push("end");
  lines.push("");

  return lines.join("\n");
}
