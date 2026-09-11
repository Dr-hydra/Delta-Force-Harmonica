import { describe, expect, it } from "vitest";
import { buildKeySequence, GAME_BINDING, key, mouse, targetId, toDelays } from "./keySequence";
import { toLogitechLua, toLogitechProbe } from "./logitech";
import { toRazerXml, UnsupportedKeyError } from "./razer";
import type { GameNote } from "../music/types";

function note(partial: Partial<GameNote>): GameNote {
  return {
    pitch: 60,
    start: 0,
    duration: 500,
    key: "Z",
    degree: 1,
    keyIndex: 0,
    intrinsicOctave: 0,
    octaveModifier: 0,
    sharp: false,
    ...partial
  } as GameNote;
}

describe("buildKeySequence", () => {
  it("maps the octave and semitone modifiers onto mouse buttons", () => {
    const sequence = buildKeySequence([note({ octaveModifier: 1, sharp: true })]);
    const pressed = sequence.actions.filter((action) => action.down).map((action) => targetId(action.target));
    expect(pressed).toContain("mouse:right");
    expect(pressed).toContain("mouse:middle");
    expect(pressed).toContain("key:z");
  });

  it("uses the left mouse button for the lower octave", () => {
    const sequence = buildKeySequence([note({ octaveModifier: -1 })]);
    expect(sequence.actions.some((action) => targetId(action.target) === "mouse:left" && action.down)).toBe(true);
  });

  it("holds a modifier across consecutive notes that share it", () => {
    const sequence = buildKeySequence([
      note({ start: 0, duration: 400, key: "Z", octaveModifier: 1 }),
      note({ start: 500, duration: 400, key: "X", octaveModifier: 1 }),
      note({ start: 1000, duration: 400, key: "C", octaveModifier: 0 })
    ]);

    const right = sequence.actions.filter((action) => targetId(action.target) === "mouse:right");
    expect(right.map((action) => action.down)).toEqual([true, false]);
    expect(sequence.modifierPresses).toBe(1);
    expect(sequence.noteCount).toBe(3);
  });

  it("presses a modifier before the note it belongs to", () => {
    const sequence = buildKeySequence([note({ start: 1000, sharp: true })]);
    const semitone = sequence.actions.find((action) => targetId(action.target) === "mouse:middle" && action.down);
    const noteDown = sequence.actions.find((action) => targetId(action.target) === "key:z" && action.down);
    expect(semitone!.time).toBeLessThan(noteDown!.time);
  });

  it("truncates a note that runs into the next one", () => {
    const sequence = buildKeySequence([
      note({ start: 0, duration: 1000, key: "Z" }),
      note({ start: 300, duration: 300, key: "X" })
    ]);
    const release = sequence.actions.find((action) => targetId(action.target) === "key:z" && !action.down);
    expect(release!.time).toBeLessThanOrEqual(300);
    expect(sequence.truncatedNotes).toBe(1);
  });

  it("keeps one note of a chord", () => {
    const sequence = buildKeySequence([
      note({ start: 0, pitch: 60, key: "Z" }),
      note({ start: 0, pitch: 64, key: "C" })
    ]);
    expect(sequence.noteCount).toBe(1);
    expect(sequence.droppedChordNotes).toBe(1);
  });

  it("never leaves an input down at the end", () => {
    const sequence = buildKeySequence([
      note({ start: 0, key: "Z", octaveModifier: -1 }),
      note({ start: 600, key: "M", sharp: true, octaveModifier: 1 })
    ]);
    const balance = new Map<string, number>();
    for (const action of sequence.actions) {
      const id = targetId(action.target);
      balance.set(id, (balance.get(id) ?? 0) + (action.down ? 1 : -1));
    }
    for (const [, value] of balance) expect(value).toBe(0);
  });
});

describe("toDelays", () => {
  it("converts absolute times to gaps", () => {
    const delays = toDelays([
      { time: 0, target: key("z"), down: true },
      { time: 250, target: key("z"), down: false },
      { time: 250, target: mouse("right"), down: true }
    ]);
    expect(delays.map((item) => item.delay)).toEqual([0, 250, 0]);
  });
});

describe("toLogitechLua", () => {
  it("emits an OnEvent handler and balanced input calls", () => {
    const sequence = buildKeySequence([note({ start: 0, key: "Z" }), note({ start: 600, key: "M" })]);
    const lua = toLogitechLua(sequence, { songName: "Test", trigger: { source: "gkey", value: 3 } });

    expect(lua).toContain('if event == "G_PRESSED" and arg == 3 then');
    expect(lua).toContain('PressKey("z")');
    expect(lua).toContain('ReleaseKey("m")');
    expect(lua).toContain('IsKeyLockOn("capslock")');
  });

  it("triggers on a mouse button by default, since G HUB never reports plain keys", () => {
    const lua = toLogitechLua(buildKeySequence([note({ start: 0, key: "Z" })]), { songName: "T" });

    expect(lua).toContain('if event == "MOUSE_BUTTON_PRESSED" and arg == 4 then');
    expect(lua).not.toContain("G_PRESSED");
  });

  it("aborts on a stop-lock transition, so a pre-engaged lock is harmless", () => {
    const lua = toLogitechLua(buildKeySequence([note({ start: 0, key: "Z" })]), {
      songName: "T",
      stopLock: "numlock"
    });

    expect(lua).toContain('lockBaseline = IsKeyLockOn("numlock")');
    expect(lua).toContain('if IsKeyLockOn("numlock") ~= lockBaseline then');
    expect(lua).toContain("Num Lock toggled");
  });

  it("uses Microsoft mouse numbering: 1 left, 2 middle, 3 right", () => {
    const up = toLogitechLua(buildKeySequence([note({ octaveModifier: 1 })]), { songName: "T" });
    const down = toLogitechLua(buildKeySequence([note({ octaveModifier: -1 })]), { songName: "T" });
    const sharp = toLogitechLua(buildKeySequence([note({ sharp: true })]), { songName: "T" });

    expect(up).toContain("PressMouseButton(3)");
    expect(down).toContain("PressMouseButton(1)");
    expect(sharp).toContain("PressMouseButton(2)");
  });

  it("releases both keys and mouse buttons on abort", () => {
    const lua = toLogitechLua(buildKeySequence([note({ sharp: true })]), { songName: "T" });
    expect(lua).toContain("for _, k in ipairs(KEYS) do ReleaseKey(k) end");
    expect(lua).toContain("for _, b in ipairs(MOUSE) do ReleaseMouseButton(b) end");
  });
});

describe("toLogitechProbe", () => {
  it("logs every dispatched event without binding a trigger", () => {
    const probe = toLogitechProbe();

    expect(probe).toContain('OutputLogMessage("EVENT %s ARG %s\\n"');
    expect(probe).not.toContain("play()");
  });
});

describe("toRazerXml", () => {
  it("marks key releases with State 1 and presses without", () => {
    const sequence = buildKeySequence([note({ start: 0, key: "Z", duration: 400 })]);
    const xml = toRazerXml(sequence, { songName: "Test", guid: "11111111-1111-4111-8111-111111111111" });

    expect(xml).toContain("<Makecode>44</Makecode>");
    expect((xml.match(/<State>1<\/State>/g) ?? []).length).toBe(1);
    expect((xml.match(/<MacroEvent>/g) ?? []).length).toBe(2);
    expect(xml).toContain("<FolderGuid>00000000-0000-0000-0000-000000000000</FolderGuid>");
  });

  it("writes mouse buttons as Type 2 with an explicit State", () => {
    const xml = toRazerXml(buildKeySequence([note({ octaveModifier: 1 })]), { songName: "T" });
    expect(xml).toContain("<Type>2</Type>");
    expect(xml).toContain("<MouseButton>2</MouseButton>");
    expect(xml).toContain("<State>0</State>");
  });

  it("refuses extended keys instead of guessing a make code", () => {
    const sequence = buildKeySequence([note({ octaveModifier: 1 })], {
      binding: { ...GAME_BINDING, octaveUp: key("up") }
    });
    expect(() => toRazerXml(sequence, { songName: "Test" })).toThrow(UnsupportedKeyError);
  });
});
