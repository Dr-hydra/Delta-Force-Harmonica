import { useEffect, useMemo, useState } from "react";
import { SCORE_FILE_ACCEPT, parseScoreFile } from "./import/parseScoreFile";
import { extractHighestMelody } from "./music/monophonic";
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
  return "MUSICXML";
}

export default function App() {
  const [theme, setTheme] = useState(() => localStorage.getItem("dfh-theme") || "light");
  const [song, setSong] = useState<ParsedSong | null>(null);
  const [trackId, setTrackId] = useState("");
  const [transpose, setTranspose] = useState(0);
  const [melodyOnly, setMelodyOnly] = useState(true);
  const [usingDemo, setUsingDemo] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem("dfh-theme", theme);
  }, [theme]);

  const selectedTrack = song?.tracks.find((track) => track.id === trackId) ?? song?.tracks[0];
  const sourceNotes = usingDemo ? demoNotes : selectedTrack?.notes ?? [];
  const melodyNotes = useMemo(
    () => melodyOnly ? extractHighestMelody(sourceNotes) : sourceNotes,
    [sourceNotes, melodyOnly]
  );
  const conversion = useMemo(() => optimizeHarmonica(melodyNotes, transpose), [melodyNotes, transpose]);

  const playableRate = melodyNotes.length === 0
    ? 0
    : Math.round((conversion.notes.length / melodyNotes.length) * 100);

  async function loadFile(file: File) {
    setBusy(true);
    setError("");
    try {
      const parsed = await parseScoreFile(file);
      setSong(parsed);
      setTrackId(parsed.tracks[0].id);
      setTranspose(0);
      setUsingDemo(false);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "乐谱解析失败。");
    } finally {
      setBusy(false);
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
          <span>ENGINE 0.3<br />PURE FRONTEND</span>
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
            <p>文件只在浏览器中解析。现在支持 MIDI、MusicXML 与 MXL，并按拍号生成小节谱，试听指针会跟随正式谱面。</p>
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
              <span className="data-note">MIDI · XML · MXL</span>
            </div>
            <label className={`drop-zone ${busy ? "busy" : ""}`}>
              <input type="file" accept={SCORE_FILE_ACCEPT} disabled={busy} onChange={(event) => {
                const file = event.currentTarget.files?.[0];
                if (file) void loadFile(file);
                event.currentTarget.value = "";
              }} />
              <strong>{busy ? "正在解析…" : "拖入乐谱，或点击选择文件"}</strong>
              <span>原始文件不会上传 · .mid / .midi / .musicxml / .xml / .mxl</span>
            </label>
            <button className="text-action" onClick={loadDemo}>没有乐谱？载入音阶 Demo →</button>
            {error && <p className="error-note">{error}</p>}
          </article>

          <article className="panel control-panel">
            <div className="section-heading">
              <div><span className="eyebrow">02 / OPTIMIZE</span><h2>演奏优化</h2></div>
              <span className="data-note">HUMAN</span>
            </div>

            <label className="field">
              <span>轨道 / 声部</span>
              <select disabled={!song || usingDemo} value={selectedTrack?.id ?? ""} onChange={(event) => setTrackId(event.target.value)}>
                {usingDemo && <option>Demo Melody</option>}
                {!song && !usingDemo && <option>等待乐谱</option>}
                {song?.tracks.map((track) => <option value={track.id} key={track.id}>{track.name} · {track.instrument} · {track.notes.length} notes</option>)}
              </select>
            </label>

            <label className="switch-row">
              <span><b>主旋律提取</b><small>同一时刻多个音时保留最高音，并缩短重叠音符</small></span>
              <input type="checkbox" checked={melodyOnly} onChange={(event) => setMelodyOnly(event.target.checked)} />
            </label>

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
          <article><span>NOTES</span><strong>{melodyNotes.length || "—"}</strong><small>主旋律音符</small></article>
          <article><span>BPM</span><strong>{bpm || "—"}</strong><small>首个 Tempo</small></article>
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
