import { useMemo, useState } from "react";
import { displayOctave, midiName } from "../harmonica/mapping";
import { useScorePreview } from "../player/useScorePreview";
import { buildScoreMeasures } from "../score/measures";
import type { GameNote, HarmonicaKey, TimeSignatureEvent } from "../music/types";
import { MeasureScore } from "./MeasureScore";
import { NoteTile } from "./NoteTile";
import "../preview.css";
import "../score.css";

const KEY_ORDER: HarmonicaKey[] = ["Z", "X", "C", "V", "B", "N", "M", ","];

function formatTime(ms: number) {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = String(totalSeconds % 60).padStart(2, "0");
  return `${minutes}:${seconds}`;
}

function jianpuLabel(note: GameNote) {
  const octave = displayOctave(note);
  const highDots = octave > 0 ? "·".repeat(octave) : "";
  const lowDots = octave < 0 ? "·".repeat(Math.abs(octave)) : "";
  return `${highDots}${note.sharp ? "#" : ""}${note.degree}${lowDots}`;
}

export function ScoreWorkspace({
  notes,
  unplayableCount,
  timeSignatures,
  measureStarts,
  bpm,
  selectedIndex,
  onNoteSelect
}: {
  notes: GameNote[];
  unplayableCount: number;
  timeSignatures: TimeSignatureEvent[];
  measureStarts: number[];
  bpm: number;
  selectedIndex?: number | null;
  onNoteSelect?: (index: number) => void;
}) {
  const preview = useScorePreview(notes);
  const current = preview.currentNote;
  const [view, setView] = useState<"measures" | "tiles">("measures");
  const measures = useMemo(
    () => buildScoreMeasures(notes, timeSignatures, bpm, measureStarts),
    [notes, timeSignatures, bpm, measureStarts]
  );
  const visibleNotes = notes.slice(0, 240);

  return (
    <>
      <section className="panel preview-panel">
        <div className="section-heading preview-heading">
          <div>
            <span className="eyebrow">03 / PREVIEW</span>
            <h2>演奏预览</h2>
          </div>
          <span className="data-note">WEB AUDIO · PITCH PREVIEW</span>
        </div>

        <div className="preview-layout">
          <div className="preview-now">
            <span className="preview-status-label">NOW PLAYING</span>
            {current ? (
              <>
                <strong className="preview-jianpu">{jianpuLabel(current)}</strong>
                <kbd className="preview-keycap">{current.key}</kbd>
                <span className="preview-midi">{midiName(current.pitch)}</span>
              </>
            ) : (
              <>
                <strong className="preview-jianpu idle">—</strong>
                <span className="preview-idle-copy">{notes.length ? "等待下一个音符" : "载入乐谱后可试听"}</span>
              </>
            )}
          </div>

          <div className="preview-console">
            <div className="preview-controls">
              <button className="button primary preview-play" disabled={notes.length === 0} onClick={preview.toggle}>
                {preview.playing ? "Ⅱ 暂停" : "▶ 试听"}
              </button>
              <button className="button secondary" disabled={notes.length === 0} onClick={preview.restart}>↺ 回到开头</button>
              <label className="preview-rate">
                <span>SPEED</span>
                <select value={preview.rate} disabled={notes.length === 0} onChange={(event) => preview.setRate(Number(event.target.value))}>
                  <option value={0.5}>0.50×</option>
                  <option value={0.75}>0.75×</option>
                  <option value={1}>1.00×</option>
                  <option value={1.25}>1.25×</option>
                  <option value={1.5}>1.50×</option>
                </select>
              </label>
              <span className="preview-clock">{formatTime(preview.currentTime)} / {formatTime(preview.duration)}</span>
            </div>

            <div className="preview-seek">
              <input
                type="range"
                min={0}
                max={Math.max(preview.duration, 1)}
                step={10}
                value={Math.min(preview.currentTime, Math.max(preview.duration, 1))}
                disabled={notes.length === 0}
                aria-label="试听进度"
                onChange={(event) => preview.seek(Number(event.target.value))}
              />
            </div>

            <div className="preview-modifiers" aria-label="当前修饰键状态">
              <span className={current?.octaveModifier === -1 ? "active" : ""}>↓ OCT</span>
              <span className={current?.sharp ? "active" : ""}># SHARP</span>
              <span className={current?.octaveModifier === 1 ? "active" : ""}>↑ OCT</span>
              <small>当前为浏览器合成音高预览，后续可替换为实测口琴采样。</small>
            </div>

            <div className="preview-keyboard" aria-label="三角洲口琴键位">
              {KEY_ORDER.map((key) => (
                <div className={`preview-key ${current?.key === key ? "active" : ""}`} key={key}>
                  <span>{key}</span>
                  <small>{key === "," ? "1̇" : KEY_ORDER.indexOf(key) + 1}</small>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      <section className="panel score-panel">
        <div className="section-heading score-heading">
          <div><span className="eyebrow">04 / SCORE</span><h2>正式谱面</h2></div>
          <div className="score-view-tabs" aria-label="谱面显示模式">
            <button className={view === "measures" ? "active" : ""} onClick={() => setView("measures")}>小节谱</button>
            <button className={view === "tiles" ? "active" : ""} onClick={() => setView("tiles")}>键位流</button>
          </div>
        </div>

        {notes.length > 0 ? (
          view === "measures" ? (
            <MeasureScore
              measures={measures}
              activeIndex={preview.activeIndex}
              selectedIndex={selectedIndex}
              onSelect={(index) => {
                preview.seek(notes[index]?.start ?? 0);
                onNoteSelect?.(index);
              }}
            />
          ) : (
            <div className="legacy-score">
              <div className="score-grid">
                {visibleNotes.map((note, index) => (
                  <NoteTile
                    note={note}
                    active={index === preview.activeIndex}
                    onSelect={() => {
                      preview.seek(note.start);
                      onNoteSelect?.(index);
                    }}
                    key={`${note.start}-${note.pitch}-${index}`}
                  />
                ))}
              </div>
              {notes.length > 240 && <p className="preview-limit">键位流只展示前 240 个音符；小节谱与试听使用完整转换结果。</p>}
            </div>
          )
        ) : (
          <div className="empty-score">
            <strong>NO SCORE LOADED</strong>
            <span>导入 MIDI / MusicXML / MXL，或者先用 Demo 查看当前映射效果。</span>
          </div>
        )}

        {notes.length > 0 && (
          <p className="preview-limit">{notes.length} PLAYABLE / {unplayableCount} OUT OF RANGE · {measures.length} MEASURES</p>
        )}
      </section>
    </>
  );
}
