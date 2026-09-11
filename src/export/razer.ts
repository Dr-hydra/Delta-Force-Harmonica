import { bindingTargets, toDelays, type InputTarget, type KeySequence } from "./keySequence";

/**
 * PS/2 set 1 make codes, which is what Synapse stores in <Makecode>. Extended
 * keys (arrows, numpad, right-hand modifiers reached through the 0xE0 prefix)
 * are deliberately absent: their encoding in Synapse's XML is not something we
 * can confirm without a sample file, so binding one is rejected rather than
 * guessed at.
 */
const MAKE_CODES: Record<string, number> = {
  escape: 1, "1": 2, "2": 3, "3": 4, "4": 5, "5": 6, "6": 7, "7": 8, "8": 9, "9": 10, "0": 11,
  minus: 12, equal: 13, backspace: 14, tab: 15,
  q: 16, w: 17, e: 18, r: 19, t: 20, y: 21, u: 22, i: 23, o: 24, p: 25,
  lbracket: 26, rbracket: 27, enter: 28, lctrl: 29,
  a: 30, s: 31, d: 32, f: 33, g: 34, h: 35, j: 36, k: 37, l: 38,
  semicolon: 39, quote: 40, grave: 41, lshift: 42, backslash: 43,
  z: 44, x: 45, c: 46, v: 47, b: 48, n: 49, m: 50,
  comma: 51, period: 52, slash: 53, rshift: 54, lalt: 56, spacebar: 57, space: 57, capslock: 58,
  f1: 59, f2: 60, f3: 61, f4: 62, f5: 63, f6: 64, f7: 65, f8: 66, f9: 67, f10: 68, f11: 87, f12: 88
};

/**
 * UNVERIFIED. Community samples confirm <MouseButton>1</MouseButton> is the left
 * button; right and middle follow the Windows virtual-key order here, which is a
 * guess. Nobody on the project has a Razer device to check it against, so a
 * generated macro must be verified in Synapse's own macro list before use --
 * if right and middle come out swapped, this table is why.
 */
const MOUSE_BUTTONS = { left: 1, right: 2, middle: 3 } as const;

export const RAZER_MOUSE_UNVERIFIED = true;

export class UnsupportedKeyError extends Error {
  constructor(public readonly keys: string[]) {
    super(`Razer 宏不支持这些按键：${keys.join("、")}。请改绑非扩展键（字母、数字、逗号、空格、Shift / Ctrl / Alt 等）。`);
    this.name = "UnsupportedKeyError";
  }
}

export interface RazerOptions {
  songName: string;
  /** Stable macro identity; Synapse treats a repeat import as a duplicate. */
  guid?: string;
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function randomGuid(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  const hex = () => Math.floor(Math.random() * 16).toString(16);
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) =>
    c === "x" ? hex() : (Math.floor(Math.random() * 4) + 8).toString(16)
  );
}

/**
 * Emits a Razer Synapse 3 macro. The schema is reverse engineered from exported
 * macros the community has published, not an official one:
 *   Type 1 -> KeyEvent   (Makecode; no State means press, State 1 means release)
 *   Type 2 -> MouseEvent (MouseButton; State 0 press, State 1 release)
 * Delay2 is the wait before the event it sits with. Synapse 4 uses a different,
 * incompatible format.
 */
export function toRazerXml(sequence: KeySequence, options: RazerOptions): string {
  const unsupported = bindingTargets(sequence.binding)
    .filter((target): target is Extract<InputTarget, { kind: "key" }> => target.kind === "key")
    .map((target) => target.name)
    .filter((name) => MAKE_CODES[name] === undefined);
  if (unsupported.length > 0) throw new UnsupportedKeyError(unsupported);

  const delayed = toDelays(sequence.actions);
  const lines: string[] = [];
  lines.push('<?xml version="1.0" encoding="utf-8"?>');
  lines.push('<Macro xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:xsd="http://www.w3.org/2001/XMLSchema">');
  lines.push(`  <Name>${escapeXml(options.songName)}</Name>`);
  lines.push(`  <Guid>${options.guid ?? randomGuid()}</Guid>`);
  lines.push("  <MacroEvents>");

  for (const action of delayed) {
    lines.push("    <MacroEvent>");
    if (action.target.kind === "mouse") {
      lines.push("      <Type>2</Type>");
      lines.push(`      <Delay2>${action.delay}</Delay2>`);
      lines.push("      <MouseEvent>");
      lines.push(`        <MouseButton>${MOUSE_BUTTONS[action.target.button]}</MouseButton>`);
      lines.push(`        <State>${action.down ? 0 : 1}</State>`);
      lines.push("      </MouseEvent>");
    } else {
      lines.push("      <Type>1</Type>");
      lines.push(`      <Delay2>${action.delay}</Delay2>`);
      lines.push("      <KeyEvent>");
      lines.push(`        <Makecode>${MAKE_CODES[action.target.name]}</Makecode>`);
      if (!action.down) lines.push("        <State>1</State>");
      lines.push("      </KeyEvent>");
    }
    lines.push("    </MacroEvent>");
  }

  lines.push("  </MacroEvents>");
  lines.push("  <IsFolder>false</IsFolder>");
  lines.push("  <FolderGuid>00000000-0000-0000-0000-000000000000</FolderGuid>");
  lines.push("</Macro>");
  lines.push("");

  return lines.join("\n");
}

export function razerSupportsTarget(target: InputTarget): boolean {
  return target.kind === "mouse" || MAKE_CODES[target.name] !== undefined;
}
