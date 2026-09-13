import { bindingTargets, buildKeySequence, targetId, toDelays, type InputTarget, type KeySequence } from "./keySequence";
import { loadLogitechSettings, STOP_LOCKS, TRIGGER_MAX, type LogitechTrigger, type StopLock } from "./logitech";
import { enforceMonophonic } from "../music/monophonic";
import { optimizeHarmonica } from "../harmonica/optimizer";
import type { ScoreSnapshot } from "../persistence/scoreCodec";

export interface BatchSettings {
  trigger: LogitechTrigger;
  stopLock: StopLock;
}
export interface BatchSong {
  name: string;
  sequence: KeySequence;
}
const SETTINGS_KEY = "dfh-logitech-batch-settings";
export const SELECTION_IDLE_MS = 700;

export function loadBatchSettings(): BatchSettings {
  const previous = loadLogitechSettings();
  const fallback: BatchSettings = {
    trigger: previous.trigger,
    stopLock: previous.stopLock
  };
  try {
    const parsed = JSON.parse(localStorage.getItem(SETTINGS_KEY) || "") as Partial<BatchSettings> & { triggerButton?: number };
    const trigger = parsed.trigger ?? (parsed.triggerButton === 4 || parsed.triggerButton === 5
      ? { source: "mouse" as const, value: parsed.triggerButton } : fallback.trigger);
    const source = trigger.source === "gkey" ? "gkey" : "mouse";
    const value = Number(trigger.value);
    return {
      trigger: { source, value: Number.isInteger(value) ? Math.min(Math.max(1, value), TRIGGER_MAX[source]) : fallback.trigger.value },
      stopLock: STOP_LOCKS.some((lock) => lock.id === parsed.stopLock) ? parsed.stopLock! : fallback.stopLock
    };
  } catch { return fallback; }
}

export function saveBatchSettings(settings: BatchSettings) {
  try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings)); } catch { /* Export still works without storage. */ }
}

/** Selection order is stable; removing and selecting again appends at the end. */
export function toggleBatchSelection(ids: string[], id: string): string[] {
  return ids.includes(id) ? ids.filter((value) => value !== id) : [...ids, id];
}

/** Match ScoreWorkbench's saved-score conversion, including the stored transpose. */
export function prepareBatchSong(name: string, snapshot: ScoreSnapshot) {
  const mono = enforceMonophonic(snapshot.notes);
  const conversion = optimizeHarmonica(mono.notes, snapshot.transpose);
  const sequence = buildKeySequence(conversion.notes);
  if (!sequence.actions.length) throw new Error(`「${name}」没有可演奏的音符，请取消选择或修改云存档后重试。`);
  return { song: { name, sequence }, unplayableCount: conversion.unplayable.length };
}

// Escape every control byte too: cloud titles are data, never Lua source or a format string.
function luaString(value: string) {
  return '"' + value.replace(/[\\"\x00-\x1f\x7f]/g, (char) => {
    if (char === '"' || char === "\\") return "\\" + char;
    return "\\" + char.charCodeAt(0).toString().padStart(3, "0");
  }) + '"';
}

const mouseButtons = { left: 1, middle: 2, right: 3 } as const;
function targetData(target: InputTarget) {
  return target.kind === "key" ? `{0, ${luaString(target.name)}}` : `{1, ${mouseButtons[target.button]}}`;
}

/** Independent batch exporter; the legacy single-song emitter remains unchanged. */
export function toLogitechBatchLua(songs: BatchSong[], settings: BatchSettings): string {
  if (!songs.length) throw new Error("请先选择至少一首云存档歌曲。");
  const { trigger } = settings;
  if (!(trigger.source in TRIGGER_MAX) || !Number.isInteger(trigger.value) || trigger.value < 1 || trigger.value > TRIGGER_MAX[trigger.source] || !STOP_LOCKS.some((lock) => lock.id === settings.stopLock)) {
    throw new Error("请选择有效的开始键编号和停止键。");
  }
  const polling = trigger.source === "mouse" && trigger.value <= 5;
  const pollButton = trigger.value === 2 ? 3 : trigger.value === 3 ? 2 : trigger.value;
  const triggerLabel = trigger.source === "mouse" ? `mouse button ${trigger.value}` : `keyboard G${trigger.value}`;
  const pressEvent = trigger.source === "mouse" ? "MOUSE_BUTTON_PRESSED" : "G_PRESSED";
  const releaseEvent = trigger.source === "mouse" ? "MOUSE_BUTTON_RELEASED" : "G_RELEASED";
  if (songs.some((song) => !song.sequence.actions.length)) throw new Error("曲库包含空歌曲。");
  const targets = [...new Map(songs.flatMap((song) => [
    ...bindingTargets(song.sequence.binding), ...song.sequence.actions.map((action) => action.target)
  ]).map((target) => [targetId(target), target])).values()];
  const targetIndices = new Map(targets.map((target, index) => [targetId(target), index + 1]));
  const data = songs.map((song) => {
    const actions = toDelays(song.sequence.actions).map((action) =>
      `      {${action.delay}, ${targetIndices.get(targetId(action.target))}, ${action.down ? "true" : "false"}}`
    ).join(",\n");
    return `  {name = ${luaString(song.name)}, actions = {\n${actions}\n  }}`;
  }).join(",\n");
  const stopLabel = STOP_LOCKS.find((lock) => lock.id === settings.stopLock)!.label;
  return `-- Delta Force Harmonica -- Logitech G HUB batch song library
-- Paste into G HUB profile -> SCRIPTING -> Script, then save.
-- Tap ${triggerLabel} N times to select song N.
-- ${polling ? `Playback starts ${SELECTION_IDLE_MS} ms after the last release.` : `After the last release, wait ${SELECTION_IDLE_MS} ms, then press once more to play.`} Hold counts once.
-- Toggle ${stopLabel} to cancel selection or stop playback.
-- Too many taps cancel selection. Every new selection starts at song 1.
-- Song order:
${songs.map((song, index) => `-- ${index + 1}. ${song.name.replace(/[\r\n\x00-\x1f\x7f]/g, " ")}`).join("\n")}

local TRIGGER = ${trigger.value}
local POLL_BUTTON = ${polling ? pollButton : "nil"}
${trigger.source === "mouse" && trigger.value === 1 ? "EnablePrimaryMouseButtonEvents(true)" : ""}
local STOP_LOCK = "${settings.stopLock}"
local IDLE_MS = ${SELECTION_IDLE_MS}
local INPUTS = { ${targets.map(targetData).join(", ")} }
-- Each action: delay in ms, input index, pressed state.
-- Mouse output numbering: 1 left, 2 middle, 3 right.
local SONGS = {
${data}
}
local busy = false
local nextStartAt = 0
local lockBaseline = false
local selectionCount = 0
local selectionDown = false
local selectionReleasedAt = 0

local function setInput(input, down)
  if input[1] == 0 then
    if down then PressKey(input[2]) else ReleaseKey(input[2]) end
  else
    if down then PressMouseButton(input[2]) else ReleaseMouseButton(input[2]) end
  end
end

local function releaseAll()
  for _, input in ipairs(INPUTS) do setInput(input, false) end
end

local function cancelled()
  return IsKeyLockOn(STOP_LOCK) ~= lockBaseline
end

-- Short sleeps keep cancellation responsive. Absolute deadlines avoid
-- accumulating the overhead of each check throughout the song.
local function waitUntil(deadline)
  while true do
    if cancelled() then return false end
    local remaining = deadline - GetRunningTime()
    if remaining <= 0 then return true end
    Sleep(math.min(10, remaining))
  end
end

local function reportSelection(count)
  if SONGS[count] then
    OutputLogMessage("DFH: selected %d / %s\\n", count, SONGS[count].name)
  else
    OutputLogMessage("DFH: too many taps; selection will be cancelled\\n")
  end
end

local function selectSong()
  local count = 1
  local wasDown = true
  local releasedAt = GetRunningTime()
  reportSelection(count)
  while true do
    if cancelled() then return nil end
    local now = GetRunningTime()
    local down = IsMouseButtonPressed(POLL_BUTTON)
    if down and not wasDown then
      count = count + 1
      reportSelection(count)
    elseif not down and wasDown then
      releasedAt = now
    end
    wasDown = down
    if not down and now - releasedAt >= IDLE_MS then
      if SONGS[count] then return count end
      return nil
    end
    Sleep(10)
  end
end

local function playSong(index)
  local song = SONGS[index]
  OutputLogMessage("DFH: start %d / %s\\n", index, song.name)
  releaseAll()
  local deadline = GetRunningTime()
  for _, action in ipairs(song.actions) do
    deadline = deadline + action[1]
    if not waitUntil(deadline) then return false end
    setInput(INPUTS[action[2]], action[3])
  end
  return true
end

function OnEvent(event, arg)
  if event == "PROFILE_DEACTIVATED" then
    selectionCount = 0
    selectionDown = false
    releaseAll()
    return
  end
  if selectionCount > 0 and cancelled() then
    selectionCount = 0
    selectionDown = false
    nextStartAt = GetRunningTime() + 800
    return
  end
  if arg ~= TRIGGER then return end
  if busy or GetRunningTime() < nextStartAt then return end
  ${polling ? `if event ~= "${pressEvent}" then return end
  -- Ignore queued events after polling/playback, including old selection taps.
  if not IsMouseButtonPressed(POLL_BUTTON) then return end
  local chosen = nil` : `if event == "${releaseEvent}" then
    if selectionDown then selectionReleasedAt = GetRunningTime() end
    selectionDown = false
    return
  end
  if event ~= "${pressEvent}" or selectionDown then return end
  local chosen = nil
  if selectionCount > 0 and GetRunningTime() - selectionReleasedAt >= IDLE_MS then
    chosen = selectionCount
    selectionCount = 0
  else
    if selectionCount == 0 then lockBaseline = IsKeyLockOn(STOP_LOCK) end
    selectionCount = selectionCount + 1
    selectionDown = true
    reportSelection(selectionCount)
    return
  end`}
  busy = true
  lockBaseline = IsKeyLockOn(STOP_LOCK)
  local ok, message = pcall(function()
    local index = ${polling ? "selectSong()" : "chosen"}
    if index and not SONGS[index] then index = nil end
    if index then
      if playSong(index) then OutputLogMessage("DFH: done\\n")
      else OutputLogMessage("DFH: stopped\\n") end
    else
      OutputLogMessage("DFH: selection cancelled\\n")
    end
  end)
  releaseAll()
  nextStartAt = GetRunningTime() + 800
  busy = false
  if not ok then OutputLogMessage("DFH: error: %s\\n", tostring(message)) end
end

OutputLogMessage("DFH: batch library loaded (%d songs); tap ${triggerLabel} to select\\n", #SONGS)
`;
}
