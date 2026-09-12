import { useEffect, useMemo, useState } from "react";
import type { ScoreSnapshot } from "../persistence/scoreCodec";
import { cloudArchiveQuota, deleteCloudScore, listCloudScores, loadCloudScore, saveCloudScore, type CloudScoreMeta } from "../cloud/archive";
import { ensureOwnerToken, hasToyAbility, loadFavoriteIds, saveFavoriteIds } from "../cloud/toy";
import { deletePublicScore, getCatalog, getPublicScore, libraryConfigured, libraryPublishConfigured, myPublicScores, searchCatalog } from "./api";
import { PublicScoreMetaForm, PublishArchiveDialog, RenameCloudScoreDialog, ShareScoreButton } from "./ScoreActions";
import ScoreWorkbench from "./ScoreWorkbench";
import { RailToggle, useRailCollapsed } from "../components/RailToggle";
import type { LibraryEntry, PublicScore } from "./types";
import { aboutHref, converterHref, libraryHref } from "../navigation";
import "./library.css";

function durationLabel(ms: number) {
  const seconds = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

function scoreUrl(id: string, query = "") {
  const url = new URL(window.location.href);
  url.search = "";
  url.searchParams.set("view", "library");
  url.searchParams.set("s", id);
  if (query.trim()) url.searchParams.set("q", query.trim());
  return `${url.pathname}${url.search}`;
}

function publicListUrl(query = "") {
  const url = new URL(window.location.href);
  url.search = "";
  url.searchParams.set("view", "library");
  if (query.trim()) url.searchParams.set("q", query.trim());
  return `${url.pathname}${url.search}`;
}

function readLibraryRoute() {
  const params = new URLSearchParams(window.location.search);
  return { scoreId: params.get("s") || "", query: params.get("q") || "" };
}

function difficultyLabel(value: number) {
  if (!value) return "未标注";
  return `${"★".repeat(Math.min(5, value))}${"☆".repeat(Math.max(0, 5 - value))}`;
}

function PublicDetail({ id, favorites, onFavorites }: {
  id: string;
  favorites: string[];
  onFavorites: (ids: string[]) => void;
}) {
  const [score, setScore] = useState<PublicScore | null>(null);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [mine, setMine] = useState(false);
  const [editing, setEditing] = useState(false);

  useEffect(() => {
    let active = true;
    setScore(null);
    setError("");
    setEditing(false);
    void getPublicScore(id)
      .then((value) => { if (active) setScore(value); })
      .catch((reason) => { if (active) setError(reason instanceof Error ? reason.message : "曲谱加载失败"); });
    return () => { active = false; };
  }, [id]);

  // 修改 is only offered for scores this Toy identity published; the write API
  // re-checks the owner token anyway, so this check is presentation only.
  useEffect(() => {
    if (!libraryPublishConfigured || !hasToyAbility("getCloudStorage")) return;
    let active = true;
    void ensureOwnerToken()
      .then((token) => myPublicScores(token))
      .then((rows) => { if (active) setMine(rows.some((row) => row.id === id)); })
      .catch(() => undefined);
    return () => { active = false; };
  }, [id]);

  async function reload() {
    try { setScore(await getPublicScore(id)); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "曲谱加载失败"); }
  }

  async function toggleFavorite() {
    const next = favorites.includes(id) ? favorites.filter((item) => item !== id) : [...favorites, id];
    setBusy(true);
    setMessage("");
    try {
      await saveFavoriteIds(next);
      onFavorites(next);
      setMessage(next.includes(id) ? "已收藏到 Toy 云存储" : "已取消收藏");
    } catch (reason) {
      setMessage(reason instanceof Error ? reason.message : "收藏失败");
    } finally {
      setBusy(false);
    }
  }

  async function savePrivate() {
    if (!score) return;
    setBusy(true);
    setMessage("");
    try {
      await saveCloudScore({ title: score.title, snapshot: score.snapshot });
      setMessage("已保存到我的 Toy 云存档");
    } catch (reason) {
      setMessage(reason instanceof Error ? reason.message : "云存档失败");
    } finally {
      setBusy(false);
    }
  }

  if (error) return <div className="library-empty"><strong>LOAD FAILED</strong><span>{error}</span><a href={libraryHref()}>返回曲谱库</a></div>;
  if (!score) return <div className="library-empty"><strong>LOADING SCORE</strong><span>正在从 CloudBase CDN 读取公开曲谱…</span></div>;

  return (
    <>
      <section className="panel library-detail-head">
        <div>
          <span className="eyebrow">PUBLIC SCORE / {score.id}</span>
          <h1>{score.title}</h1>
          <p>{score.composer || "未标注原作者"} · 投稿者 {score.uploader}</p>
          <div className="library-tags">
            {score.tags.map((tag) => <span key={tag}>{tag}</span>)}
            <span>{difficultyLabel(score.difficulty)}</span>
          </div>
        </div>
        <div className="library-detail-actions">
          <ShareScoreButton id={id} onMessage={setMessage} disabled={busy} className="button secondary" />
          {mine && (
            <button className="button secondary" disabled={busy} onClick={() => setEditing((value) => !value)}>
              {editing ? "收起修改" : "修改信息"}
            </button>
          )}
          <button className="button secondary" disabled={busy || !hasToyAbility("setCloudStorage")} onClick={() => void toggleFavorite()}>
            {favorites.includes(id) ? "取消收藏" : "收藏"}
          </button>
          <button className="button secondary" disabled={busy || !hasToyAbility("setCloudStorage")} onClick={() => void savePrivate()}>保存到云存档</button>
          <button
            className="button secondary"
            onClick={() => {
              // Keep the catalog search context and update the Toy SPA route in place.
              const query = new URLSearchParams(window.location.search).get("q") || "";
              history.pushState(null, "", publicListUrl(query));
              window.dispatchEvent(new PopStateEvent("popstate"));
            }}
          >返回曲谱库</button>
        </div>
      </section>
      {editing && (
        <PublicScoreMetaForm
          entry={score}
          onMessage={setMessage}
          onCancel={() => setEditing(false)}
          onSaved={() => { setEditing(false); void reload(); }}
        />
      )}
      {message && <p className="library-message">{message}</p>}
      <section className="library-metrics">
        <span><b>{score.noteCount}</b> NOTES</span>
        <span><b>{score.bpm}</b> BPM</span>
        <span><b>{durationLabel(score.durationMs)}</b> LENGTH</span>
      </section>
      <ScoreWorkbench
        key={score.id}
        title={score.title}
        snapshot={score.snapshot}
        publicId={mine ? score.id : undefined}
        onSaved={() => setMessage("已保存到我的 Toy 云存档，可在「我的云存档」里继续修改")}
      />
    </>
  );
}

function PublicCatalog({ favorites, initialQuery }: { favorites: string[]; initialQuery: string }) {
  const [entries, setEntries] = useState<LibraryEntry[]>([]);
  const [query, setQuery] = useState(initialQuery);
  const [loading, setLoading] = useState(libraryConfigured);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  useEffect(() => {
    if (!libraryConfigured) return;
    let active = true;
    void getCatalog()
      .then((rows) => { if (active) setEntries(rows); })
      .catch((reason) => { if (active) setError(reason instanceof Error ? reason.message : "曲谱目录加载失败"); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);

  const filtered = useMemo(() => searchCatalog(entries, query), [entries, query]);

  if (!libraryConfigured) {
    return <div className="library-empty"><strong>CLOUD LIBRARY NOT CONFIGURED</strong><span>代码已经就绪；部署 CloudBase 后填写 VITE_SCORE_STORAGE 即可启用公开曲谱库。</span></div>;
  }

  return (
    <>
      <section className="panel library-search">
        <div>
          <span className="eyebrow">PUBLIC LIBRARY / CDN INDEX</span>
          <h2>公开曲谱库</h2>
          <p>目录直接从 CloudBase 云存储 CDN 读取，搜索在浏览器本地完成，不经过数据库或云函数。</p>
        </div>
        <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索曲名 / 原作者 / 投稿者 / 标签" aria-label="搜索公开曲谱" />
      </section>
      {error && <p className="error-note">{error}</p>}
      {message && <p className="library-message">{message}</p>}
      {loading ? (
        <div className="library-empty"><strong>LOADING INDEX</strong><span>正在读取静态 catalog shards…</span></div>
      ) : (
        <section className="library-list">
          {filtered.map((entry) => (
            <article className="panel library-row" key={entry.id}>
              <a className="library-row-main" href={scoreUrl(entry.id, query)}>
                <span className="eyebrow">{favorites.includes(entry.id) ? "★ FAVORITE" : `SCORE / ${entry.id}`}</span>
                <h3>{entry.title}</h3>
                <p>{entry.composer || "未标注原作者"} · {entry.uploader}</p>
                <div className="library-tags">{entry.tags.slice(0, 5).map((tag) => <span key={tag}>{tag}</span>)}</div>
              </a>
              <div className="library-row-stats">
                <b>{entry.noteCount}</b><small>NOTES</small>
                <b>{entry.bpm}</b><small>BPM</small>
                <b>{durationLabel(entry.durationMs)}</b><small>LENGTH</small>
              </div>
              <div className="library-row-actions">
                <ShareScoreButton id={entry.id} onMessage={setMessage} />
              </div>
            </article>
          ))}
          {!filtered.length && <div className="library-empty"><strong>NO MATCH</strong><span>{entries.length ? "没有匹配当前关键词的曲谱。" : "曲谱库暂时为空。"}</span></div>}
        </section>
      )}
    </>
  );
}

function PrivateArchive() {
  const [records, setRecords] = useState<CloudScoreMeta[]>([]);
  const [selected, setSelected] = useState<{ meta: CloudScoreMeta; snapshot: ScoreSnapshot } | null>(null);
  const [quota, setQuota] = useState<{ usedKeys: number; maxKeys: number; records: number } | null>(null);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);
  const [renaming, setRenaming] = useState<{ meta: CloudScoreMeta; snapshot: ScoreSnapshot } | null>(null);
  const [sharing, setSharing] = useState<{ title: string; snapshot: ScoreSnapshot } | null>(null);
  const available = hasToyAbility("getCloudStorage");
  const canPublish = libraryPublishConfigured && hasToyAbility("getUserProfile");

  async function refresh() {
    if (!available) return;
    setLoading(true);
    setError("");
    try {
      const [items, usage] = await Promise.all([listCloudScores(), cloudArchiveQuota()]);
      setRecords(items);
      setQuota(usage);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "云存档读取失败");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void refresh(); }, [available]);

  /** List rows carry metadata only, so actions that need notes load the record first. */
  async function withSnapshot(meta: CloudScoreMeta, run: (snapshot: ScoreSnapshot) => void) {
    setLoading(true);
    setError("");
    try {
      const record = await loadCloudScore(meta.id);
      run(record.snapshot);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "云端乐谱读取失败");
    } finally {
      setLoading(false);
    }
  }

  async function open(meta: CloudScoreMeta) {
    setLoading(true);
    setError("");
    try { setSelected(await loadCloudScore(meta.id)); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "云端乐谱读取失败"); }
    finally { setLoading(false); }
  }

  async function remove(meta: CloudScoreMeta) {
    if (!confirm(`删除云存档「${meta.title}」？`)) return;
    setLoading(true);
    try {
      await deleteCloudScore(meta.id);
      if (selected?.meta.id === meta.id) setSelected(null);
      await refresh();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "删除失败");
      setLoading(false);
    }
  }

  /** Renaming re-saves the same notes under a new revision, then renames the index entry. */
  async function rename(nextTitle: string) {
    if (!renaming) return;
    const meta = await saveCloudScore({ id: renaming.meta.id, title: nextTitle, snapshot: renaming.snapshot });
    if (selected?.meta.id === meta.id) setSelected({ meta, snapshot: renaming.snapshot });
    setMessage(`已改名为「${meta.title}」`);
    await refresh();
  }

  if (!available) return <div className="library-empty"><strong>TOY CLOUD STORAGE</strong><span>请在支持 CloudStorage 的 B站 Toy 环境中查看个人云存档。</span></div>;

  if (selected) {
    return (
      <>
        <section className="panel library-detail-head">
          <div><span className="eyebrow">PRIVATE CLOUD SCORE</span><h1>{selected.meta.title}</h1><p>{selected.meta.noteCount} notes · {durationLabel(selected.meta.durationMs)}</p></div>
          <div className="library-detail-actions">
            {canPublish && (
              <button className="button secondary" disabled={loading} onClick={() => setSharing({ title: selected.meta.title, snapshot: selected.snapshot })}>分享</button>
            )}
            <button className="button secondary" disabled={loading} onClick={() => setRenaming({ meta: selected.meta, snapshot: selected.snapshot })}>修改</button>
            <button className="button secondary" onClick={() => setSelected(null)}>返回云存档</button>
            <button className="button secondary" disabled={loading} onClick={() => void remove(selected.meta)}>删除</button>
          </div>
        </section>
        {message && <p className="library-message">{message}</p>}
        <ScoreWorkbench
          key={selected.meta.id}
          title={selected.meta.title}
          snapshot={selected.snapshot}
          archiveId={selected.meta.id}
          onSaved={() => { setMessage("云存档已更新"); void refresh(); }}
        />
        {renaming && (
          <RenameCloudScoreDialog
            title={renaming.meta.title}
            onSave={rename}
            onClose={() => setRenaming(null)}
            onMessage={setMessage}
          />
        )}
        {sharing && (
          <PublishArchiveDialog
            title={sharing.title}
            snapshot={sharing.snapshot}
            onMessage={setMessage}
            onPublished={(shortId) => { setSharing(null); setMessage(`已发布到公开曲谱库 · ${shortId}，可在「我的发布」里分享`); }}
            onClose={() => setSharing(null)}
          />
        )}
      </>
    );
  }

  return (
    <>
      <section className="panel library-search">
        <div><span className="eyebrow">TOY CLOUD STORAGE</span><h2>我的云存档</h2><p>DFHS 分片写入 Toy CloudStorage；新 revision 全部分片回读通过后才提交索引。</p></div>
        {quota && <div className="library-quota"><b>{quota.usedKeys} / {quota.maxKeys}</b><span>KEYS · {quota.records} SCORES</span></div>}
      </section>
      {error && <p className="error-note">{error}</p>}
      {message && <p className="library-message">{message}</p>}
      <section className="library-list">
        {records.map((meta) => (
          <article className="panel library-row" key={meta.id}>
            <button className="library-row-main as-button" onClick={() => void open(meta)} disabled={loading}>
              <span className="eyebrow">CLOUD / {meta.id}</span><h3>{meta.title}</h3><p>{new Date(meta.updatedAt).toLocaleString()}</p>
            </button>
            <div className="library-row-stats"><b>{meta.noteCount}</b><small>NOTES</small><b>{meta.parts}</b><small>PARTS</small><b>{Math.ceil(meta.bytes / 1024)}K</b><small>PACKED</small></div>
            <div className="library-row-actions">
              {canPublish ? (
                <button className="library-action" disabled={loading} onClick={() => void withSnapshot(meta, (snapshot) => setSharing({ title: meta.title, snapshot }))}>分享</button>
              ) : (
                <button className="library-action" disabled title="需要 Toy 登录和已部署的公开曲谱接口">分享</button>
              )}
              <button className="library-action" disabled={loading} onClick={() => void withSnapshot(meta, (snapshot) => setRenaming({ meta, snapshot }))}>修改</button>
              <button className="library-delete" onClick={() => void remove(meta)} disabled={loading}>删除</button>
            </div>
          </article>
        ))}
        {!records.length && !loading && <div className="library-empty"><strong>NO CLOUD SCORES</strong><span>在转换器里点 CLOUD 保存当前谱面，或打开一份公开谱后保存到云存档。</span></div>}
      </section>
    </>
  );
}

function MyPublished() {
  const [entries, setEntries] = useState<LibraryEntry[]>([]);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [editing, setEditing] = useState<LibraryEntry | null>(null);
  const [loading, setLoading] = useState(false);

  async function load() {
    if (!libraryPublishConfigured) return;
    setLoading(true);
    setError("");
    try {
      const token = await ensureOwnerToken();
      setEntries(await myPublicScores(token));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "我的发布读取失败");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void load(); }, []);

  async function remove(entry: LibraryEntry) {
    if (!confirm(`从公开曲谱库删除「${entry.title}」？`)) return;
    setLoading(true);
    try {
      await deletePublicScore(entry.id, await ensureOwnerToken());
      await load();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "删除失败");
      setLoading(false);
    }
  }

  if (!libraryPublishConfigured) return <div className="library-empty"><strong>PUBLISH API NOT CONFIGURED</strong><span>部署 CloudBase score-api 并填写 VITE_CLOUDBASE_API 后启用发布管理。</span></div>;
  if (!hasToyAbility("getCloudStorage")) return <div className="library-empty"><strong>TOY IDENTITY REQUIRED</strong><span>我的发布使用 Toy 云存储里的 ownerToken 鉴权。</span></div>;

  return (
    <>
      {error && <p className="error-note">{error}</p>}
      {message && <p className="library-message">{message}</p>}
      {editing && (
        <PublicScoreMetaForm
          entry={editing}
          onMessage={setMessage}
          onCancel={() => setEditing(null)}
          onSaved={() => { setEditing(null); void load(); }}
        />
      )}
      <section className="library-list">
        {entries.map((entry) => (
          <article className="panel library-row" key={entry.id}>
            <a className="library-row-main" href={scoreUrl(entry.id)}><span className="eyebrow">PUBLISHED / {entry.id}</span><h3>{entry.title}</h3><p>{entry.composer || "未标注原作者"}</p></a>
            <div className="library-row-stats"><b>{entry.noteCount}</b><small>NOTES</small><b>{entry.bpm}</b><small>BPM</small></div>
            <div className="library-row-actions">
              <ShareScoreButton id={entry.id} onMessage={setMessage} disabled={loading} />
              <button className="library-action" disabled={loading} onClick={() => setEditing(entry)}>修改</button>
              <button className="library-delete" disabled={loading} onClick={() => void remove(entry)}>下架</button>
            </div>
          </article>
        ))}
        {!entries.length && !loading && <div className="library-empty"><strong>NO PUBLISHED SCORES</strong><span>还没有使用当前 Toy 身份发布公开曲谱。</span></div>}
      </section>
    </>
  );
}

export default function CloudLibraryPage() {
  const initialRoute = readLibraryRoute();
  const [scoreId, setScoreId] = useState(initialRoute.scoreId);
  const [listQuery, setListQuery] = useState(initialRoute.query);
  const [tab, setTab] = useState<"public" | "private" | "mine">("public");
  const [favorites, setFavorites] = useState<string[]>([]);
  const [theme, setTheme] = useState(() => localStorage.getItem("dfh-theme") || "light");
  const rail = useRailCollapsed();

  useEffect(() => {
    const onPopState = () => {
      const route = readLibraryRoute();
      setScoreId(route.scoreId);
      setListQuery(route.query);
    };
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem("dfh-theme", theme);
  }, [theme]);

  useEffect(() => {
    if (!hasToyAbility("getCloudStorage")) return;
    void loadFavoriteIds().then(setFavorites).catch(() => undefined);
  }, []);

  return (
    <div className={`library-shell${rail.collapsed ? " rail-collapsed" : ""}`}>
      <aside className="side-rail library-rail">
        <a className="brand" href={converterHref()}><span>DFH</span><b>DELTA FORCE<br />HARMONICA</b></a>
        <nav aria-label="云端乐谱导航">
          <a href={converterHref()} title="乐谱转换"><i>01</i><span>乐谱转换</span></a>
          <button title="公开曲谱" className={!scoreId && tab === "public" ? "active" : ""} onClick={() => { history.pushState(null, "", publicListUrl(listQuery)); setScoreId(""); setTab("public"); }}><i>02</i><span>公开曲谱</span></button>
          <button title="我的云存档" className={!scoreId && tab === "private" ? "active" : ""} onClick={() => { history.pushState(null, "", libraryHref()); setScoreId(""); setListQuery(""); setTab("private"); }}><i>03</i><span>我的云存档</span></button>
          <button title="我的发布" className={!scoreId && tab === "mine" ? "active" : ""} onClick={() => { history.pushState(null, "", libraryHref()); setScoreId(""); setListQuery(""); setTab("mine"); }}><i>04</i><span>我的发布</span></button>
          <a href={aboutHref()} title="关于项目"><i>05</i><span>关于</span></a>
        </nav>
        <RailToggle collapsed={rail.collapsed} onToggle={rail.toggle} />
        <div className="rail-bottom"><b>α</b><span>TOY + CLOUDBASE<br />OBJECT STORAGE</span></div>
      </aside>
      <header className="top-status"><span><i className="status-dot" />CLOUD LIBRARY / {libraryConfigured ? "STORAGE READY" : "LOCAL PREVIEW"}</span><button onClick={() => setTheme(theme === "dark" ? "light" : "dark")}>{theme === "dark" ? "LIGHT" : "DARK"} MODE</button></header>
      <main className="page-content library-content">
        {scoreId ? <PublicDetail id={scoreId} favorites={favorites} onFavorites={setFavorites} /> : tab === "public" ? <PublicCatalog favorites={favorites} initialQuery={listQuery} /> : tab === "private" ? <PrivateArchive /> : <MyPublished />}
      </main>
    </div>
  );
}
