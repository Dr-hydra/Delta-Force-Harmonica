import { useEffect, useMemo, useState } from "react";
import { SCORE_FILE_ACCEPT, parseScoreFile } from "./import/parseScoreFile";
import type { ParseProgress } from "./import/parseScoreFile";
import { AUDIO_PRESETS, type AudioTranscriptionPreset } from "./audio/presets";
import { quantizeToGrid } from "./audio/beats";
import { enforceMonophonic } from "./music/monophonic";
import { extractSmartMelody } from "./music/smartMelody";
import { findBestTranspose, optimizeHarmonica } from "./harmonica/optimizer";
import { MAPPING_ASSUMPTIONS, midiName } from "./harmonica/mapping";
import {
  deleteNote,
  insertNote,
  moveNote,
  normalizeNotes,
  resizeNote,
  snapAll,
  transposeNote,
  type EditResult
} from "./score/editNotes";
import { ScoreWorkspace } from "./components/ScoreWorkspace";
import {
  buildKeySequence,
  GAME_BINDING,
  key as keyTarget,
  mouse as mouseTarget,
  targetId,
  type InputBinding,
  type InputTarget
} from "./export/keySequence";
import { toLogitechLua } from "./export/logitech";
import { razerSupportsTarget, toRazerXml } from "./export/razer";
import { toTabText } from "./export/tab";
import type { NoteEvent, ParsedSong, TimeSignatureEvent } from "./music/types";

const DEMO_BPM = 143;
const DEMO_SIGNATURES: TimeSignatureEvent[] = [{ beat: 0, numerator: 4, denominator: 4 }];
const DEMO_MEASURE_STARTS = [0, 4, 8, 12];
const demoNotes: NoteEvent[] = [60, 62, 64, 65, 67, 69, 71, 72, 71, 69, 67, 65, 64, 62, 60]
  .map((pitch, index) => ({
    pitch,
    start: index * 420,
    duration: 330,
    beat: index,
    durationBeats: 0.78,
    velocity: 0.8
  }));

// The harmonica sounds one note at a time, so every path ends in enforceMonophonic.
// That makes a separate "skyline / highest note" mode meaningless: it is exactly
// what enforcement already does to the untouched note list.
type MelodyMode = "original" | "smart";
type AudioStage = "raw" | "clean" | "smart";

function formatDuration(ms: number) {
  const total = Math.max(0, Math.round(ms / 1000));
  const minutes = Math.floor(total / 60);
  const seconds = String(total % 60).padStart(2, "0");
  return `${minutes}:${seconds}`;
}

/** Bindings the game plausibly uses, so the export panel never needs free text. */
const MODIFIER_CHOICES: Array<{ id: string; label: string; target: InputTarget }> = [
  { id: "mouse:right", label: "鼠标右键", target: mouseTarget("right") },
  { id: "mouse:left", label: "鼠标左键", target: mouseTarget("left") },
  { id: "mouse:middle", label: "鼠标中键", target: mouseTarget("middle") },
  { id: "key:lshift", label: "左 Shift", target: keyTarget("lshift") },
  { id: "key:lctrl", label: "左 Ctrl", target: keyTarget("lctrl") },
  { id: "key:lalt", label: "左 Alt", target: keyTarget("lalt") },
  { id: "key:space", label: "空格", target: keyTarget("space") }
];

function choiceTarget(id: string, fallback: InputTarget): InputTarget {
  return MODIFIER_CHOICES.find((choice) => choice.id === id)?.target ?? fallback;
}

function downloadText(filename: string, content: string, type: string) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

function safeFileName(name: string) {
  return (name.replace(/[\\/:*?"<>|]+/g, "_").trim() || "dfh-score").slice(0, 80);
}

function sourceFormatLabel(song: ParsedSong | null, usingDemo: boolean) {
  if (usingDemo) return "DEMO";
  if (!song) return "LOCAL";
  if (song.sourceFormat === "midi") return "MIDI";
  if (song.sourceFormat === "mxl") return "MXL";
  if (song.sourceFormat === "audio") return "AUDIO β";
  return "MUSICXML";
}

export default function App() {
  const [theme, setTheme] = useState(() => localStorage.getItem("dfh-theme") || "light");
  const [song, setSong] = useState<ParsedSong | null>(null);
  const [trackId, setTrackId] = useState("");
  const [transpose, setTranspose] = useState(0);
  const [melodyMode, setMelodyMode] = useState<MelodyMode>("original");
  const [audioPreset, setAudioPreset] = useState<AudioTranscriptionPreset>("balanced");
  const [audioStage, setAudioStage] = useState<AudioStage>("smart");
  const [quantizeDivisions, setQuantizeDivisions] = useState(2);
  const [loadedFile, setLoadedFile] = useState<File | null>(null);
  const [usingDemo, setUsingDemo] = useState(false);
  const [busy, setBusy] = useState(false);
  const [parseProgress, setParseProgress] = useState<ParseProgress | null>(null);
  const [error, setError] = useState("");
  const [octaveUpId, setOctaveUpId] = useState(targetId(GAME_BINDING.octaveUp));
  const [octaveDownId, setOctaveDownId] = useState(targetId(GAME_BINDING.octaveDown));
  const [semitoneId, setSemitoneId] = useState(targetId(GAME_BINDING.semitone));
  const [gKey, setGKey] = useState(1);
  const [exportError, setExportError] = useState("");
  const [editedNotes, setEditedNotes] = useState<NoteEvent[] | null>(null);
  const [undoStack, setUndoStack] = useState<NoteEvent[][]>([]);
  const [redoStack, setRedoStack] = useState<NoteEvent[][]>([]);
  const [selectedNote, setSelectedNote] = useState<number | null>(null);
  const [editStep, setEditStep] = useState(0.5);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem("dfh-theme", theme);
  }, [theme]);

  const selectedTrack = song?.tracks.find((track) => track.id === trackId) ?? song?.tracks[0];
  const isAudio = !usingDemo && song?.sourceFormat === "audio";
  const audioAnalysis = song?.audioAnalysis;
  const baseNotes = usingDemo ? demoNotes : selectedTrack?.notes ?? [];

  const beatGrid = audioAnalysis?.beatGrid;

  const audioStageNotes = useMemo(() => {
    if (!isAudio || !audioAnalysis) return [];
    const source = audioStage === "raw"
      ? audioAnalysis.rawNotes
      : audioStage === "clean"
        ? audioAnalysis.cleanedNotes
        : extractSmartMelody(audioAnalysis.cleanedNotes);
    if (!beatGrid || quantizeDivisions < 1) return source;
    return quantizeToGrid(source, beatGrid, quantizeDivisions);
  }, [isAudio, audioAnalysis, audioStage, beatGrid, quantizeDivisions]);

  const derivedNotes = useMemo(() => {
    if (isAudio) return audioStageNotes;
    if (melodyMode === "original") return baseNotes;
    return extractSmartMelody(baseNotes);
  }, [isAudio, audioStageNotes, baseNotes, melodyMode]);

  // The in-game harmonica sounds one note at a time, so the chord collapse runs
  // before the editor rather than after it: the editor has to work on the notes
  // that are actually on screen, otherwise deleting a note would only uncover
  // the chord tone hidden underneath it.
  const derivedMono = useMemo(() => enforceMonophonic(derivedNotes), [derivedNotes]);

  // Once anything is edited the edited copy wins; until then the score stays a
  // pure function of the import settings, so changing a preset still takes effect.
  const melodyNotes = editedNotes ?? derivedMono.notes;
  const editing = editedNotes !== null;

  // Second pass, a no-op for imported material: it only catches overlaps the
  // user just created by hand, so score, preview and macro never disagree.
  const mono = useMemo(() => enforceMonophonic(melodyNotes), [melodyNotes]);

  const conversion = useMemo(() => optimizeHarmonica(mono.notes, transpose), [mono.notes, transpose]);
  const playableRate = mono.notes.length === 0
    ? 0
    : Math.round((conversion.notes.length / mono.notes.length) * 100);

  // A game note carries its index in the enforced list; the editor indexes the
  // list before that pass, so the two have to be composed.
  const editIndexOf = (index: number) => {
    const sourceIndex = conversion.notes[index]?.sourceIndex;
    if (sourceIndex === undefined) return null;
    return mono.sourceIndices[sourceIndex] ?? null;
  };

  const binding = useMemo<InputBinding>(() => ({
    notes: GAME_BINDING.notes,
    octaveUp: choiceTarget(octaveUpId, GAME_BINDING.octaveUp),
    octaveDown: choiceTarget(octaveDownId, GAME_BINDING.octaveDown),
    semitone: choiceTarget(semitoneId, GAME_BINDING.semitone)
  }), [octaveUpId, octaveDownId, semitoneId]);

  const keySequence = useMemo(
    () => buildKeySequence(conversion.notes, { binding }),
    [conversion.notes, binding]
  );
  const razerBlockers = useMemo(
    () => [binding.octaveUp, binding.octaveDown, binding.semitone].filter((target) => !razerSupportsTarget(target)),
    [binding]
  );

  function applyEdit(operation: (notes: NoteEvent[], bpm: number) => EditResult) {
    const current = editedNotes ?? normalizeNotes(melodyNotes, bpm || 120);
    const result = operation(current, bpm || 120);
    if (result.notes === current && result.selected === selectedNote) return;
    setUndoStack((stack) => [...stack.slice(-49), current]);
    setRedoStack([]);
    setEditedNotes(result.notes);
    setSelectedNote(result.selected);
  }

  function undoEdit() {
    const previous = undoStack.at(-1);
    if (!previous) return;
    setUndoStack((stack) => stack.slice(0, -1));
    setRedoStack((stack) => [...stack, editedNotes ?? normalizeNotes(melodyNotes, bpm || 120)]);
    setEditedNotes(previous);
    setSelectedNote((index) => (index !== null ? Math.min(index, previous.length - 1) : null));
  }

  function redoEdit() {
    const next = redoStack.at(-1);
    if (!next) return;
    setRedoStack((stack) => stack.slice(0, -1));
    setUndoStack((stack) => [...stack, editedNotes ?? normalizeNotes(melodyNotes, bpm || 120)]);
    setEditedNotes(next);
    setSelectedNote((index) => (index !== null ? Math.min(index, next.length - 1) : null));
  }

  function resetEdits() {
    setEditedNotes(null);
    setUndoStack([]);
    setRedoStack([]);
    setSelectedNote(null);
  }

  function startBlankScore() {
    setUndoStack((stack) => [...stack, editedNotes ?? normalizeNotes(melodyNotes, bpm || 120)]);
    setRedoStack([]);
    setEditedNotes([]);
    setSelectedNote(null);
  }

  function exportTab() {
    setExportError("");
    downloadText(
      `${safeFileName(title)}.txt`,
      toTabText(conversion.notes, {
        songName: title,
        bpm: bpm || 120,
        timeSignatures,
        measureStarts,
        transpose,
        unplayableCount: conversion.unplayable.length
      }),
      "text/plain;charset=utf-8"
    );
  }

  function exportLogitech() {
    setExportError("");
    downloadText(
      `${safeFileName(title)}-logitech.lua`,
      toLogitechLua(keySequence, { songName: title, gKey, transpose }),
      "text/plain;charset=utf-8"
    );
  }

  function exportRazer() {
    setExportError("");
    try {
      downloadText(
        `${safeFileName(title)}-razer.xml`,
        toRazerXml(keySequence, { songName: title }),
        "application/xml;charset=utf-8"
      );
    } catch (reason) {
      setExportError(reason instanceof Error ? reason.message : "雷蛇宏导出失败。");
    }
  }

  async function loadFile(file: File, preset: AudioTranscriptionPreset = audioPreset) {
    setBusy(true);
    setError("");
    setParseProgress(null);
    try {
      const parsed = await parseScoreFile(file, setParseProgress, { audioPreset: preset });
      resetEdits();
      setSong(parsed);
      setTrackId(parsed.tracks[0].id);
      setTranspose(0);
      setUsingDemo(false);
      setLoadedFile(file);
      if (parsed.sourceFormat === "audio") {
        setAudioPreset(preset);
        setAudioStage("smart");
      } else {
        setMelodyMode("original");
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "乐谱解析失败。");
    } finally {
      setBusy(false);
      setParseProgress(null);
    }
  }

  function autoTranspose() {
    if (mono.notes.length === 0) return;
    const best = findBestTranspose(mono.notes);
    setTranspose(best.transpose);
  }

  function loadDemo() {
    resetEdits();
    setSong(null);
    setTrackId("");
    setTranspose(0);
    setUsingDemo(true);
    setLoadedFile(null);
    setMelodyMode("original");
    setParseProgress(null);
    setError("");
  }

  const title = usingDemo ? "C 大调音阶 Demo" : song?.name ?? "尚未载入乐曲";
  const bpm = usingDemo ? DEMO_BPM : song?.bpm ?? 0;
  const duration = usingDemo
    ? demoNotes[demoNotes.length - 1].start + demoNotes[demoNotes.length - 1].duration
    : song?.duration ?? 0;
  const timeSignatures = usingDemo ? DEMO_SIGNATURES : song?.timeSignatures ?? DEMO_SIGNATURES;
  const measureStarts = usingDemo ? DEMO_MEASURE_STARTS : song?.measureStarts ?? [];
  const formatLabel = sourceFormatLabel(song, usingDemo);
  const busyPercent = parseProgress ? Math.round(parseProgress.value * 100) : null;
  const audioStats = audioAnalysis?.stats;
  const audioPresetConfig = AUDIO_PRESETS[audioPreset];

  return (
    <div className="app-shell">
      <aside className="side-rail">
        <button className="brand" onClick={() => scrollTo({ top: 0, behavior: "smooth" })}>
          <span>DFH</span>
          <b>DELTA FORCE<br />HARMONICA</b>
        </button>
        <nav aria-label="主导航">
          <button className="active"><i>01</i><span>乐谱转换</span></button>
          <button disabled><i>02</i><span>云端乐谱</span><em>SOON</em></button>
          <button disabled><i>03</i><span>练习模式</span><em>SOON</em></button>
          <button disabled><i>04</i><span>映射实验</span><em>LAB</em></button>
        </nav>
        <div className="rail-bottom">
          <b>α</b>
          <span>ENGINE 0.5<br />PURE FRONTEND</span>
        </div>
      </aside>

      <header className="top-status">
        <span><i className="status-dot" />LOCAL ENGINE / 浏览器本地处理</span>
        <button onClick={() => setTheme(theme === "dark" ? "light" : "dark")}>{theme === "dark" ? "LIGHT" : "DARK"} MODE</button>
      </header>

      <main className="page-content">
        <section className="hero panel">
          <div>
            <span className="eyebrow">DELTA FORCE / HARMONICA COMPILER</span>
            <h1>把乐谱编译成<br /><mark>可演奏</mark>的口琴谱</h1>
            <p>文件只在浏览器中解析。音频实验版有三档识别强度、弱音与碎音清洗，默认输出「原版」密度；不满意可以切到「精简」只跟一条声部，或切到 RAW 判断问题出在转录还是清洗。</p>
          </div>
          <div className="hero-code" aria-hidden="true">
            <b>1</b><b>2</b><b>3</b><b>4</b><b>5</b><b>6</b><b>7</b><b>1̇</b>
            <span>Z</span><span>X</span><span>C</span><span>V</span><span>B</span><span>N</span><span>M</span><span>,</span>
          </div>
        </section>

        <section className="workflow-grid">
          <article className="panel upload-panel">
            <div className="section-heading">
              <div><span className="eyebrow">01 / SOURCE</span><h2>导入乐曲</h2></div>
              <span className="data-note">MIDI · XML · MXL · AUDIO β</span>
            </div>
            <label
              className={`drop-zone ${busy ? "busy" : ""}`}
              onDragOver={(event) => event.preventDefault()}
              onDrop={(event) => {
                event.preventDefault();
                if (busy) return;
                const file = event.dataTransfer.files?.[0];
                if (file) void loadFile(file);
              }}
            >
              <input type="file" accept={SCORE_FILE_ACCEPT} disabled={busy} onChange={(event) => {
                const file = event.currentTarget.files?.[0];
                if (file) void loadFile(file);
                event.currentTarget.value = "";
              }} />
              <strong>{busy ? `${parseProgress?.label ?? "正在解析…"}${busyPercent !== null ? ` · ${busyPercent}%` : ""}` : "拖入乐谱或音频，或点击选择文件"}</strong>
              {busy && parseProgress && (
                <progress
                  value={parseProgress.value}
                  max={1}
                  aria-label="音频转谱进度"
                  style={{ width: "min(360px, 82%)", accentColor: "var(--accent)" }}
                />
              )}
              <span>原始文件不会上传 · 推荐 .mid / .musicxml / .mxl · 纯伴奏音频 .mp3 / .wav / .ogg / .flac</span>
            </label>

            <label className="field" style={{ marginTop: 16 }}>
              <span>AUDIO 识别预设</span>
              <select
                value={audioPreset}
                disabled={busy}
                onChange={(event) => setAudioPreset(event.target.value as AudioTranscriptionPreset)}
              >
                {(Object.entries(AUDIO_PRESETS) as Array<[AudioTranscriptionPreset, (typeof AUDIO_PRESETS)[AudioTranscriptionPreset]]>).map(([id, preset]) => (
                  <option key={id} value={id}>{preset.label}</option>
                ))}
              </select>
              <small style={{ color: "var(--muted)", lineHeight: 1.55 }}>{audioPresetConfig.description}</small>
            </label>

            <button className="text-action" onClick={loadDemo}>没有乐谱？载入音阶 Demo →</button>
            {isAudio && loadedFile && (
              <button className="text-action" disabled={busy} onClick={() => void loadFile(loadedFile, audioPreset)}>
                用当前预设重新分析这个音频 →
              </button>
            )}
            <p className="preview-limit">音频转谱只面向纯伴奏与器乐录音，<strong>带人声的完整混音不在支持范围内</strong>——人声会盖住主旋律，结果不可用，这种情况请改用 MIDI 或 MusicXML。伴奏先试“标准 / 推荐”，音符仍过密时切换“长音优先”（会删掉短音符）。预设会改变 Basic Pitch 解码阈值和后处理强度。</p>
            {error && <p className="error-note">{error}</p>}
          </article>

          <article className="panel control-panel">
            <div className="section-heading">
              <div><span className="eyebrow">02 / OPTIMIZE</span><h2>演奏优化</h2></div>
              <span className="data-note">SMART PATH</span>
            </div>

            <label className="field">
              <span>轨道 / 声部</span>
              <select disabled={!song || usingDemo} value={selectedTrack?.id ?? ""} onChange={(event) => setTrackId(event.target.value)}>
                {usingDemo && <option value="">Demo Melody</option>}
                {!song && !usingDemo && <option value="">等待乐谱</option>}
                {song?.tracks.map((track) => <option value={track.id} key={track.id}>{track.name} · {track.instrument} · {track.notes.length} notes</option>)}
              </select>
            </label>

            {isAudio ? (
              <label className="field" style={{ marginTop: 18 }}>
                <span>音频分析阶段</span>
                <select value={audioStage} onChange={(event) => setAudioStage(event.target.value as AudioStage)}>
                  <option value="clean">原版 · 清洗后保留全部起音（推荐）</option>
                  <option value="smart">精简 · Smart Melody Path 只跟一条声部</option>
                  <option value="raw">RAW · Basic Pitch 原始候选（诊断用）</option>
                </select>
                <small style={{ color: "var(--muted)", lineHeight: 1.55 }}>
                  {audioStats
                    ? `RAW ${audioStats.rawCount} → CLEAN ${audioStats.cleanCount} · 弱音 -${audioStats.removedWeak} · 短音 -${audioStats.removedShort} · 合并 ${audioStats.mergedFragments} · 密集 -${audioStats.removedDensity}`
                    : "导入音频后可逐级试听，判断问题来自转录、清洗还是旋律提取。"}
                </small>
              </label>
            ) : (
              <label className="field" style={{ marginTop: 18 }}>
                <span>谱面密度</span>
                <select value={melodyMode} onChange={(event) => setMelodyMode(event.target.value as MelodyMode)}>
                  <option value="original">原版 · 保留全部起音（默认）</option>
                  <option value="smart">精简 · Smart Melody Path 只跟一条声部</option>
                </select>
                <small style={{ color: "var(--muted)", lineHeight: 1.55 }}>
                  原版保留这条轨道上的每一个起音，和弦取最高音；精简会主动丢掉伴奏起音去追一条连续声部，音符更少但可能漏掉旋律音。
                </small>
              </label>
            )}

            {isAudio && (
              <label className="field" style={{ marginTop: 18 }}>
                <span>节拍量化</span>
                <select
                  value={quantizeDivisions}
                  disabled={!beatGrid}
                  onChange={(event) => setQuantizeDivisions(Number(event.target.value))}
                >
                  <option value={0}>关闭 · 保留原始时间</option>
                  <option value={1}>1/4 拍</option>
                  <option value={2}>1/8 拍</option>
                  <option value={4}>1/16 拍</option>
                </select>
                <small style={{ color: "var(--muted)", lineHeight: 1.55 }}>
                  {beatGrid
                    ? `BPM ${beatGrid.bpm.toFixed(1)} · 检出 ${beatGrid.detectedCount} 个拍点 · 拍间隔中值 ${(beatGrid.medianInterval * 1000).toFixed(0)} ms${beatGrid.attempt > 0 ? ` · 放宽了 ${beatGrid.attempt} 档参数才估出，结果可信度较低` : ""}。节拍由 music-tempo（Beatroot）估算，只给拍点不给强拍，所以小节线的相位是推测的。`
                    : `${audioAnalysis?.beatFailure ?? "这段音频没能估出可用的节拍网格。"}谱面回退到 120 BPM 显示。`}
                </small>
              </label>
            )}

            <div className="transpose-row">
              <label className="field">
                <span>移调 <b>{transpose > 0 ? `+${transpose}` : transpose}</b> semitone</span>
                <input type="range" min="-12" max="12" step="1" value={transpose} onChange={(event) => setTranspose(Number(event.target.value))} />
              </label>
              <button className="button primary" disabled={melodyNotes.length === 0} onClick={autoTranspose}>自动适配</button>
            </div>

            <p className="preview-limit">
              游戏里的口琴同时只能出一个音，所以谱面、试听和宏都走同一道单音收敛：和弦只留最高音，前一个音在下一个起音处截断，起音位置不动。
              {derivedMono.collapsedChordNotes + derivedMono.truncatedNotes > 0
                ? ` 素材收敛掉 ${derivedMono.collapsedChordNotes} 个同时发声的音，截断 ${derivedMono.truncatedNotes} 处重叠。`
                : " 素材本来就是单音，这一步没有改动任何音符。"}
              {editing && mono.collapsedChordNotes + mono.truncatedNotes > 0
                ? ` 手工编辑又产生了 ${mono.collapsedChordNotes} 个同时发声的音和 ${mono.truncatedNotes} 处重叠，同样已收敛。`
                : ""}
            </p>
          </article>
        </section>

        <section className="song-head panel">
          <div>
            <span className="eyebrow">CURRENT SCORE <span className="source-format-tag">{formatLabel}</span></span>
            <h2>{title}</h2>
            <p>{selectedTrack && !usingDemo ? `${selectedTrack.name} / ${selectedTrack.instrument}` : usingDemo ? "INTERNAL DEMONSTRATION" : "导入乐谱后开始转换"}</p>
          </div>
          <div className="song-state"><strong>{playableRate}%</strong><span>PLAYABLE</span></div>
        </section>

        <section className="metric-grid">
          <article>
            <span>NOTES</span>
            <strong>{mono.notes.length || "—"}</strong>
            <small>
              {derivedNotes.length > derivedMono.notes.length
                ? `单音收敛后 · 素材 ${derivedNotes.length}`
                : isAudio ? `${audioStage.toUpperCase()} 当前音符` : "当前谱面音符"}
            </small>
          </article>
          <article><span>BPM</span><strong>{bpm ? (isAudio ? bpm.toFixed(1) : bpm) : "—"}</strong><small>{isAudio ? (beatGrid ? "music-tempo 估算" : "未估出，回退 120") : "首个 Tempo"}</small></article>
          <article><span>LENGTH</span><strong>{duration ? formatDuration(duration) : "—"}</strong><small>乐曲时长</small></article>
          <article className="metric-primary"><span>MOD CHANGES</span><strong>{conversion.notes.length ? conversion.modifierChanges : "—"}</strong><small>半音 / 八度状态切换</small></article>
        </section>

        <ScoreWorkspace
          notes={conversion.notes}
          unplayableCount={conversion.unplayable.length}
          timeSignatures={timeSignatures}
          measureStarts={measureStarts}
          bpm={bpm || 120}
          selectedIndex={conversion.notes.findIndex((_, index) => editIndexOf(index) === selectedNote)}
          onNoteSelect={(index) => setSelectedNote(editIndexOf(index))}
        />

        <section className="panel control-panel" style={{ marginTop: 18 }}>
          <div className="section-heading">
            <div><span className="eyebrow">04 / EDIT</span><h2>微调与手工编辑</h2></div>
            <span className="data-note">
              {editing ? `已编辑 · ${melodyNotes.length} 音符` : "未编辑"}
            </span>
          </div>

          <p className="preview-limit">
            在上面的小节谱里点一个音符即可选中（黑框标记），下面的操作作用于选中的音符。也可以从空白谱开始自己搭建。
            编辑出的重叠会被单音收敛截断，谱面上显示的时值可能短于这里的数值。
          </p>

          <div className="transpose-row" style={{ alignItems: "flex-end", flexWrap: "wrap" }}>
            <label className="field" style={{ minWidth: 150 }}>
              <span>编辑步长</span>
              <select value={editStep} onChange={(event) => setEditStep(Number(event.target.value))}>
                <option value={1}>1 拍</option>
                <option value={0.5}>1/2 拍</option>
                <option value={0.25}>1/4 拍</option>
              </select>
            </label>
            <button className="button secondary" disabled={undoStack.length === 0} onClick={undoEdit}>↶ 撤销</button>
            <button className="button secondary" disabled={redoStack.length === 0} onClick={redoEdit}>↷ 重做</button>
            <button className="button secondary" disabled={!editing} onClick={resetEdits}>放弃编辑</button>
            <button className="button" onClick={startBlankScore}>从空白谱开始</button>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(132px, 1fr))", gap: 8, marginTop: 16 }}>
            <button className="button" disabled={selectedNote === null} onClick={() => applyEdit((n, b) => transposeNote(n, selectedNote!, 1, b))}>音高 +1</button>
            <button className="button" disabled={selectedNote === null} onClick={() => applyEdit((n, b) => transposeNote(n, selectedNote!, -1, b))}>音高 −1</button>
            <button className="button" disabled={selectedNote === null} onClick={() => applyEdit((n, b) => transposeNote(n, selectedNote!, 12, b))}>+1 八度</button>
            <button className="button" disabled={selectedNote === null} onClick={() => applyEdit((n, b) => transposeNote(n, selectedNote!, -12, b))}>−1 八度</button>
            <button className="button" disabled={selectedNote === null} onClick={() => applyEdit((n, b) => moveNote(n, selectedNote!, -editStep, b))}>← 提前</button>
            <button className="button" disabled={selectedNote === null} onClick={() => applyEdit((n, b) => moveNote(n, selectedNote!, editStep, b))}>推后 →</button>
            <button className="button" disabled={selectedNote === null} onClick={() => applyEdit((n, b) => resizeNote(n, selectedNote!, editStep, b))}>时值 +</button>
            <button className="button" disabled={selectedNote === null} onClick={() => applyEdit((n, b) => resizeNote(n, selectedNote!, -editStep, b))}>时值 −</button>
            <button className="button" onClick={() => applyEdit((n, b) => insertNote(n, selectedNote, editStep, b))}>插入音符</button>
            <button className="button" disabled={selectedNote === null} onClick={() => applyEdit((n, b) => deleteNote(n, selectedNote!, b))}>删除音符</button>
            <button className="button" disabled={melodyNotes.length === 0} onClick={() => applyEdit((n, b) => ({ notes: snapAll(n, editStep, b), selected: selectedNote }))}>全部对齐到步长</button>
          </div>

          <p className="preview-limit">
            {selectedNote !== null && melodyNotes[selectedNote]
              ? `选中第 ${selectedNote + 1} / ${melodyNotes.length} 个音符 · ${midiName(melodyNotes[selectedNote].pitch)} · 第 ${((melodyNotes[selectedNote].beat ?? 0) + 1).toFixed(2)} 拍 · 时值 ${(melodyNotes[selectedNote].durationBeats ?? 0).toFixed(2)} 拍`
              : "未选中音符。插入音符会在选中音之后添加，没有选中时从第 1 拍开始。"}
          </p>
          {editing && (
            <p className="preview-limit">
              谱面已手工编辑，<strong>导入设置（预设、分析阶段、谱面密度、量化）的改动不会再生效</strong>，需要先「放弃编辑」。移调滑块仍然作用于编辑后的谱面。
            </p>
          )}
        </section>

        <section className="panel control-panel" style={{ marginTop: 18 }}>
          <div className="section-heading">
            <div><span className="eyebrow">05 / EXPORT</span><h2>导出</h2></div>
            <span className="data-note">{conversion.notes.length ? `${keySequence.actions.length} KEY EVENTS` : "NO SCORE"}</span>
          </div>

          <div className="transpose-row" style={{ alignItems: "flex-end" }}>
            <button className="button primary" disabled={conversion.notes.length === 0} onClick={exportTab}>
              人可演奏版 · 文本谱 .txt
            </button>
            <button className="button" disabled={conversion.notes.length === 0} onClick={exportLogitech}>
              宏 · 罗技 G HUB .lua
            </button>
            <button
              className="button"
              disabled={conversion.notes.length === 0 || razerBlockers.length > 0}
              onClick={exportRazer}
            >
              宏 · 雷蛇 Synapse 3 .xml（未验证）
            </button>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 12, marginTop: 18 }}>
            <label className="field">
              <span>升调</span>
              <select value={octaveUpId} onChange={(event) => setOctaveUpId(event.target.value)}>
                {MODIFIER_CHOICES.map((choice) => <option key={choice.id} value={choice.id}>{choice.label}</option>)}
              </select>
            </label>
            <label className="field">
              <span>降调</span>
              <select value={octaveDownId} onChange={(event) => setOctaveDownId(event.target.value)}>
                {MODIFIER_CHOICES.map((choice) => <option key={choice.id} value={choice.id}>{choice.label}</option>)}
              </select>
            </label>
            <label className="field">
              <span>半音</span>
              <select value={semitoneId} onChange={(event) => setSemitoneId(event.target.value)}>
                {MODIFIER_CHOICES.map((choice) => <option key={choice.id} value={choice.id}>{choice.label}</option>)}
              </select>
            </label>
            <label className="field">
              <span>罗技 G 键</span>
              <input type="number" min="1" max="12" value={gKey} onChange={(event) => setGKey(Number(event.target.value) || 1)} />
            </label>
          </div>

          <p className="preview-limit">
            音符键 <code>Z X C V B N M ,</code> 是键盘键；升调 / 降调 / 半音是<strong>鼠标右键 / 左键 / 中键</strong>，
            所以宏里混着按键和鼠标事件。改过游戏内键位的话在上面重选。
          </p>
          <p className="preview-limit">
            宏只负责导出，本项目不向游戏注入输入——罗技脚本粘贴到 G HUB 的 SCRIPTING 面板，按 G{gKey} 播放、
            开启 Scroll Lock 中止。鼠标键用 <code>PressMouseButton</code> 的微软编号（1 左 / 2 中 / 3 右）。
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
          {razerBlockers.length > 0 && (
            <p className="error-note">
              雷蛇宏无法编码当前选择的修饰键。方向键、小键盘等扩展键在 Synapse 的 XML 里编码无法确认，
              请改用鼠标键或 Shift / Ctrl / Alt / 空格。
            </p>
          )}
          {exportError && <p className="error-note">{exportError}</p>}
          <p className="preview-limit">
            自动化输入可能被反作弊判定，使用宏前请自行确认游戏规则与账号风险。
          </p>
        </section>

        <section className="assumption-strip">
          {MAPPING_ASSUMPTIONS.map((item, index) => (
            <article key={item}><b>0{index + 1}</b><span>{item}</span></article>
          ))}
        </section>

        <footer>
          <span>DELTA FORCE HARMONICA / COMMUNITY TOOL</span>
          <span>映射仍待游戏内实测验证</span>
        </footer>
      </main>
    </div>
  );
}
