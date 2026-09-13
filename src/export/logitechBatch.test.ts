import { createRequire } from "node:module";
import { afterEach, describe, expect, it, vi } from "vitest";
import { GAME_BINDING, key, mouse, buildKeySequence, toDelays, type KeySequence } from "./keySequence";
import { loadBatchSettings, prepareBatchSong, saveBatchSettings, toggleBatchSelection, toLogitechBatchLua } from "./logitechBatch";
import { enforceMonophonic } from "../music/monophonic";
import { optimizeHarmonica } from "../harmonica/optimizer";
import type { ScoreSnapshot } from "../persistence/scoreCodec";

// Fengari is a dev-only Lua VM. Execute emitted scripts against fake G HUB I/O,
// rather than only matching generated strings. Hardware dispatch still needs G HUB.
const { lua, lauxlib, lualib, to_luastring } = createRequire(import.meta.url)("fengari");
function runLua(code: string) {
  const state = lauxlib.luaL_newstate();
  lualib.luaL_openlibs(state);
  try {
    const result = lauxlib.luaL_dostring(state, to_luastring(code));
    if (result !== lua.LUA_OK) throw new Error(lua.lua_tojsstring(state, -1));
  } finally { lua.lua_close(state); }
}

function sequence(name: string): KeySequence {
  return {
    binding: GAME_BINDING, durationMs: 5200, noteCount: 1,
    droppedChordNotes: 0, truncatedNotes: 0, modifierPresses: 1,
    actions: [
      { time: 0, target: mouse("right"), down: true },
      { time: 12, target: key(name), down: true },
      { time: 5200, target: key(name), down: false },
      { time: 5200, target: mouse("right"), down: false }
    ]
  };
}
const songs = [{ name: "第一首", sequence: sequence("z") }, { name: "第二首", sequence: sequence("x") }];
const settings = { trigger: { source: "mouse" as const, value: 4 }, stopLock: "capslock" as const };
const harness = `
now = 0
taps = {{0, 40}}
toggleAt = math.huge
initialLock = false
pressed = {}
held = {}
logs = {}
maxSleep = 0
function GetRunningTime() return now end
function Sleep(ms)
  assert(ms > 0 and ms <= 10, "sleep must stay cancellable")
  maxSleep = math.max(maxSleep, ms)
  now = now + ms
  assert(now < 20000, "runaway polling loop")
end
function IsMouseButtonPressed(button)
  assert(button == 4 or button == 5)
  for _, tap in ipairs(taps) do if now >= tap[1] and now < tap[2] then return true end end
  return false
end
function IsKeyLockOn(_) if now >= toggleAt then return not initialLock end return initialLock end
function PressKey(k) held[k] = true; table.insert(pressed, {k, now}) end
function ReleaseKey(k) held[k] = nil end
function PressMouseButton(b) held[b] = true; table.insert(pressed, {b, now}) end
function ReleaseMouseButton(b) held[b] = nil end
function OutputLogMessage(format, ...) table.insert(logs, string.format(format, ...)) end
function assertReleased() for k, _ in pairs(held) do error("still held: " .. tostring(k)) end end
`;
function simulate(setup: string, assertions: string, library = songs) {
  runLua(harness + setup + "\n" + toLogitechBatchLua(library, settings) + '\nOnEvent("MOUSE_BUTTON_PRESSED", 4)\n' + assertions);
}

afterEach(() => vi.unstubAllGlobals());

describe("batch selection and conversion", () => {
  it("preserves click order and appends a removed song when selected again", () => {
    let ids: string[] = [];
    for (const id of ["b", "a", "c", "a", "a"]) ids = toggleBatchSelection(ids, id);
    expect(ids).toEqual(["b", "c", "a"]);
  });

  it("uses the saved transpose and the same pipeline as the existing export", () => {
    const snapshot: ScoreSnapshot = {
      version: 1, ppq: 480, transpose: 2, tempos: [], timeSignatures: [], measureStarts: [],
      notes: [{ pitch: 60, start: 0, duration: 500, velocity: 90 }, { pitch: 64, start: 400, duration: 600, velocity: 90 }]
    };
    const expected = buildKeySequence(optimizeHarmonica(enforceMonophonic(snapshot.notes).notes, 2).notes);
    expect(prepareBatchSong("T", snapshot).song.sequence).toEqual(expected);
    expect(() => prepareBatchSong("空曲", { ...snapshot, notes: [] })).toThrow("没有可演奏");
  });

  it("stores batch preferences separately and reads original preferences as defaults", () => {
    const values = new Map([["dfh-logitech-settings", JSON.stringify({ trigger: { source: "mouse", value: 5 }, stopLock: "numlock" })]]);
    vi.stubGlobal("localStorage", { getItem: (k: string) => values.get(k) ?? null, setItem: (k: string, v: string) => values.set(k, v) });
    const original = values.get("dfh-logitech-settings");
    expect(loadBatchSettings()).toEqual({ trigger: { source: "mouse", value: 5 }, stopLock: "numlock" });
    saveBatchSettings(settings);
    expect(loadBatchSettings()).toEqual(settings);
    expect(values.get("dfh-logitech-settings")).toBe(original);
  });

  it("rejects empty libraries and unsupported triggers", () => {
    expect(() => toLogitechBatchLua([], settings)).toThrow();
    expect(() => toLogitechBatchLua(songs, { ...settings, trigger: { source: "mouse", value: 21 } })).toThrow();
  });
});

describe("generated Lua execution", () => {
  it.each([1, 2, 3, 4, 5])("polls the correct physical mouse button for event %i", (value) => {
    const physical = value === 2 ? 3 : value === 3 ? 2 : value;
    runLua(harness + `
      function EnablePrimaryMouseButtonEvents(enabled) primaryEnabled = enabled end
      function IsMouseButtonPressed(button)
        assert(button == ${physical})
        return now < 40
      end
    ` + toLogitechBatchLua(songs, { ...settings, trigger: { source: "mouse", value } }) + `
      OnEvent("MOUSE_BUTTON_PRESSED", ${value})
      assert(pressed[2][1] == "z" and pressed[1][2] == 740)
      ${value === 1 ? "assert(primaryEnabled)" : ""}
      assertReleased()
    `);
  });

  it("inherits G keys, migrates old side-key preferences, and clamps source ranges", () => {
    const values = new Map([["dfh-logitech-settings", JSON.stringify({ trigger: { source: "gkey", value: 18 }, stopLock: "capslock" })]]);
    vi.stubGlobal("localStorage", { getItem: (k: string) => values.get(k) ?? null, setItem: (k: string, v: string) => values.set(k, v) });
    expect(loadBatchSettings().trigger).toEqual({ source: "gkey", value: 18 });
    values.set("dfh-logitech-batch-settings", JSON.stringify({ triggerButton: 5 }));
    expect(loadBatchSettings().trigger).toEqual({ source: "mouse", value: 5 });
    saveBatchSettings({ ...settings, trigger: { source: "gkey", value: 20 } });
    expect(loadBatchSettings().trigger).toEqual({ source: "gkey", value: 18 });
  });

  it.each([
    ["mouse", 6, "MOUSE_BUTTON"], ["mouse", 20, "MOUSE_BUTTON"],
    ["gkey", 1, "G"], ["gkey", 18, "G"]
  ] as const)("counts %s %i events and confirms after the quiet interval", (source, value, prefix) => {
    runLua(harness + '\nfunction IsMouseButtonPressed(_) error("unsupported polling") end\n' +
      toLogitechBatchLua(songs, { ...settings, trigger: { source, value } }) + `
      OnEvent("${prefix}_PRESSED", ${value + 1})
      OnEvent("${prefix}_PRESSED", ${value})
      now = 1000
      OnEvent("${prefix}_PRESSED", ${value}) -- repeat while held counts once
      OnEvent("${prefix}_RELEASED", ${value})
      now = 1200
      OnEvent("${prefix}_PRESSED", ${value})
      now = 1240
      OnEvent("${prefix}_RELEASED", ${value})
      now = 1939
      assert(#pressed == 0)
      now = 1940
      OnEvent("${prefix}_PRESSED", ${value})
      assert(pressed[2][1] == "x" and pressed[1][2] == 1940)
      OnEvent("${prefix}_PRESSED", ${value}) -- cooldown
      assert(#pressed == 2)
      assertReleased()
    `);
  });

  it.each(["overflow", "cancel", "deactivate", "stop"])("handles event selection %s", (scenario) => {
    runLua(harness + toLogitechBatchLua(songs, { ...settings, trigger: { source: "gkey", value: 8 } }) + `
      OnEvent("G_PRESSED", 8)
      now = 40
      OnEvent("G_RELEASED", 8)
      ${scenario === "overflow" ? `
        now = 100; OnEvent("G_PRESSED", 8); now = 140; OnEvent("G_RELEASED", 8)
        now = 200; OnEvent("G_PRESSED", 8); now = 240; OnEvent("G_RELEASED", 8)
      ` : scenario === "cancel" ? "toggleAt = 300" : scenario === "deactivate" ? 'OnEvent("PROFILE_DEACTIVATED")' : "toggleAt = 1015"}
      now = 1000
      OnEvent("G_PRESSED", 8)
      ${scenario === "stop" ? "assert(#pressed == 2 and now >= 1015 and now <= 1025)" : "assert(#pressed == 0)"}
      assertReleased()
    `);
  });

  it("plays the first song after release + 700ms, with correct inputs and timing", () => {
    simulate("", `
      assert(#pressed == 2)
      assert(pressed[1][1] == 3 and pressed[1][2] == 740)
      assert(pressed[2][1] == "z" and pressed[2][2] == 752)
      assert(now == 5940)
      assertReleased()
    `);
  });

  it("counts two taps and waits from the last release", () => {
    simulate("taps = {{0, 40}, {400, 470}}", `
      assert(pressed[2][1] == "x" and pressed[2][2] == 1182)
      assertReleased()
    `);
  });

  it("counts a long hold once and never starts before release", () => {
    simulate("taps = {{0, 1300}}", 'assert(pressed[2][1] == "z" and pressed[1][2] == 2000); assertReleased()');
  });

  it("cancels excessive taps without wrapping or playing", () => {
    simulate("taps = {{0, 40}, {100, 140}, {200, 240}}", "assert(#pressed == 0); assertReleased()");
  });

  it("cancels selection on a stop-lock change", () => {
    simulate("toggleAt = 300", "assert(#pressed == 0 and now == 300); assertReleased()");
  });

  it("interrupts a long note promptly and releases all held inputs", () => {
    simulate("toggleAt = 1105", "assert(#pressed == 2); assert(now >= 1105 and now <= 1115); assertReleased()");
  });

  it("allows a lock already on and ignores queued/repeated starts", () => {
    simulate("initialLock = true", `
      assert(#pressed == 2)
      OnEvent("MOUSE_BUTTON_PRESSED", 4)
      now = now + 1000
      OnEvent("MOUSE_BUTTON_PRESSED", 4)
      assert(#pressed == 2)
      taps = {{now, now + 40}}
      OnEvent("MOUSE_BUTTON_PRESSED", 4)
      assert(#pressed == 4)
      assertReleased()
    `);
  });

  it("cleans up after an input API error and remains usable", () => {
    simulate('function PressKey(k) held[k] = true; error("input failure") end', `
      assertReleased()
      assert(string.find(logs[#logs], "input failure"))
    `);
  });

  it("escapes titles without executing them or treating percent as formatting", () => {
    simulate("", 'assert(pressed[2][1] == "z"); assertReleased()', [
      { name: '歌曲 "50%" \\ \nerror("injected")\r\0', sequence: sequence("z") }
    ]);
  });

  it("preserves every converted action, including simultaneous modifier releases", () => {
    const delayed = toDelays(songs[0].sequence.actions);
    expect(delayed.map((action) => action.delay)).toEqual([0, 12, 5188, 0]);
    simulate("", `assertReleased(); assert(now == 740 + ${songs[0].sequence.durationMs})`);
  });
});
