import { bindingTargets, targetLabel, toDelays, type InputTarget, type KeySequence } from "./keySequence";

export interface LogitechOptions {
  songName: string;
  /** G-key that starts playback. */
  gKey?: number;
  transpose?: number;
}

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
 * Sleep blocking is why playback cannot be interrupted by another G-key press:
 * the handler owns the thread until it returns. Scroll Lock is polled between
 * events instead, which never collides with a bound input because IsKeyLockOn
 * reads the lock state rather than the key.
 */
export function toLogitechLua(sequence: KeySequence, options: LogitechOptions): string {
  const gKey = options.gKey ?? 1;
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
  lines.push(`-- Press G${gKey} to play. Toggle Scroll Lock on to abort.`);
  lines.push("--");
  lines.push("-- Bindings:");
  lines.push(`--   notes       ${Object.entries(sequence.binding.notes).map(([k, v]) => `${k}=${targetLabel(v)}`).join(" ")}`);
  lines.push(`--   octave up   ${targetLabel(sequence.binding.octaveUp)}`);
  lines.push(`--   octave down ${targetLabel(sequence.binding.octaveDown)}`);
  lines.push(`--   semitone    ${targetLabel(sequence.binding.semitone)}`);
  lines.push("--");
  lines.push("-- Mouse buttons use Microsoft order (1 left, 2 middle, 3 right), which is");
  lines.push("-- what PressMouseButton expects. OnEvent args use a different order.");
  lines.push("");
  lines.push(`local KEYS = { ${keyNames.join(", ")} }`);
  lines.push(`local MOUSE = { ${mouseButtons.join(", ")} }`);
  lines.push("");
  lines.push("local function releaseAll()");
  lines.push("  for _, k in ipairs(KEYS) do ReleaseKey(k) end");
  lines.push("  for _, b in ipairs(MOUSE) do ReleaseMouseButton(b) end");
  lines.push("end");
  lines.push("");
  lines.push("local function aborted()");
  lines.push('  if IsKeyLockOn("scrolllock") then');
  lines.push("    releaseAll()");
  lines.push('    OutputLogMessage("DFH: aborted\\n")');
  lines.push("    return true");
  lines.push("  end");
  lines.push("  return false");
  lines.push("end");
  lines.push("");
  lines.push("local function play()");
  lines.push('  OutputLogMessage("DFH: start\\n")');
  lines.push("  releaseAll()");

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
  lines.push(`  if event == "G_PRESSED" and arg == ${gKey} then`);
  lines.push("    play()");
  lines.push("  end");
  lines.push("end");
  lines.push("");

  return lines.join("\n");
}
