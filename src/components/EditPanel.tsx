import { useEffect, useState, type ReactNode } from "react";
import { candidatesForPitch, displayOctave, midiName } from "../harmonica/mapping";
import type { NoteEvent } from "../music/types";
import {
  clearLongSilences,
  deleteNote,
  deleteNoteAndClose,
  deleteNotes,
  insertNote,
  insertNoteAt,
  moveNote,
  moveNotes,
  resizeNote,
  resizeNotes,
  resolveEditConflicts,
  setNoteValues,
  snapAll,
  transposeNote,
  transposeNotes,
  type EditResult
} from "../score/editNotes";

const EDIT_STEPS = [
  { value: 1, label: "1 拍" },
  { value: 0.5, label: "1/2 拍" },
  { value: 0.25, label: "1/4 拍" },
  { value: 0.125, label: "1/8 拍" },
  { value: 1 / 3, label: "1/3 拍（三连音）" },
  { value: 1 / 6, label: "1/6 拍（三连音）" }
];

const DURATION_PRESETS = [
  { value: 4, label: "全音符 · 4 拍" },
  { value: 3, label: "附点二分 · 3 拍" },
  { value: 2, label: "二分音符 · 2 拍" },
  { value: 1.5, label: "附点四分 · 1.5 拍" },
  { value: 1, label: "四分音符 · 1 拍" },
  { value: 0.75, label: "附点八分 · 0.75 拍" },
  { value: 0.5, label: "八分音符 · 0.5 拍" },
  { value: 0.25, label: "十六分音符 · 0.25 拍" },
  { value: 1 / 3, label: "三连音 · 1/3 拍" }
];

const PLAYABLE_PITCHES = Array.from({ length: 88 }, (_, index) => index + 21)
  .filter((pitch) => candidatesForPitch(pitch).length > 0);

function playablePitchLabel(pitch: number) {
  const candidates = candidatesForPitch(pitch);
  const candidate = candidates.find((item) => !item.sharp) ?? candidates[0];
  if (!candidate) return midiName(pitch);
  const octave = displayOctave(candidate);
  const register = octave > 0 ? "高音" : octave < 0 ? "低音" : "中音";
  return `${midiName(pitch)} · ${register}${candidate.sharp ? "#" : ""}${candidate.degree}`;
}

/**
 * The converter's 04 / EDIT panel, reused by the score library so a stored
 * score can be tweaked before it is exported, saved or published. All state
 * lives in the caller (useScoreEdits), this file is presentation only.
 */
export default function EditPanel({
  notes,
  editing,
  selectedNote,
  selectedNotes,
  insertionBeat,
  transpose = 0,
  collapsedConflictCount = 0,
  truncatedConflictCount = 0,
  canUndo,
  canRedo,
  canPaste,
  editStep,
  resetHint,
  onEditStepChange,
  onApply,
  onUndo,
  onRedo,
  onCopy,
  onPaste,
  onDuplicate,
  onSelectAll,
  onClearSelection,
  onSelectAdjacent,
  onReset,
  onStartBlank
}: {
  notes: NoteEvent[];
  editing: boolean;
  selectedNote: number | null;
  selectedNotes?: number[];
  insertionBeat?: number | null;
  transpose?: number;
  collapsedConflictCount?: number;
  truncatedConflictCount?: number;
  canUndo: boolean;
  canRedo: boolean;
  canPaste?: boolean;
  editStep: number;
  /** Shown once the working copy differs from the base score. */
  resetHint?: ReactNode;
  onEditStepChange: (step: number) => void;
  onApply: (operation: (notes: NoteEvent[], bpm: number) => EditResult) => void;
  onUndo: () => void;
  onRedo: () => void;
  onCopy?: () => void;
  onPaste?: () => void;
  onDuplicate?: () => void;
  onSelectAll?: () => void;
  onClearSelection?: () => void;
  onSelectAdjacent?: (direction: -1 | 1, extend?: boolean) => void;
  onReset: () => void;
  onStartBlank: () => void;
}) {
  const selected = selectedNote !== null ? notes[selectedNote] : undefined;
  const selection = selectedNotes?.length ? selectedNotes : (selectedNote === null ? [] : [selectedNote]);
  const multiple = selection.length > 1;
  const [pitchDraft, setPitchDraft] = useState("");
  const [beatDraft, setBeatDraft] = useState("");
  const [durationDraft, setDurationDraft] = useState("");
  const [silenceThreshold, setSilenceThreshold] = useState("5");
  const parsedSilenceThreshold = Number(silenceThreshold);
  const validSilenceThreshold = Number.isFinite(parsedSilenceThreshold) && parsedSilenceThreshold > 0;
  const parsedPitch = Number(pitchDraft);
  const parsedBeat = Number(beatDraft);
  const parsedDuration = Number(durationDraft);
  const displayedPitch = parsedPitch + transpose;
  const validDraft = Boolean(selected) && !multiple
    && Number.isFinite(parsedPitch) && parsedPitch >= 21 && parsedPitch <= 108
    && Number.isFinite(parsedBeat) && parsedBeat >= 1
    && Number.isFinite(parsedDuration) && parsedDuration > 0;

  useEffect(() => {
    setPitchDraft(selected ? String(selected.pitch) : "");
    setBeatDraft(selected ? String(Math.round(((selected.beat ?? 0) + 1) * 1000) / 1000) : "");
    setDurationDraft(selected ? String(Math.round((selected.durationBeats ?? 0) * 1000) / 1000) : "");
  }, [selectedNote, selected?.pitch, selected?.beat, selected?.durationBeats]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const target = event.target;
      if (target instanceof HTMLElement && (
        target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName)
      )) return;

      const command = event.ctrlKey || event.metaKey;
      const key = event.key.toLowerCase();
      if (command && key === "a") {
        event.preventDefault();
        onSelectAll?.();
      } else if (command && key === "c" && selection.length > 0) {
        event.preventDefault();
        onCopy?.();
      } else if (command && key === "v" && canPaste) {
        event.preventDefault();
        onPaste?.();
      } else if (command && key === "d" && selection.length > 0) {
        event.preventDefault();
        onDuplicate?.();
      } else if (command && key === "z") {
        event.preventDefault();
        if (event.shiftKey) onRedo();
        else onUndo();
      } else if (command && key === "y") {
        event.preventDefault();
        onRedo();
      } else if (!command && (event.key === "Delete" || event.key === "Backspace") && selection.length > 0) {
        event.preventDefault();
        onApply((n, b) => deleteNotes(n, selection, b));
      } else if (!command && event.altKey && (event.key === "ArrowLeft" || event.key === "ArrowRight") && selection.length > 0) {
        event.preventDefault();
        onApply((n, b) => moveNotes(n, selection, event.key === "ArrowLeft" ? -editStep : editStep, b));
      } else if (!command && !event.altKey && (event.key === "ArrowUp" || event.key === "ArrowDown") && selection.length > 0) {
        event.preventDefault();
        onApply((n, b) => transposeNotes(n, selection, event.key === "ArrowUp" ? 1 : -1, b));
      } else if (!command && !event.altKey && (event.key === "ArrowLeft" || event.key === "ArrowRight")) {
        event.preventDefault();
        onSelectAdjacent?.(event.key === "ArrowLeft" ? -1 : 1, event.shiftKey);
      } else if (event.key === "Escape") {
        onClearSelection?.();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [canPaste, editStep, onApply, onClearSelection, onCopy, onDuplicate, onPaste, onRedo, onSelectAdjacent, onSelectAll, onUndo, selection]);

  return (
    <section className="panel control-panel" style={{ marginTop: 18 }}>
      <div className="section-heading">
        <div><span className="eyebrow">04 / EDIT</span><h2>微调与手工编辑</h2></div>
        <span className="data-note">
          {editing ? `已编辑 · ${notes.length} 音符` : "未编辑"}
        </span>
      </div>

      <p className="preview-limit">
        点击音符选择，Ctrl / ⌘ 点击可增减选择，Shift 点击可选择连续范围。下面的操作会应用到所有选中音符。
        编辑出的重叠会被单音收敛截断，谱面上显示的时值可能短于这里的数值。
      </p>

      <div className="edit-toolbar">
        <label className="field" style={{ minWidth: 150 }}>
          <span>编辑步长</span>
          <select value={editStep} onChange={(event) => onEditStepChange(Number(event.target.value))}>
            {EDIT_STEPS.map((step) => <option key={step.value} value={step.value}>{step.label}</option>)}
          </select>
        </label>
        <button className="button secondary" disabled={!canUndo} onClick={onUndo}>↶ 撤销</button>
        <button className="button secondary" disabled={!canRedo} onClick={onRedo}>↷ 重做</button>
        <button className="button secondary" disabled={selection.length === 0} onClick={onCopy}>复制所选</button>
        <button className="button secondary" disabled={!canPaste} onClick={onPaste}>粘贴片段</button>
        <button className="button secondary" disabled={selection.length === 0} onClick={onDuplicate}>重复所选</button>
        <button className="button secondary" disabled={notes.length === 0 || selection.length === notes.length} onClick={onSelectAll}>全选</button>
        <button className="button secondary" disabled={selection.length === 0} onClick={onClearSelection}>清除选择</button>
        <button className="button secondary" disabled={!editing} onClick={onReset}>放弃编辑</button>
        <button className="button" onClick={onStartBlank}>从空白谱开始</button>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(132px, 1fr))", gap: 8, marginTop: 16 }}>
        <button className="button" disabled={selection.length === 0} onClick={() => onApply((n, b) => multiple ? transposeNotes(n, selection, 1, b) : transposeNote(n, selectedNote!, 1, b))}>音高 +1</button>
        <button className="button" disabled={selection.length === 0} onClick={() => onApply((n, b) => multiple ? transposeNotes(n, selection, -1, b) : transposeNote(n, selectedNote!, -1, b))}>音高 −1</button>
        <button className="button" disabled={selection.length === 0} onClick={() => onApply((n, b) => multiple ? transposeNotes(n, selection, 12, b) : transposeNote(n, selectedNote!, 12, b))}>+1 八度</button>
        <button className="button" disabled={selection.length === 0} onClick={() => onApply((n, b) => multiple ? transposeNotes(n, selection, -12, b) : transposeNote(n, selectedNote!, -12, b))}>−1 八度</button>
        <button className="button" disabled={selection.length === 0} onClick={() => onApply((n, b) => multiple ? moveNotes(n, selection, -editStep, b) : moveNote(n, selectedNote!, -editStep, b))}>← 提前</button>
        <button className="button" disabled={selection.length === 0} onClick={() => onApply((n, b) => multiple ? moveNotes(n, selection, editStep, b) : moveNote(n, selectedNote!, editStep, b))}>推后 →</button>
        <button className="button" disabled={selection.length === 0} onClick={() => onApply((n, b) => multiple ? resizeNotes(n, selection, editStep, b) : resizeNote(n, selectedNote!, editStep, b))}>时值 +</button>
        <button className="button" disabled={selection.length === 0} onClick={() => onApply((n, b) => multiple ? resizeNotes(n, selection, -editStep, b) : resizeNote(n, selectedNote!, -editStep, b))}>时值 −</button>
        <button className="button" onClick={() => onApply((n, b) => insertionBeat !== null && insertionBeat !== undefined
          ? insertNoteAt(n, insertionBeat, editStep, b)
          : insertNote(n, selectedNote, editStep, b))}>{insertionBeat !== null && insertionBeat !== undefined ? "在光标处插入" : "插入音符"}</button>
        <button className="button" disabled={selectedNote === null || multiple} title={multiple ? "批量删除时不自动压缩，避免意外改变片段间距" : undefined} onClick={() => onApply((n, b) => deleteNoteAndClose(n, selectedNote!, b))}>删除并补位</button>
        <button className="button" disabled={selection.length === 0} onClick={() => onApply((n, b) => multiple ? deleteNotes(n, selection, b) : deleteNote(n, selectedNote!, b))}>{multiple ? `删除所选 ${selection.length} 个` : "删除保留空白"}</button>
        <button className="button" disabled={notes.length === 0} onClick={() => onApply((n, b) => ({ notes: snapAll(n, editStep, b), selected: selectedNote }))}>全部对齐到步长</button>
      </div>

      <div className="note-value-editor">
        <label className="field">
          <span>谱面音高</span>
          <select
            disabled={!selected || multiple}
            value={PLAYABLE_PITCHES.includes(displayedPitch) ? displayedPitch : ""}
            onChange={(event) => setPitchDraft(String(Number(event.target.value) - transpose))}
          >
            {!PLAYABLE_PITCHES.includes(displayedPitch) && <option value="">{selected ? "当前音高不可演奏" : "先选择音符"}</option>}
            {PLAYABLE_PITCHES.map((pitch) => <option value={pitch} key={pitch}>{playablePitchLabel(pitch)}</option>)}
          </select>
          <small>{selected ? `原始 MIDI ${parsedPitch}${transpose ? ` · 移调 ${transpose > 0 ? "+" : ""}${transpose}` : ""}` : "先在谱面选择音符"}</small>
        </label>
        <label className="field">
          <span>起始拍</span>
          <input type="number" min="1" step={editStep} disabled={!selected || multiple} value={beatDraft} onChange={(event) => setBeatDraft(event.target.value)} />
          <small>第 1 拍为乐谱开头</small>
        </label>
        <label className="field">
          <span>时值（拍）</span>
          <input type="number" min="0.03125" step={editStep} disabled={!selected || multiple} value={durationDraft} onChange={(event) => setDurationDraft(event.target.value)} />
          <select
            aria-label="常用时值"
            disabled={!selected || multiple}
            value=""
            onChange={(event) => setDurationDraft(event.target.value)}
          >
            <option value="">选择常用时值…</option>
            {DURATION_PRESETS.map((preset) => <option value={preset.value} key={preset.label}>{preset.label}</option>)}
          </select>
        </label>
        <button
          className="button primary"
          disabled={!validDraft || selectedNote === null}
          onClick={() => onApply((n, b) => setNoteValues(n, selectedNote!, {
            pitch: parsedPitch,
            beat: parsedBeat - 1,
            durationBeats: parsedDuration
          }, b))}
        >应用数值</button>
      </div>

      {(collapsedConflictCount > 0 || truncatedConflictCount > 0) && (
        <div className="editor-conflict" role="status">
          <p>
            当前编辑产生了
            {collapsedConflictCount > 0 ? ` ${collapsedConflictCount} 个同时起音` : ""}
            {collapsedConflictCount > 0 && truncatedConflictCount > 0 ? "、" : ""}
            {truncatedConflictCount > 0 ? ` ${truncatedConflictCount} 处时值重叠` : ""}。
            试听和导出会保留同时起音中的最高音，并在下一个音符起音处截断前音。
          </p>
          <button className="button" onClick={() => onApply((n, b) => resolveEditConflicts(n, selection, b))}>按当前演奏结果修复</button>
        </div>
      )}

      <div className="silence-cleaner">
        <label className="field">
          <span>空白段阈值（秒）</span>
          <input
            type="number"
            min="0.1"
            step="0.5"
            value={silenceThreshold}
            onChange={(event) => setSilenceThreshold(event.target.value)}
          />
        </label>
        <button
          className="button"
          disabled={notes.length === 0 || !validSilenceThreshold}
          onClick={() => onApply((n, b) => clearLongSilences(n, parsedSilenceThreshold, b, selectedNote))}
        >
          清除空白段
        </button>
        <p>达到阈值的无音区间会被删除，较短的停顿保持不变。</p>
      </div>

      <p className="preview-limit">
        {multiple
          ? `已选择 ${selection.length} 个音符 · 可批量升降音、移动、调整时值或删除。`
          : selected
            ? `选中第 ${selectedNote! + 1} / ${notes.length} 个音符 · ${midiName(selected.pitch)} · 第 ${((selected.beat ?? 0) + 1).toFixed(2)} 拍 · 时值 ${(selected.durationBeats ?? 0).toFixed(2)} 拍`
          : insertionBeat !== null && insertionBeat !== undefined
            ? `插入光标位于第 ${(insertionBeat + 1).toFixed(2)} 拍，新音符时值为 ${editStep} 拍。`
            : "未选中音符。点击小节谱空白处可指定插入位置；没有指定时从第 1 拍开始。"}
      </p>
      {canPaste && <p className="preview-limit">粘贴优先放在谱面插入光标处；没有插入光标时，会接在当前选择末尾。</p>}
      <p className="editor-shortcuts">←/→ 选择 · Shift+←/→ 扩选 · ↑/↓ 升降音 · Alt+←/→ 移动 · Delete 删除 · Ctrl/⌘ A/C/V/D · Ctrl/⌘ Z/Y</p>
      {editing && resetHint && <p className="preview-limit">{resetHint}</p>}
    </section>
  );
}
