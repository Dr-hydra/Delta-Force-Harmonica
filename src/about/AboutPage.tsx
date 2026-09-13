import { useEffect, useState } from "react";
import { openBilibiliAuthor, openBilibiliVideo } from "../cloud/toy";
import { RailToggle, useRailCollapsed } from "../components/RailToggle";
import { aboutHref, batchHref, converterHref, libraryHref } from "../navigation";
import "./about.css";

const GITHUB_URL = "https://github.com/Dr-hydra/Delta-Force-Harmonica";
const AUTHOR_MID = "441133155";
const VIDEO_BVID = "BV1QbYS6GEu7";

export default function AboutPage() {
  const [theme, setTheme] = useState(() => localStorage.getItem("dfh-theme") || "light");
  const rail = useRailCollapsed();

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem("dfh-theme", theme);
  }, [theme]);

  return (
    <div className={`library-shell about-shell${rail.collapsed ? " rail-collapsed" : ""}`}>
      <aside className="side-rail library-rail">
        <a className="brand" href={converterHref()}><span>DFH</span><b>DELTA FORCE<br />HARMONICA</b></a>
        <nav aria-label="主导航">
          <a href={converterHref()} title="乐谱转换"><i>01</i><span>乐谱转换</span></a>
          <a href={libraryHref()} title="云端曲谱库"><i>02</i><span>曲谱库</span></a>
          <a className="active" href={aboutHref()} title="关于项目"><i>03</i><span>关于</span></a>
          <a href={batchHref()} title="批量导出"><i>04</i><span>批量导出</span></a>
        </nav>
        <RailToggle collapsed={rail.collapsed} onToggle={rail.toggle} />
        <div className="rail-bottom"><b>α</b><span>OPEN SOURCE<br />COMMUNITY TOOL</span></div>
      </aside>

      <header className="top-status">
        <span><i className="status-dot" />ABOUT / PROJECT &amp; CREATOR</span>
        <button onClick={() => setTheme(theme === "dark" ? "light" : "dark")}>{theme === "dark" ? "LIGHT" : "DARK"} MODE</button>
      </header>

      <main className="page-content about-content">
        <section className="panel about-hero">
          <span className="eyebrow">DELTA FORCE / HARMONICA COMPILER</span>
          <h1>关于这个项目</h1>
          <p>三角洲行动口琴谱是一个纯前端社区工具，用于把 MIDI、MusicXML 和伴奏音频转换成游戏内可演奏的简谱，并导出对应宏文件。</p>
        </section>

        <section className="about-links" aria-label="项目链接">
          <a className="panel about-card" href={GITHUB_URL} target="_blank" rel="noreferrer">
            <span className="eyebrow">SOURCE / GITHUB</span>
            <strong>查看开源仓库</strong>
            <p>浏览源代码、提交问题或参与改进。</p>
            <em>OPEN GITHUB ↗</em>
          </a>

          <button className="panel about-card" onClick={() => void openBilibiliAuthor(AUTHOR_MID)}>
            <span className="eyebrow">CREATOR / BILIBILI</span>
            <strong>Dr-Hydra 的 B站主页</strong>
            <p>通过 Toy 能力打开作者空间。</p>
            <em>OPEN SPACE ↗</em>
          </button>

          <button className="panel about-card" onClick={() => void openBilibiliVideo(VIDEO_BVID)}>
            <span className="eyebrow">RELATED / VIDEO</span>
            <strong>查看对应视频</strong>
            <p>了解曲谱转换、宏导出与云端曲谱库的使用方式。</p>
            <em>{VIDEO_BVID} ↗</em>
          </button>
        </section>

        <footer>
          <span>DELTA FORCE HARMONICA / COMMUNITY TOOL</span>
          <span>OPEN SOURCE · TOY ENABLED</span>
        </footer>
      </main>
    </div>
  );
}
