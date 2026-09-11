import { useEffect, useMemo, useState } from "react";
import { displayOctave, midiName, modifierLabel } from "../harmonica/mapping";
import type { ScoreMeasure } from "../score/measures";
import { durationLabel } from "../score/measures";

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
  onSelect
}: {
  measures: ScoreMeasure[];
  activeIndex: number;
  /** Note being edited, highlighted separately from the playback cursor. */
  selectedIndex?: number | null;
  onSelect: (index: number) => void;
}) {
  const [page, setPage] = useState(0);
  const pageCount = Math.max(1, Math.ceil(measures.length / MEASURES_PER_PAGE));

  const activeMeasure = useMemo(
    () => measures.findIndex((measure) => measure.notes.some((item) => item.index === activeIndex)),
    [measures, activeIndex]
  );

  useEffect(() => {
    if (activeMeasure >= 0) setPage(Math.floor(activeMeasure / MEASURES_PER_PAGE));
  }, [activeMeasure]);

  useEffect(() => {
    if (page >= pageCount) setPage(pageCount - 1);
  }, [page, pageCount]);

  const visible = measures.slice(page * MEASURES_PER_PAGE, (page + 1) * MEASURES_PER_PAGE);

  return (
    <div className="measure-score">
      <div className="measure-toolbar">
        <div>
          <strong>小节谱</strong>
          <span>按拍号排版 · 空白区间自动显示休止 · 播放时自动翻页 · 键位上的 ↑ / ↓ 为升调 / 降调（鼠标右键 / 左键），# 为半音（中键）</span>
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
              <div className="measure-lane">
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

                {measure.notes.map((item) => {
                  const dots = jianpu(item.note);
                  const modifiers = modifierLabel(item.note);
                  const clippedDuration = Math.max(1 / 96, Math.min(item.durationBeats, measure.lengthBeats - item.offsetBeats));
                  const left = Math.max(0, item.offsetBeats / measure.lengthBeats * 100);
                  const width = Math.max(2.6, Math.min(100 - left, clippedDuration / measure.lengthBeats * 100));
                  return (
                    <button
                      className={`measure-note ${item.index === activeIndex ? "active" : ""} ${item.index === selectedIndex ? "editing" : ""}`}
                      style={{ left: `${left}%`, width: `${width}%` }}
                      onClick={() => onSelect(item.index)}
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
