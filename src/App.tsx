import { useEffect, useMemo, useState } from "react";
import { SCORE_FILE_ACCEPT, parseScoreFile } from "./import/parseScoreFile";
import type { ParseProgress } from "./import/parseScoreFile";
import { AUDIO_PRESETS, type AudioTranscriptionPreset } from "./audio/presets";
import { quantizeToGrid } from "./audio/beats";
import { enforceMonophonic } from "./music/monophonic";
import { extractSmartMelody } from "./music/smartMelody";
import { useOpenSourceMelody } from "./music/useOpenSourceMelody";
import { selectProbableMelody } from "./music/selectMelody";
import { findBestTranspose, optimizeHarmonica } from "./harmonica/optimizer";
import { MAPPING_ASSUMPTIONS } from "./harmonica/mapping";
import EditPanel from "./components/EditPanel";
import ExportPanel from "./components/ExportPanel";
import { ScoreWorkspace } from "./components/ScoreWorkspace";
import { RailToggle, useRailCollapsed } from "./components/RailToggle";
import { useScoreEdits } from "./score/useScoreEdits";
import { insertNoteAt, moveNote, moveNotes, resizeNote } from "./score/editNotes";
import type { NoteEvent, ParsedSong, TimeSignatureEvent } from "./music/types";
import { DEFAULT_SCORE_PPQ, type ScoreSnapshotInput } from "./persistence/scoreCodec";
import { aboutHref, batchHref } from "./navigation";

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
type MelodyMode = "original" | "smart" | "symbolic";
type AudioStage = "raw" | "clean" | "smart";

function formatDuration(ms: number) {
  const total = Math.max(0, Math.round(ms / 1000));
  const minutes = Math.floor(total / 60);
  const seconds = String(total % 60).padStart(2, "0");
  return `${minutes}:${seconds}`;
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
  const rail = useRailCollapsed();
  const [song, setSong] = useState<ParsedSong | null>(null);
  const [trackId, setTrackId] = useState("");
  const [transpose, setTranspose] = useState(0);
  const [melodyMode, setMelodyMode] = useState<MelodyMode>("original");
  const [melodyThreshold, setMelodyThreshold] = useState(0.35);
  const [audioPreset, setAudioPreset] = useState<AudioTranscriptionPreset>("balanced");
  const [audioStage, setAudioStage] = useState<AudioStage>("smart");
  const [quantizeDivisions, setQuantizeDivisions] = useState(2);
  const [loadedFile, setLoadedFile] = useState<File | null>(null);
  const [usingDemo, setUsingDemo] = useState(false);
  const [busy, setBusy] = useState(false);
  const [parseProgress, setParseProgress] = useState<ParseProgress | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem("dfh-theme", theme);
  }, [theme]);

  const selectedTrack = song?.tracks.find((track) => track.id === trackId) ?? song?.tracks[0];
  const isAudio = !usingDemo && song?.sourceFormat === "audio";
  const audioAnalysis = song?.audioAnalysis;
  const baseNotes = usingDemo ? demoNotes : selectedTrack?.notes ?? [];
  const baseBpm = usingDemo ? DEMO_BPM : song?.bpm ?? 0;

  const beatGrid = audioAnalysis?.beatGrid;
  const openSource = useOpenSourceMelody(baseNotes, baseBpm,
    !isAudio && melodyMode === "symbolic" ? melodyMode : null);


  const audioStageNotes = useMemo(() => {
    if (!isAudio || !audioAnalysis) return [];
    const source = audioStage === "raw"
      ? audioAnalysis.rawNotes
      : audioStage === "clean"
        ? audioAnalysis.cleanedNotes
        : extractSmartMelody(audioAnalysis.cleanedNotes, { bpm: beatGrid?.bpm ?? baseBpm });
    if (!beatGrid || quantizeDivisions < 1) return source;
    return quantizeToGrid(source, beatGrid, quantizeDivisions);
  }, [isAudio, audioAnalysis, audioStage, beatGrid, quantizeDivisions, baseBpm]);

  const derivedNotes = useMemo(() => {
    if (isAudio) return audioStageNotes;
    if (melodyMode === "original") return baseNotes;
    if (melodyMode === "symbolic") return openSource.result?.probabilities
      ? selectProbableMelody(baseNotes, openSource.result.probabilities, melodyThreshold) : [];
    return extractSmartMelody(baseNotes, { bpm: baseBpm });
  }, [isAudio, audioStageNotes, baseNotes, melodyMode, baseBpm, openSource.result, melodyThreshold]);

  // The in-game harmonica sounds one note at a time, so the chord collapse runs
  // before the editor rather than after it: the editor has to work on the notes
  // that are actually on screen, otherwise deleting a note would only uncover
  // the chord tone hidden underneath it.
  const derivedMono = useMemo(() => enforceMonophonic(derivedNotes), [derivedNotes]);

  // Once anything is edited the edited copy wins; until then the score stays a
  // pure function of the import settings, so changing a preset still takes effect.
  const edits = useScoreEdits(derivedMono.notes, baseBpm || 120);
  const bpm = edits.bpm;
  const melodyNotes = edits.notes;
  const editing = edits.editing;

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

  async function loadFile(file: File, preset: AudioTranscriptionPreset = audioPreset) {
    setBusy(true);
    setError("");
    setParseProgress(null);
    try {
      const parsed = await parseScoreFile(file, setParseProgress, { audioPreset: preset });
      edits.reset();
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
    edits.reset();
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
  const duration = editing
    ? mono.notes.reduce((end, note) => Math.max(end, note.start + note.duration), 0)
    : usingDemo
    ? demoNotes[demoNotes.length - 1].start + demoNotes[demoNotes.length - 1].duration
    : song?.duration ?? 0;
  const timeSignatures = usingDemo ? DEMO_SIGNATURES : song?.timeSignatures ?? DEMO_SIGNATURES;
  const measureStarts = usingDemo ? DEMO_MEASURE_STARTS : song?.measureStarts ?? [];

  // What the MIDI export embeds for the desktop player: the same collapsed
  // notes and transpose the fingering ran on, with the source tempo map.
  const exportSnapshot = useMemo<ScoreSnapshotInput>(() => ({
    ppq: (!usingDemo && song?.ppq) || DEFAULT_SCORE_PPQ,
    transpose,
    tempos: !edits.editing && !usingDemo && song?.tempos?.length ? song.tempos : [{ beat: 0, time: 0, bpm: bpm || 120 }],
    timeSignatures,
    measureStarts,
    notes: mono.notes
  }), [edits.editing, usingDemo, song, transpose, bpm, timeSignatures, measureStarts, mono.notes]);
  const formatLabel = sourceFormatLabel(song, usingDemo);
  const busyPercent = parseProgress ? Math.round(parseProgress.value * 100) : null;
  const audioStats = audioAnalysis?.stats;
  const audioPresetConfig = AUDIO_PRESETS[audioPreset];

  return (
    <div className={`app-shell${rail.collapsed ? " rail-collapsed" : ""}`}>
      <aside className="side-rail">
        <button className="brand" onClick={() => scrollTo({ top: 0, behavior: "smooth" })}>
          <span>DFH</span>
          <b>DELTA FORCE<br />HARMONICA</b>
        </button>
        <nav aria-label="主导航">
          <button className="active" title="乐谱转换"><i>01</i><span>乐谱转换</span></button>
          <button disabled title="云端乐谱"><i>02</i><span>云端乐谱</span><em>SOON</em></button>
          <button className="nav-available" title="关于项目" onClick={() => window.location.assign(aboutHref())}><i>03</i><span>关于</span></button>
          <button className="nav-available" title="批量导出" onClick={() => window.location.assign(batchHref())}><i>04</i><span>批量导出</span></button>
        </nav>
        <RailToggle collapsed={rail.collapsed} onToggle={rail.toggle} />
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
            <p>文件只在浏览器中处理。MIDI 和 MusicXML 可选择原版、CNN 主旋律识别或自研精简；音频使用 Basic Pitch 转录，可切换分析阶段对比结果。</p>
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
                  <option value="clean">原版 · 清洗后保留全部起音</option>
                  <option value="smart">单音口琴 · 连贯旋律优先（默认）</option>
                  <option value="raw">RAW · Basic Pitch 原始候选（诊断用）</option>
                </select>
                <small style={{ color: "var(--muted)", lineHeight: 1.55 }}>
                  {audioStats
                    ? `RAW ${audioStats.rawCount} → CLEAN ${audioStats.cleanCount} · 弱音 -${audioStats.removedWeak} · 短音 -${audioStats.removedShort} · 合并 ${audioStats.mergedFragments} · 密集 -${audioStats.removedDensity}`
                    : "导入音频后可逐级试听，判断问题来自转录、清洗还是旋律提取。"}
                </small>
              </label>
            ) : (
              <div className="field" style={{ marginTop: 18 }}>
                <span id="melody-algorithm-label">旋律算法 · 每次选择一项</span>
                <div className="melody-options" role="group" aria-labelledby="melody-algorithm-label">
                  {([
                    ["original", "原版", "保留起音，和弦取最高音（默认）"],
                    ["symbolic", "Symbolic CNN", "自动识别主旋律，可调整筛选阈值"],
                    ["smart", "自研精简", "优先保留连贯旋律"]
                  ] as const).map(([mode, title, description]) => (
                    <label key={mode} className={`melody-option${melodyMode === mode ? " selected" : ""}`}>
                      <input type="checkbox" checked={melodyMode === mode} disabled={editing}
                        onChange={() => setMelodyMode(mode)} />
                      <span><b>{title}</b><small>{description}</small></span>
                    </label>
                  ))}
                </div>
                <small style={{ color: "var(--muted)", lineHeight: 1.55 }}>
                  {editing ? "当前有手动编辑，请先重置编辑再切换算法。" : "先选主旋律轨道，再比较算法。CNN 可降低筛选阈值保留更多细节。算法在本机运行，首次加载较慢。"}
                </small>
              </div>
            )}

            {!isAudio && melodyMode === "symbolic" && (
              <label className="field" style={{ marginTop: 12 }}>
                <span>筛选阈值 {melodyThreshold.toFixed(2)}</span>
                <input type="range" min="0" max="1" step="0.05" value={melodyThreshold} disabled={editing}
                  onChange={(event) => setMelodyThreshold(Number(event.target.value))} />
                <small>调低保留更多音符，调高减少伴奏。修改阈值无需重新运行模型。</small>
              </label>
            )}
            {!isAudio && melodyMode === "symbolic" && (
              <small role="status" style={{ display: "block", marginTop: 10, color: "var(--muted)" }}>
                {openSource.error ? `运行失败：${openSource.error}。可切回原版继续。`
                  : openSource.pending ? openSource.progress
                  : `输入 ${baseNotes.length} 个音符 → 当前 ${derivedMono.notes.length} 个音符`}
              </small>
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
          <article><span>BPM</span><strong>{bpm ? (isAudio ? bpm.toFixed(1) : bpm) : "—"}</strong><small>{edits.tempoChanged ? "手动设置" : isAudio ? (beatGrid ? "music-tempo 估算" : "未估出，回退 120") : "首个 Tempo"}</small></article>
          <article><span>LENGTH</span><strong>{duration ? formatDuration(duration) : "—"}</strong><small>乐曲时长</small></article>
          <article className="metric-primary"><span>MOD CHANGES</span><strong>{conversion.notes.length ? conversion.modifierChanges : "—"}</strong><small>半音 / 八度状态切换</small></article>
        </section>

        <ScoreWorkspace
          onAppendMeasure={(beat) => edits.applyEdit((notes, tempo) => insertNoteAt(notes, beat, edits.editStep, tempo))}
          notes={conversion.notes}
          unplayableCount={conversion.unplayable.length}
          timeSignatures={timeSignatures}
          measureStarts={measureStarts}
          bpm={bpm || 120}
          selectedIndex={conversion.notes.findIndex((_, index) => editIndexOf(index) === edits.selectedNote)}
          selectedIndices={conversion.notes.flatMap((_, index) => edits.selectedNotes.includes(editIndexOf(index) ?? -1) ? [index] : [])}
          insertionBeat={edits.insertionBeat}
          editStep={edits.editStep}
          onInsertionSelect={edits.setInsertionBeat}
          onNoteMove={(index, delta) => {
            const editIndex = editIndexOf(index);
            if (editIndex !== null) edits.applyEdit((notes, tempo) => edits.selectedNotes.length > 1 && edits.selectedNotes.includes(editIndex)
              ? moveNotes(notes, edits.selectedNotes, delta, tempo)
              : moveNote(notes, editIndex, delta, tempo));
          }}
          onNoteResize={(index, delta) => {
            const editIndex = editIndexOf(index);
            if (editIndex !== null) edits.applyEdit((notes, tempo) => resizeNote(notes, editIndex, delta, tempo));
          }}
          onNoteSelect={(index, mode) => {
            const editIndex = editIndexOf(index);
            if (editIndex !== null) edits.selectNote(editIndex, mode);
          }}
        />

        <EditPanel
          bpm={bpm}
          onBpmChange={edits.setBpm}
          notes={melodyNotes}
          editing={editing}
          selectedNote={edits.selectedNote}
          selectedNotes={edits.selectedNotes}
          insertionBeat={edits.insertionBeat}
          transpose={transpose}
          collapsedConflictCount={mono.collapsedChordNotes}
          truncatedConflictCount={mono.truncatedNotes}
          canUndo={edits.canUndo}
          canRedo={edits.canRedo}
          canPaste={edits.canPaste}
          editStep={edits.editStep}
          resetHint={
            <>
              谱面已手工编辑，<strong>导入设置（预设、分析阶段、谱面密度、量化）的改动不会再生效</strong>，需要先「放弃编辑」。移调滑块仍然作用于编辑后的谱面。
            </>
          }
          onEditStepChange={edits.setEditStep}
          onApply={edits.applyEdit}
          onUndo={edits.undo}
          onRedo={edits.redo}
          onCopy={edits.copySelection}
          onPaste={edits.pasteSelection}
          onDuplicate={edits.duplicateSelection}
          onSelectAll={edits.selectAll}
          onClearSelection={edits.clearSelection}
          onSelectAdjacent={edits.selectAdjacent}
          onReset={edits.reset}
          onStartBlank={edits.startBlank}
        />

        <ExportPanel
          title={title}
          notes={conversion.notes}
          unplayableCount={conversion.unplayable.length}
          bpm={bpm || 120}
          timeSignatures={timeSignatures}
          measureStarts={measureStarts}
          transpose={transpose}
          snapshot={exportSnapshot}
        />

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
