import { useEffect, useMemo, useState } from "react";
import { SCORE_FILE_ACCEPT, parseScoreFile } from "./import/parseScoreFile";
import type { ParseProgress } from "./import/parseScoreFile";
import { AUDIO_PRESETS, type AudioTranscriptionPreset } from "./audio/presets";
import { extractHighestMelody } from "./music/monophonic";
import { extractSmartMelody } from "./music/smartMelody";
import { findBestTranspose, optimizeHarmonica } from "./harmonica/optimizer";
import { MAPPING_ASSUMPTIONS } from "./harmonica/mapping";
import { ScoreWorkspace } from "./components/ScoreWorkspace";
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

type MelodyMode = "smart" | "highest" | "polyphonic";
type AudioStage = "raw" | "clean" | "highest" | "smart";

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
  const [song, setSong] = useState<ParsedSong | null>(null);
  const [trackId, setTrackId] = useState("");
  const [transpose, setTranspose] = useState(0);
  const [melodyMode, setMelodyMode] = useState<MelodyMode>("smart");
  const [audioPreset, setAudioPreset] = useState<AudioTranscriptionPreset>("balanced");
  const [audioStage, setAudioStage] = useState<AudioStage>("smart");
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

  const audioStageNotes = useMemo(() => {
    if (!isAudio || !audioAnalysis) return [];
    if (audioStage === "raw") return audioAnalysis.rawNotes;
    if (audioStage === "clean") return audioAnalysis.cleanedNotes;
    if (audioStage === "highest") return extractHighestMelody(audioAnalysis.cleanedNotes);
    return extractSmartMelody(audioAnalysis.cleanedNotes);
  }, [isAudio, audioAnalysis, audioStage]);

  const melodyNotes = useMemo(() => {
    if (isAudio) return audioStageNotes;
    if (melodyMode === "polyphonic") return baseNotes;
    if (melodyMode === "highest") return extractHighestMelody(baseNotes);
    return extractSmartMelody(baseNotes);
  }, [isAudio, audioStageNotes, baseNotes, melodyMode]);

  const conversion = useMemo(() => optimizeHarmonica(melodyNotes, transpose), [melodyNotes, transpose]);
  const playableRate = melodyNotes.length === 0
    ? 0
    : Math.round((conversion.notes.length / melodyNotes.length) * 100);

  async function loadFile(file: File, preset: AudioTranscriptionPreset = audioPreset) {
    setBusy(true);
    setError("");
    setParseProgress(null);
    try {
      const parsed = await parseScoreFile(file, setParseProgress, { audioPreset: preset });
      setSong(parsed);
      setTrackId(parsed.tracks[0].id);
      setTranspose(0);
      setUsingDemo(false);
      setLoadedFile(file);
      if (parsed.sourceFormat === "audio") {
        setAudioPreset(preset);
        setAudioStage("smart");
      } else {
        setMelodyMode("smart");
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "乐谱解析失败。");
    } finally {
      setBusy(false);
      setParseProgress(null);
    }
  }

  function autoTranspose() {
    if (melodyNotes.length === 0) return;
    const best = findBestTranspose(melodyNotes);
    setTranspose(best.transpose);
  }

  function loadDemo() {
    setSong(null);
    setTrackId("");
    setTranspose(0);
    setUsingDemo(true);
    setLoadedFile(null);
    setMelodyMode("smart");
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
            <p>文件只在浏览器中解析。音频实验版现在增加三档识别强度、弱音与碎音清洗，以及基于全局连续性的 Smart Melody Path，可直接对照 RAW / CLEAN / MELODY。</p>
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
              <span>原始文件不会上传 · .mid / .musicxml / .mxl / .mp3 / .wav / .ogg / .flac</span>
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
            <p className="preview-limit">完整混音建议优先试“标准 / 推荐”，音符仍过密时切换“完整混音”。预设会改变 Basic Pitch 解码阈值和后处理强度。</p>
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
                  <option value="raw">RAW · Basic Pitch 原始候选</option>
                  <option value="clean">CLEAN · 弱音 / 碎音 / 密集和弦过滤</option>
                  <option value="highest">SKYLINE · CLEAN 后最高音基线</option>
                  <option value="smart">MELODY · Smart Melody Path（推荐）</option>
                </select>
                <small style={{ color: "var(--muted)", lineHeight: 1.55 }}>
                  {audioStats
                    ? `RAW ${audioStats.rawCount} → CLEAN ${audioStats.cleanCount} · 弱音 -${audioStats.removedWeak} · 短音 -${audioStats.removedShort} · 合并 ${audioStats.mergedFragments} · 密集 -${audioStats.removedDensity}`
                    : "导入音频后可逐级试听，判断问题来自转录、清洗还是旋律提取。"}
                </small>
              </label>
            ) : (
              <label className="field" style={{ marginTop: 18 }}>
                <span>主旋律算法</span>
                <select value={melodyMode} onChange={(event) => setMelodyMode(event.target.value as MelodyMode)}>
                  <option value="smart">Smart Melody Path · 连续性 DP（推荐）</option>
                  <option value="highest">Skyline · 最高音 baseline</option>
                  <option value="polyphonic">保留原始复调</option>
                </select>
                <small style={{ color: "var(--muted)", lineHeight: 1.55 }}>Smart 模式会在多个候选声部之间寻找更连续的全局旋律路径，并尽量保留持续长音。</small>
              </label>
            )}

            <div className="transpose-row">
              <label className="field">
                <span>移调 <b>{transpose > 0 ? `+${transpose}` : transpose}</b> semitone</span>
                <input type="range" min="-12" max="12" step="1" value={transpose} onChange={(event) => setTranspose(Number(event.target.value))} />
              </label>
              <button className="button primary" disabled={melodyNotes.length === 0} onClick={autoTranspose}>自动适配</button>
            </div>
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
          <article><span>NOTES</span><strong>{melodyNotes.length || "—"}</strong><small>{isAudio ? `${audioStage.toUpperCase()} 当前音符` : "当前主旋律音符"}</small></article>
          <article><span>BPM</span><strong>{isAudio ? "—" : bpm || "—"}</strong><small>{isAudio ? "音频 β 暂未估算 BPM" : "首个 Tempo"}</small></article>
          <article><span>LENGTH</span><strong>{duration ? formatDuration(duration) : "—"}</strong><small>乐曲时长</small></article>
          <article className="metric-primary"><span>MOD CHANGES</span><strong>{conversion.notes.length ? conversion.modifierChanges : "—"}</strong><small>半音 / 八度状态切换</small></article>
        </section>

        <ScoreWorkspace
          notes={conversion.notes}
          unplayableCount={conversion.unplayable.length}
          timeSignatures={timeSignatures}
          measureStarts={measureStarts}
          bpm={bpm || 120}
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
