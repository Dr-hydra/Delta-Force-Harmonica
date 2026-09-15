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
import { TIMING_TIERS, loadTimingTier, saveTimingTier, timingTier, type TimingTierId } from "../export/timing";
import { toTabText } from "../export/tab";
import type { GameNote, TimeSignatureEvent } from "../music/types";
import type { ScoreSnapshotInput } from "../persistence/scoreCodec";
import { aboutHref } from "../navigation";

export interface ExportPanelProps {
  title: string;
  /** Harmony-optimized notes — the same list the on-screen preview renders. */
  notes: GameNote[];
  unplayableCount: number;
  bpm: number;
  timeSignatures: TimeSignatureEvent[];
  measureStarts: number[];
  transpose: number;
  /**
   * The pre-fingering score (collapsed notes plus transpose) behind `notes`.
   * Embedded into the MIDI export so the desktop player rebuilds the same
   * fingering; the file is still a plain MIDI without it.
   */
  snapshot?: ScoreSnapshotInput;
}

/**
 * The converter export panel, reused by the score library so a cloud score can
 * produce the same export choices without opening it in the editor. The macro
 * trigger/stop key live in localStorage because they describe the user's own
 * mouse and keyboard, not one score.
 */
export default function ExportPanel({ title, notes, unplayableCount, bpm, timeSignatures, measureStarts, transpose, snapshot }: ExportPanelProps) {
  const [triggerSource, setTriggerSource] = useState<TriggerSource>(() => loadLogitechSettings().trigger.source);
  const [triggerValue, setTriggerValue] = useState(() => loadLogitechSettings().trigger.value);
  const [stopLock, setStopLock] = useState<StopLock>(() => loadLogitechSettings().stopLock);
  const [timingTierId, setTimingTierId] = useState<TimingTierId>(() => loadTimingTier());
  const [error, setError] = useState("");

  const maxTrigger = TRIGGER_MAX[triggerSource];
  const timing = timingTier(timingTierId);
  const keySequence = useMemo(() => buildKeySequence(notes, { binding: GAME_BINDING, ...timing.timing }), [notes, timing]);
  const empty = notes.length === 0;

  useEffect(() => {
    saveLogitechSettings({ trigger: { source: triggerSource, value: triggerValue }, stopLock });
  }, [triggerSource, triggerValue, stopLock]);

  useEffect(() => {
    saveTimingTier(timingTierId);
  }, [timingTierId]);

  function changeTriggerSource(source: TriggerSource) {
    setTriggerSource(source);
    setTriggerValue(Math.min(Math.max(1, triggerValue), TRIGGER_MAX[source]));
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
        toMidiFile(notes, { bpm, timeSignatures, snapshot }),
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
        <a
          className="button"
          href={aboutHref()}
          style={{ display: "flex", alignItems: "center", justifyContent: "center", color: "inherit", textDecoration: "none" }}
        >
          下载自动演奏/可视化演奏软件 · 关于 →
        </a>
        <button className="button" disabled={empty} onClick={exportLogitech}>宏 · 罗技 G HUB .lua</button>
        <button className="button" disabled={empty} onClick={exportRazer}>宏 · 雷蛇 Synapse 3 .xml（未验证）</button>
      </div>

      <p className="export-alert">如果升降调不能正常使用，请使用管理员权限启动你的外设管理软件。</p>

      <p className="preview-limit">
        <strong>MIDI 导出的是转换后的谱面本身</strong>：音高是移调后游戏里实际发出的音，时值和拍号跟着谱面，
        Tempo 用当前 BPM，单轨输出。音符数据里<strong>不含键位与修饰键</strong>，要 1:1 复现按键请用下面的宏导出。
        文件同时附带一份谱面快照，<strong>桌面版自动演奏器只接受这里导出的 MIDI</strong>，用它打开即可得到和网页一致的按键。
      </p>

      <div className="export-fields">
        <label className="field">
          <span>开始键来源</span>
          <select value={triggerSource} onChange={(event) => changeTriggerSource(event.target.value as TriggerSource)}>
            <option value="mouse">鼠标按键</option>
            <option value="gkey">罗技键盘 G 键</option>
          </select>
        </label>
        <label className="field">
          <span>{triggerSource === "mouse" ? "鼠标键编号" : "键盘 G 键编号"}</span>
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
        <label className="field">
          <span>按键时序</span>
          <select value={timingTierId} onChange={(event) => setTimingTierId(event.target.value as TimingTierId)}>
            {TIMING_TIERS.map((tier) => <option key={tier.id} value={tier.id}>{tier.label} · {tier.hint}</option>)}
          </select>
        </label>
      </div>

      <p className="preview-limit">
        游戏按帧采样输入，宏里的间隔要留够整帧：当前档位修饰键提前 {timing.timing.modifierLeadMs} ms 按下、
        松键后 {timing.timing.releaseGapMs} ms 再按下一键、每个音至少按住 {timing.timing.minNoteMs} ms。
        漏音换「稳健」，跟快歌换「极限」；密集乐段会为保住间隔而推迟音符。桌面版设置里的同名档位数值相同。
      </p>

      {keySequence.droppedChordNotes + keySequence.truncatedNotes > 0 && (
        <p className="preview-limit">
          按键编排阶段又收紧了 {keySequence.truncatedNotes} 个音符的长度（为了留出 {timing.timing.releaseGapMs} ms 松键间隔）
          {keySequence.droppedChordNotes > 0 && <>，并丢弃了 {keySequence.droppedChordNotes} 个同时发声的音符</>}
          。谱面已经是单音，这里是最后一道兜底。
        </p>
      )}
      {error && <p className="error-note">{error}</p>}
      <p className="preview-limit">
        雷云宏导入后，请在按键绑定的播放方式中选择<strong>“播放一次”</strong>；循环、按住循环或切换连续播放都会重复执行。
      </p>
      <p className="preview-limit">
        自动化输入可能被反作弊判定，使用宏前请自行确认游戏规则与账号风险。
      </p>
    </section>
  );
}
