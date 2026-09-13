import { useEffect, useRef, useState } from "react";
import { listCloudScores, loadCloudScore, type CloudScoreMeta } from "../cloud/archive";
import { hasToyAbility } from "../cloud/toy";
import { RailToggle, useRailCollapsed } from "../components/RailToggle";
import { STOP_LOCKS, TRIGGER_MAX, type StopLock, type TriggerSource } from "../export/logitech";
import { loadBatchSettings, prepareBatchSong, saveBatchSettings, toggleBatchSelection, toLogitechBatchLua, type BatchSong } from "../export/logitechBatch";
import { downloadText } from "../export/files";
import { aboutHref, batchHref, converterHref, libraryHref } from "../navigation";
import "../library/library.css";
import "./batch.css";

async function readWithTimeout<T>(request: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([request, new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error("云存档读取超时，请确认已在 B站 Toy 中登录后重试。")), 15000);
    })]);
  } finally { clearTimeout(timer); }
}

/** Reuses archive row and export-field styles without changing either legacy UI. */
export default function BatchExportPage() {
  const rail = useRailCollapsed();
  const [theme, setTheme] = useState(() => localStorage.getItem("dfh-theme") || "light");
  const [records, setRecords] = useState<CloudScoreMeta[]>([]);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [query, setQuery] = useState("");
  const [settings, setSettings] = useState(loadBatchSettings);
  const [loading, setLoading] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [progress, setProgress] = useState("");
  const operation = useRef(0);
  const exportingRef = useRef(false);
  const available = hasToyAbility("getCloudStorage");
  const selected = selectedIds.flatMap((id) => records.find((record) => record.id === id) ?? []);
  const visible = records.filter((record) => record.title.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()));
  const busy = loading || exporting;
  const maxTrigger = TRIGGER_MAX[settings.trigger.source];
  const autoPlay = settings.trigger.source === "mouse" && settings.trigger.value <= 5;

  function changeTriggerSource(source: TriggerSource) {
    setSettings({ ...settings, trigger: { source, value: Math.min(Math.max(1, settings.trigger.value), TRIGGER_MAX[source]) } });
  }

  function editTrigger(value: string) {
    const parsed = Number(value);
    if (!Number.isInteger(parsed) || parsed < 1) return;
    setSettings({ ...settings, trigger: { ...settings.trigger, value: Math.min(parsed, maxTrigger) } });
  }

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem("dfh-theme", theme);
  }, [theme]);
  useEffect(() => { saveBatchSettings(settings); }, [settings]);

  async function refresh() {
    if (!hasToyAbility("getCloudStorage") || exportingRef.current) return;
    const ticket = ++operation.current;
    setLoading(true);
    setError("");
    setMessage("");
    try {
      const items = await readWithTimeout(listCloudScores());
      if (ticket !== operation.current) return;
      setRecords(items);
      setSelectedIds((ids) => ids.filter((id) => items.some((item) => item.id === id)));
    } catch (reason) {
      if (ticket === operation.current) setError(reason instanceof Error ? reason.message : "云存档读取失败，请重试。");
    } finally {
      if (ticket === operation.current) setLoading(false);
    }
  }

  useEffect(() => {
    void refresh();
    return () => { operation.current++; };
  }, [available]);

  function toggle(id: string) {
    setSelectedIds((ids) => toggleBatchSelection(ids, id));
    setMessage("");
    setError("");
  }

  async function exportBatch() {
    if (busy || exportingRef.current || !selected.length) return;
    exportingRef.current = true;
    setExporting(true);
    setError("");
    setMessage("");
    const ticket = ++operation.current;
    const songs: BatchSong[] = [];
    let skipped = 0;
    try {
      // Read in selection order; failures abort the entire export so numbering never shifts.
      for (const [index, meta] of selected.entries()) {
        setProgress(`正在读取 ${index + 1} / ${selected.length}：${meta.title}`);
        try {
          const record = await readWithTimeout(loadCloudScore(meta.id));
          if (ticket !== operation.current) return;
          const prepared = prepareBatchSong(record.meta.title, record.snapshot);
          songs.push(prepared.song);
          skipped += prepared.unplayableCount;
        } catch (reason) {
          throw new Error(`第 ${index + 1} 首「${meta.title}」导出失败：${reason instanceof Error ? reason.message : "读取失败"}。未生成文件，请重试。`);
        }
      }
      const lua = toLogitechBatchLua(songs, settings);
      downloadText("云存档歌单-logitech-batch.lua", lua, "text/plain;charset=utf-8");
      setMessage(`已导出 ${songs.length} 首歌曲，脚本内的编号与右侧歌单一致。${skipped ? `按现有转换规则跳过了 ${skipped} 个不可演奏音符。` : ""}`);
    } catch (reason) {
      if (ticket === operation.current) setError(reason instanceof Error ? reason.message : "批量导出失败，请重试。");
    } finally {
      exportingRef.current = false;
      if (ticket === operation.current) { setExporting(false); setProgress(""); }
    }
  }

  return (
    <div className={`library-shell batch-shell${rail.collapsed ? " rail-collapsed" : ""}`}>
      <aside className="side-rail library-rail">
        <a className="brand" href={converterHref()}><span>DFH</span><b>DELTA FORCE<br />HARMONICA</b></a>
        <nav aria-label="主导航">
          <a href={converterHref()} title="乐谱转换"><i>01</i><span>乐谱转换</span></a>
          <a href={libraryHref()} title="曲谱库"><i>02</i><span>曲谱库</span></a>
          <a className="active" href={batchHref()} title="批量导出" aria-current="page"><i>03</i><span>批量导出</span></a>
          <a href={aboutHref()} title="关于项目"><i>04</i><span>关于</span></a>
        </nav>
        <RailToggle collapsed={rail.collapsed} onToggle={rail.toggle} />
        <div className="rail-bottom"><b>α</b><span>CLOUD SONGS<br />BATCH EXPORT</span></div>
      </aside>
      <header className="top-status"><span><i className="status-dot" />BATCH EXPORT / LOGITECH G HUB</span><button onClick={() => setTheme(theme === "dark" ? "light" : "dark")}>{theme === "dark" ? "LIGHT" : "DARK"} MODE</button></header>
      <main className="page-content library-content">
        <section className="panel library-detail-head">
          <div><span className="eyebrow">CLOUD SONGS / ONE SCRIPT</span><h1>批量导出罗技宏</h1><p>从我的云存档选择歌曲，合并为一个 Lua 脚本。选中顺序就是脚本中的歌曲编号。</p></div>
          <div className="library-quota"><b>{selected.length} 首</b><span>已加入歌单</span></div>
        </section>
        <div className="batch-layout">
          <section aria-label="云存档选歌" className="batch-archive">
            <div className="panel library-search batch-search">
              <div><span className="eyebrow">01 / SELECT</span><h2>我的云存档</h2></div>
              <label className="batch-search-label"><span className="sr-only">搜索云存档歌曲</span><input aria-label="搜索云存档歌曲" placeholder="搜索歌曲名称" value={query} onChange={(event) => setQuery(event.target.value)} /></label>
              <button className="button secondary" disabled={busy || !available} onClick={() => void refresh()}>刷新</button>
            </div>
            <div className="library-list" aria-busy={loading}>
              {!available ? <div className="library-empty"><strong>TOY CLOUD STORAGE</strong><span>请在支持 CloudStorage 的 B站 Toy 环境中读取个人云存档。</span></div>
                : loading ? <div className="library-empty" role="status"><strong>LOADING</strong><span>正在读取我的云存档…</span></div>
                : !records.length ? <div className="library-empty"><strong>NO CLOUD SCORES</strong><span>先在转换器或曲谱库中保存歌曲到我的云存档，再回来刷新。</span><a href={libraryHref()}>打开曲谱库</a></div>
                : !visible.length ? <div className="library-empty"><strong>NO MATCHES</strong><span>没有匹配的歌曲，试试其他名称。</span></div>
                : visible.map((meta) => {
                  const order = selectedIds.indexOf(meta.id);
                  return <article className={`panel library-row batch-row${order >= 0 ? " batch-selected" : ""}`} key={meta.id}>
                    <label className="batch-choice">
                      <input type="checkbox" checked={order >= 0} disabled={busy} onChange={() => toggle(meta.id)} aria-label={`选择 ${meta.title}`} />
                      <span className="library-row-main"><span className="eyebrow">{order >= 0 ? `已选 / 第 ${order + 1} 首` : "CLOUD SCORE"}</span><strong>{meta.title}</strong><span className="batch-meta">{new Date(meta.updatedAt).toLocaleString()}</span></span>
                    </label>
                    <div className="library-row-stats"><b>{meta.noteCount}</b><small>NOTES</small><b>{Math.round(meta.durationMs / 1000)}s</b><small>LENGTH</small></div>
                  </article>;
                })}
            </div>
          </section>
          <aside className="batch-sidebar">
            <section className="panel batch-panel" aria-label="导出歌单">
              <div className="batch-panel-head"><div><span className="eyebrow">02 / SONG ORDER</span><h2>导出歌单</h2></div><button className="library-action" disabled={busy || !selected.length} onClick={() => { setSelectedIds([]); setMessage(""); }}>清空</button></div>
              <p className="batch-hint">按选择顺序编号。移除后重新选中，会排到末尾。</p>
              {!selected.length ? <p className="batch-hint">从左侧选歌，第一首选中的歌编号为 1。</p> : <ol className="batch-order">{selected.map((meta, index) => <li key={meta.id}><span className="batch-number">{index + 1}</span><span className="batch-song-name">{meta.title}</span><button className="library-action" disabled={busy} aria-label={`移除 ${meta.title}`} onClick={() => toggle(meta.id)}>移除</button></li>)}</ol>}
            </section>
            <section className="panel batch-panel" aria-label="批量导出设置">
              <span className="eyebrow">03 / EXPORT</span><h2>按键与导出</h2>
              <fieldset disabled={busy} className="batch-settings">
                <div className="export-fields">
                  <label className="field"><span>开始键来源</span><select value={settings.trigger.source} onChange={(event) => changeTriggerSource(event.target.value as TriggerSource)}><option value="mouse">鼠标按键</option><option value="gkey">罗技键盘 G 键</option></select></label>
                  <label className="field"><span>{settings.trigger.source === "mouse" ? "鼠标键编号" : "键盘 G 键编号"}</span><input type="number" inputMode="numeric" min="1" max={maxTrigger} value={settings.trigger.value} onChange={(event) => editTrigger(event.target.value)} /></label>
                  <label className="field"><span>停止键</span><select value={settings.stopLock} onChange={(event) => setSettings({ ...settings, stopLock: event.target.value as StopLock })}>{STOP_LOCKS.map((lock) => <option key={lock.id} value={lock.id}>{lock.label}</option>)}</select></label>
                </div>
              </fieldset>
              <p className="batch-hint">连按开始键 N 次选第 N 首，{autoPlay ? "最后松开后停按 700 毫秒自动播放" : "最后松开后停按至少 700 毫秒，再按一次开始键播放"}。按住只算一次，超过歌单数量则取消。</p>
              <p className="batch-hint">选歌或播放期间，切换停止键即可取消。开始键范围与单首导出一致，设置单独保存。</p>
              <button className="button primary batch-download" disabled={busy || !available || !selected.length} onClick={() => void exportBatch()}>{exporting ? "正在生成脚本…" : `导出 ${selected.length} 首 · 罗技 G HUB .lua`}</button>
              <div aria-live="polite">{progress && <p className="library-message">{progress}</p>}{message && <p className="library-message">{message}</p>}{error && <p className="error-note" role="alert">{error}</p>}</div>
              <p className="batch-hint">在 G HUB 配置文件的脚本编辑器中粘贴导出内容并保存。文件开头附有编号歌单。</p>
              <p className="export-alert">如果升降调不能正常使用，请使用管理员权限启动你的外设管理软件。</p>
            </section>
          </aside>
        </div>
      </main>
    </div>
  );
}
