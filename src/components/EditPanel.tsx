import { useState, type ReactNode } from "react";
import { midiName } from "../harmonica/mapping";
import type { NoteEvent } from "../music/types";
import {
  clearLongSilences,
  deleteNote,
  insertNote,
  moveNote,
  resizeNote,
  snapAll,
  transposeNote,
  type EditResult
} from "../score/editNotes";

const EDIT_STEPS = [
  { value: 1, label: "1 拍" },
  { value: 0.5, label: "1/2 拍" },
  { value: 0.25, label: "1/4 拍" }
];

/**
 * The converter's 04 / EDIT panel, reused by the score library so a stored
 * score can be tweaked before it is exported, saved or published. All state
 * lives in the caller (useScoreEdits), this file is presentation only.
 */
export default function EditPanel({
  notes,
  editing,
  selectedNote,
  canUndo,
  canRedo,
  editStep,
  resetHint,
  onEditStepChange,
  onApply,
  onUndo,
  onRedo,
  onReset,
  onStartBlank
}: {
  notes: NoteEvent[];
  editing: boolean;
  selectedNote: number | null;
  canUndo: boolean;
  canRedo: boolean;
  editStep: number;
  /** Shown once the working copy differs from the base score. */
  resetHint?: ReactNode;
  onEditStepChange: (step: number) => void;
  onApply: (operation: (notes: NoteEvent[], bpm: number) => EditResult) => void;
  onUndo: () => void;
  onRedo: () => void;
  onReset: () => void;
  onStartBlank: () => void;
}) {
  const selected = selectedNote !== null ? notes[selectedNote] : undefined;
  const [silenceThreshold, setSilenceThreshold] = useState("5");
  const parsedSilenceThreshold = Number(silenceThreshold);
  const validSilenceThreshold = Number.isFinite(parsedSilenceThreshold) && parsedSilenceThreshold > 0;

  return (
    <section className="panel control-panel" style={{ marginTop: 18 }}>
      <div className="section-heading">
        <div><span className="eyebrow">04 / EDIT</span><h2>微调与手工编辑</h2></div>
        <span className="data-note">
          {editing ? `已编辑 · ${notes.length} 音符` : "未编辑"}
        </span>
      </div>

      <p className="preview-limit">
        在上面的小节谱里点一个音符即可选中（黑框标记），下面的操作作用于选中的音符。也可以从空白谱开始自己搭建。
        编辑出的重叠会被单音收敛截断，谱面上显示的时值可能短于这里的数值。
      </p>

      <div className="transpose-row" style={{ alignItems: "flex-end", flexWrap: "wrap" }}>
        <label className="field" style={{ minWidth: 150 }}>
          <span>编辑步长</span>
          <select value={editStep} onChange={(event) => onEditStepChange(Number(event.target.value))}>
            {EDIT_STEPS.map((step) => <option key={step.value} value={step.value}>{step.label}</option>)}
          </select>
        </label>
        <button className="button secondary" disabled={!canUndo} onClick={onUndo}>↶ 撤销</button>
        <button className="button secondary" disabled={!canRedo} onClick={onRedo}>↷ 重做</button>
        <button className="button secondary" disabled={!editing} onClick={onReset}>放弃编辑</button>
        <button className="button" onClick={onStartBlank}>从空白谱开始</button>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(132px, 1fr))", gap: 8, marginTop: 16 }}>
        <button className="button" disabled={selectedNote === null} onClick={() => onApply((n, b) => transposeNote(n, selectedNote!, 1, b))}>音高 +1</button>
        <button className="button" disabled={selectedNote === null} onClick={() => onApply((n, b) => transposeNote(n, selectedNote!, -1, b))}>音高 −1</button>
        <button className="button" disabled={selectedNote === null} onClick={() => onApply((n, b) => transposeNote(n, selectedNote!, 12, b))}>+1 八度</button>
        <button className="button" disabled={selectedNote === null} onClick={() => onApply((n, b) => transposeNote(n, selectedNote!, -12, b))}>−1 八度</button>
        <button className="button" disabled={selectedNote === null} onClick={() => onApply((n, b) => moveNote(n, selectedNote!, -editStep, b))}>← 提前</button>
        <button className="button" disabled={selectedNote === null} onClick={() => onApply((n, b) => moveNote(n, selectedNote!, editStep, b))}>推后 →</button>
        <button className="button" disabled={selectedNote === null} onClick={() => onApply((n, b) => resizeNote(n, selectedNote!, editStep, b))}>时值 +</button>
        <button className="button" disabled={selectedNote === null} onClick={() => onApply((n, b) => resizeNote(n, selectedNote!, -editStep, b))}>时值 −</button>
        <button className="button" onClick={() => onApply((n, b) => insertNote(n, selectedNote, editStep, b))}>插入音符</button>
        <button className="button" disabled={selectedNote === null} onClick={() => onApply((n, b) => deleteNote(n, selectedNote!, b))}>删除音符</button>
        <button className="button" disabled={notes.length === 0} onClick={() => onApply((n, b) => ({ notes: snapAll(n, editStep, b), selected: selectedNote }))}>全部对齐到步长</button>
      </div>

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
        {selected
          ? `选中第 ${selectedNote! + 1} / ${notes.length} 个音符 · ${midiName(selected.pitch)} · 第 ${((selected.beat ?? 0) + 1).toFixed(2)} 拍 · 时值 ${(selected.durationBeats ?? 0).toFixed(2)} 拍`
          : "未选中音符。插入音符会在选中音之后添加，没有选中时从第 1 拍开始。"}
      </p>
      {editing && resetHint && <p className="preview-limit">{resetHint}</p>}
    </section>
  );
}
