import { useEffect, useMemo, useRef, useState } from "react";
import { displayOctave, midiName, modifierLabel } from "../harmonica/mapping";
import type { ScoreMeasure } from "../score/measures";
import { durationLabel } from "../score/measures";
import { snapDragDelta } from "../score/editNotes";

const MEASURES_PER_PAGE = 8;

function jianpu(note: ScoreMeasure["notes"][number]["note"]) {
  const octave = displayOctave(note);
  return {
    high: octave > 0 ? "•".repeat(octave) : "",
    low: octave < 0 ? "•".repeat(Math.abs(octave)) : ""
  };
}

function restSegments(measure: ScoreMeasure) {
  const sorted = [...measure.notes].sort((a, b) => a.offsetBeats - b.offsetBeats);
  const rests: Array<{ start: number; duration: number }> = [];
  let cursor = 0;
  for (const item of sorted) {
    const start = Math.max(0, item.offsetBeats);
    if (start - cursor >= 0.24) rests.push({ start: cursor, duration: start - cursor });
    cursor = Math.max(cursor, start + item.durationBeats);
  }
  if (measure.lengthBeats - cursor >= 0.24) {
    rests.push({ start: cursor, duration: measure.lengthBeats - cursor });
  }
  return rests;
}

export function MeasureScore({
  measures,
  activeIndex,
  selectedIndex,
  selectedIndices,
  insertionBeat,
  editStep,
  onInsertionSelect,
  onMove,
  onResize,
  onSelect
}: {
  measures: ScoreMeasure[];
  activeIndex: number;
  /** Note being edited, highlighted separately from the playback cursor. */
  selectedIndex?: number | null;
  selectedIndices?: number[];
  insertionBeat?: number | null;
  editStep?: number;
  onInsertionSelect?: (beat: number) => void;
  onMove?: (index: number, deltaBeats: number) => void;
  onResize?: (index: number, deltaBeats: number) => void;
  onSelect: (index: number, mode?: "replace" | "toggle" | "range") => void;
}) {
  const [page, setPage] = useState(0);
  const [dragging, setDragging] = useState<{ index: number; mode: "move" | "resize"; delta: number } | null>(null);
  const dragRef = useRef<{
    index: number;
    mode: "move" | "resize";
    startX: number;
    laneWidth: number;
    measureBeats: number;
    delta: number;
  } | null>(null);
  const suppressClick = useRef(false);
  const pageCount = Math.max(1, Math.ceil(measures.length / MEASURES_PER_PAGE));

  const activeMeasure = useMemo(
    () => measures.findIndex((measure) => measure.notes.some((item) => item.index === activeIndex)),
    [measures, activeIndex]
  );
  const selectedMeasure = useMemo(
    () => measures.findIndex((measure) => measure.notes.some((item) => item.index === selectedIndex)),
    [measures, selectedIndex]
  );

  useEffect(() => {
    if (activeMeasure >= 0) setPage(Math.floor(activeMeasure / MEASURES_PER_PAGE));
  }, [activeMeasure]);

  useEffect(() => {
    if (selectedMeasure >= 0) setPage(Math.floor(selectedMeasure / MEASURES_PER_PAGE));
  }, [selectedMeasure]);

  function startDrag(
    event: React.PointerEvent<HTMLElement>,
    index: number,
    mode: "move" | "resize",
    measureBeats: number
  ) {
    if (event.button !== 0 || (mode === "move" && !onMove) || (mode === "resize" && !onResize)) return;
    event.stopPropagation();
    const lane = event.currentTarget.closest(".measure-lane");
    if (!(lane instanceof HTMLElement)) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = { index, mode, startX: event.clientX, laneWidth: lane.getBoundingClientRect().width, measureBeats, delta: 0 };
    suppressClick.current = false;
    setDragging({ index, mode, delta: 0 });
  }

  function updateDrag(event: React.PointerEvent<HTMLElement>) {
    const drag = dragRef.current;
    if (!drag) return;
    const delta = snapDragDelta(event.clientX - drag.startX, drag.laneWidth, drag.measureBeats, editStep ?? 0.5);
    drag.delta = delta;
    if (delta !== 0) suppressClick.current = true;
    setDragging({ index: drag.index, mode: drag.mode, delta });
  }

  function finishDrag(event: React.PointerEvent<HTMLElement>) {
    const drag = dragRef.current;
    if (!drag) return;
    event.stopPropagation();
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    dragRef.current = null;
    setDragging(null);
    if (drag.delta === 0) return;
    if (drag.mode === "move") onMove?.(drag.index, drag.delta);
    else onResize?.(drag.index, drag.delta);
  }

  useEffect(() => {
    if (page >= pageCount) setPage(pageCount - 1);
  }, [page, pageCount]);

  const visible = measures.slice(page * MEASURES_PER_PAGE, (page + 1) * MEASURES_PER_PAGE);

  return (
    <div className="measure-score">
      <div className="measure-toolbar">
        <div>
          <strong>小节谱</strong>
          <span>点击空白设置插入点 · 拖动音符移动 · 拖动右侧把手改时值 · 操作按编辑步长吸附</span>
        </div>
        <div className="measure-pagination">
          <button className="button secondary" disabled={page <= 0} onClick={() => setPage((value) => Math.max(0, value - 1))}>← 上一页</button>
          <b>{String(page + 1).padStart(2, "0")} / {String(pageCount).padStart(2, "0")}</b>
          <button className="button secondary" disabled={page >= pageCount - 1} onClick={() => setPage((value) => Math.min(pageCount - 1, value + 1))}>下一页 →</button>
        </div>
      </div>

      <div className="measure-list">
        {visible.map((measure) => {
          const rests = restSegments(measure);
          return (
            <article className={`measure-card ${measure.notes.some((item) => item.index === activeIndex) ? "active" : ""}`} key={`${measure.number}-${measure.startBeat}`}>
              <header>
                <span>BAR {String(measure.number).padStart(3, "0")}</span>
                <strong>{measure.numerator}/{measure.denominator}</strong>
                <small>{Math.round(measure.lengthBeats * 100) / 100} quarter-beats</small>
              </header>
              <div
                className={`measure-lane ${onInsertionSelect ? "editable" : ""}`}
                onClick={(event) => {
                  if (!onInsertionSelect) return;
                  const bounds = event.currentTarget.getBoundingClientRect();
                  const fraction = Math.min(1, Math.max(0, (event.clientX - bounds.left) / Math.max(1, bounds.width)));
                  const rawBeat = measure.startBeat + fraction * measure.lengthBeats;
                  const step = Math.max(1 / 32, editStep ?? 0.5);
                  const snapped = Math.round(rawBeat / step) * step;
                  onInsertionSelect(Math.min(measure.endBeat - 1 / 96, Math.max(measure.startBeat, snapped)));
                }}
              >
                {Array.from({ length: Math.max(0, measure.numerator - 1) }, (_, index) => (
                  <i className="beat-guide" style={{ left: `${((index + 1) / measure.numerator) * 100}%` }} key={index} />
                ))}

                {rests.map((rest, index) => (
                  <span
                    className="rest-block"
                    key={`rest-${index}`}
                    style={{
                      left: `${(rest.start / measure.lengthBeats) * 100}%`,
                      width: `${Math.min(100 - (rest.start / measure.lengthBeats) * 100, (rest.duration / measure.lengthBeats) * 100)}%`
                    }}
                    title={`休止 ${durationLabel(rest.duration)}`}
                  >
                    <b>—</b><small>R</small>
                  </span>
                ))}

                {insertionBeat !== null && insertionBeat !== undefined && insertionBeat >= measure.startBeat && insertionBeat < measure.endBeat && (
                  <span
                    className="insertion-caret"
                    style={{ left: `${((insertionBeat - measure.startBeat) / measure.lengthBeats) * 100}%` }}
                    aria-label={`插入位置，第 ${insertionBeat + 1} 拍`}
                  ><b>＋</b></span>
                )}

                {measure.notes.map((item) => {
                  const dots = jianpu(item.note);
                  const modifiers = modifierLabel(item.note);
                  const clippedDuration = Math.max(1 / 96, Math.min(item.durationBeats, measure.lengthBeats - item.offsetBeats));
                  const left = Math.max(0, item.offsetBeats / measure.lengthBeats * 100);
                  const width = Math.max(2.6, Math.min(100 - left, clippedDuration / measure.lengthBeats * 100));
                  const drag = dragging && (
                    dragging.index === item.index
                    || (dragging.mode === "move" && selectedIndices?.includes(dragging.index) && selectedIndices.includes(item.index))
                  ) ? dragging : null;
                  const dragPercent = drag ? drag.delta / measure.lengthBeats * 100 : 0;
                  const previewWidth = drag?.mode === "resize"
                    ? Math.max(2.6, Math.min(100 - left, (clippedDuration + drag.delta) / measure.lengthBeats * 100))
                    : width;
                  return (
                    <button
                      className={`measure-note ${item.index === activeIndex ? "active" : ""} ${(selectedIndices?.includes(item.index) || item.index === selectedIndex) ? "editing" : ""} ${drag ? "dragging" : ""}`}
                      style={{
                        left: `${left}%`,
                        width: `${previewWidth}%`,
                        transform: drag?.mode === "move" ? `translateX(${dragPercent / Math.max(width, 0.01) * 100}%)` : undefined
                      }}
                      onPointerDown={(event) => startDrag(event, item.index, "move", measure.lengthBeats)}
                      onPointerMove={updateDrag}
                      onPointerUp={finishDrag}
                      onPointerCancel={finishDrag}
                      onClick={(event) => {
                        event.stopPropagation();
                        if (suppressClick.current) {
                          suppressClick.current = false;
                          return;
                        }
                        onSelect(item.index, event.shiftKey ? "range" : (event.ctrlKey || event.metaKey) ? "toggle" : "replace");
                      }}
                      title={`${midiName(item.note.pitch)} · ${durationLabel(item.durationBeats)} · ${item.note.key}${modifiers}`}
                      key={`${item.index}-${item.beat}`}
                    >
                      <span className="measure-degree">
                        <span className="measure-dots top">{dots.high}</span>
                        <span className="measure-digit">{item.note.sharp && <sup>#</sup>}<b>{item.note.degree}</b></span>
                        <span className="measure-dots bottom">{dots.low}</span>
                      </span>
                      <kbd>{item.note.key}{modifiers && <em>{modifiers}</em>}</kbd>
                      <small>{durationLabel(item.durationBeats)}</small>
                      <span
                        className="note-resize-handle"
                        aria-hidden="true"
                        onPointerDown={(event) => startDrag(event, item.index, "resize", measure.lengthBeats)}
                      />
                    </button>
                  );
                })}
              </div>
              <div className="measure-beats">
                {Array.from({ length: measure.numerator }, (_, index) => <span key={index}>{index + 1}</span>)}
              </div>
            </article>
          );
        })}
      </div>
    </div>
  );
}
