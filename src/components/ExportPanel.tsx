import { useEffect, useMemo, useState } from "react";
import { downloadBytes, downloadText, safeFileName } from "../export/files";
import { toMidiFile } from "../export/midi";
import { GAME_BINDING, buildKeySequence } from "../export/keySequence";
import {
  STOP_LOCKS,
  TRIGGER_MAX,
  loadLogitechSettings,
  saveLogitechSettings,
  toLogitechLua,
  type StopLock,
  type TriggerSource
} from "../export/logitech";
import { toRazerXml } from "../export/razer";
import { toTabText } from "../export/tab";
import type { GameNote, TimeSignatureEvent } from "../music/types";

export interface ExportPanelProps {
  title: string;
  /** Harmony-optimized notes — the same list the on-screen preview renders. */
  notes: GameNote[];
  unplayableCount: number;
  bpm: number;
  timeSignatures: TimeSignatureEvent[];
  measureStarts: number[];
  transpose: number;
}

/**
 * The converter export panel, reused by the score library so a cloud score can
 * produce the same three artifacts without opening it in the editor. The macro
 * trigger/stop key live in localStorage because they describe the user's own
 * mouse and keyboard, not one score.
 */
export default function ExportPanel({ title, notes, unplayableCount, bpm, timeSignatures, measureStarts, transpose }: ExportPanelProps) {
  const [triggerSource, setTriggerSource] = useState<TriggerSource>(() => loadLogitechSettings().trigger.source);
  const [triggerValue, setTriggerValue] = useState(() => loadLogitechSettings().trigger.value);
  const [stopLock, setStopLock] = useState<StopLock>(() => loadLogitechSettings().stopLock);
  const [error, setError] = useState("");

  const maxTrigger = TRIGGER_MAX[triggerSource];
  const keySequence = useMemo(() => buildKeySequence(notes, { binding: GAME_BINDING }), [notes]);
  const empty = notes.length === 0;

  useEffect(() => {
    saveLogitechSettings({ trigger: { source: triggerSource, value: triggerValue }, stopLock });
  }, [triggerSource, triggerValue, stopLock]);

  function changeTriggerSource(source: TriggerSource) {
    setTriggerSource(source);
    const clamped = Math.min(Math.max(1, triggerValue), TRIGGER_MAX[source]);
    setTriggerValue(clamped);
  }

  /** Typed numbers are clamped to the range the current source can actually dispatch. */
  function editTrigger(value: string) {
    const parsed = Number(value);
    if (!Number.isInteger(parsed) || parsed < 1) return;
    setTriggerValue(Math.min(parsed, maxTrigger));
  }

  function exportTab() {
    setError("");
    downloadText(
      `${safeFileName(title)}.txt`,
      toTabText(notes, { songName: title, bpm, timeSignatures, measureStarts, transpose, unplayableCount }),
      "text/plain;charset=utf-8"
    );
  }

  function exportLogitech() {
    setError("");
    downloadText(
      `${safeFileName(title)}-logitech.lua`,
      toLogitechLua(keySequence, {
        songName: title,
        trigger: { source: triggerSource, value: triggerValue },
        stopLock,
        transpose
      }),
      "text/plain;charset=utf-8"
    );
  }

  function exportMidi() {
    setError("");
    try {
      downloadBytes(
        `${safeFileName(title)}.mid`,
        toMidiFile(notes, { bpm, timeSignatures }),
        "audio/midi"
      );
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "MIDI 导出失败。");
    }
  }

  function exportRazer() {
    setError("");
    try {
      downloadText(
        `${safeFileName(title)}-razer.xml`,
        toRazerXml(keySequence, { songName: title }),
        "application/xml;charset=utf-8"
      );
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "雷蛇宏导出失败。");
    }
  }

  return (
    <section className="panel control-panel" style={{ marginTop: 18 }}>
      <div className="section-heading">
        <div><span className="eyebrow">05 / EXPORT</span><h2>导出</h2></div>
        <span className="data-note">{empty ? "NO SCORE" : `${keySequence.actions.length} KEY EVENTS`}</span>
      </div>

      <div className="export-stack">
        <button className="button primary" disabled={empty} onClick={exportTab}>人可演奏版 · 文本谱 .txt</button>
        <button className="button" disabled={empty} onClick={exportMidi}>标准 MIDI .mid</button>
        <button className="button" disabled={empty} onClick={exportLogitech}>宏 · 罗技 G HUB .lua</button>
        <button className="button" disabled={empty} onClick={exportRazer}>宏 · 雷蛇 Synapse 3 .xml（未验证）</button>
      </div>

      <p className="preview-limit">
        <strong>MIDI 导出的是转换后的谱面本身</strong>：音高是移调后游戏里实际发出的音，时值和拍号跟着谱面，
        Tempo 用当前 BPM，单轨输出。文件里<strong>不含键位与修饰键</strong>，要 1:1 复现按键请用下面的宏导出。
      </p>

      <div className="export-fields">
        <label className="field">
          <span>开始键来源</span>
          <select value={triggerSource} onChange={(event) => changeTriggerSource(event.target.value as TriggerSource)}>
            <option value="mouse">鼠标按键</option>
            <option value="gkey">键盘 G 键</option>
          </select>
        </label>
        <label className="field">
          <span>{triggerSource === "mouse" ? "鼠标键编号" : "G 键编号"}</span>
          <input
            type="number"
            inputMode="numeric"
            min="1"
            max={maxTrigger}
            value={triggerValue}
            onChange={(event) => editTrigger(event.target.value)}
          />
        </label>
        <label className="field">
          <span>停止键</span>
          <select value={stopLock} onChange={(event) => setStopLock(event.target.value as StopLock)}>
            {STOP_LOCKS.map((lock) => <option key={lock.id} value={lock.id}>{lock.label}</option>)}
          </select>
        </label>
      </div>

      <p className="preview-limit">
        音符键 <code>Z X C V B N M ,</code> 是键盘键；升调 / 降调 / 半音固定为<strong>鼠标右键 / 左键 / 中键</strong>，
        所以宏里混着按键和鼠标事件。改过游戏内键位的话，这三处要改代码而不是改设置。
      </p>
      <p className="preview-limit">
        宏只负责导出，本项目不向游戏注入输入——罗技脚本粘贴到 G HUB 的 SCRIPTING 面板，按开始键播放、
        开启停止键中止。宏输出里的鼠标键用 <code>PressMouseButton</code> 的微软编号（1 左 / 2 中 / 3 右），
        但<strong>开始键的鼠标编号走罗技顺序</strong>（1 左 / 2 右 / 3 中，4 及以上对应 G HUB 按键列表里的 G4、G5……）。
      </p>
      <p className="preview-limit">
        <strong>开始键只能用 G 键或鼠标键</strong>：G HUB 的 Lua 只派发 G 键、M 键、鼠标键和配置切换事件，
        普通键盘按键（F10、空格等）根本收不到。编号填 G HUB 界面上标给那个键的序号；鼠标侧键在 G HUB 里也显示成 G 编号，
        但事件类型仍然是鼠标事件，所以这里的「开始键来源」要跟着选对。
      </p>
      <p className="preview-limit">
        <strong>停止键只能是锁定键</strong>：播放期间 <code>Sleep</code> 占住脚本线程、收不到新事件，只能轮询锁定状态，
        所以停止键在 Caps / Scroll / Num Lock 之间选。<strong>按一下切换它的开关状态即中止</strong>：
        脚本只比较「开始播放时记录的状态」有没有变化，所以开始前它是开是关都不影响，脚本也不会去改你的锁定状态。
      </p>
      <p className="preview-limit">
        <strong>雷蛇版未经验证</strong>：Synapse 的宏 XML 没有官方文档，格式是照社区导出的样本还原的，
        其中鼠标键编号只确认了左键 = 1，右键和中键的取值是推测。项目里没有雷蛇设备可以实测，
        导入 Synapse 3 后请在宏列表里核对每个事件显示的是不是右键 / 中键。Synapse 4 与 3 的格式不兼容。
      </p>
      {keySequence.droppedChordNotes + keySequence.truncatedNotes > 0 && (
        <p className="preview-limit">
          按键编排阶段又收紧了 {keySequence.truncatedNotes} 个音符的长度（为了留出 18 ms 松键间隔）
          {keySequence.droppedChordNotes > 0 && <>，并丢弃了 {keySequence.droppedChordNotes} 个同时发声的音符</>}
          。谱面已经是单音，这里是最后一道兜底。
        </p>
      )}
      {error && <p className="error-note">{error}</p>}
      <p className="preview-limit">
        自动化输入可能被反作弊判定，使用宏前请自行确认游戏规则与账号风险。
      </p>
    </section>
  );
}
