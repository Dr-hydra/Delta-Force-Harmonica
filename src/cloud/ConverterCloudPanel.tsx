import { useState } from "react";
import { saveCloudScore } from "./archive";
import {
  copyText,
  ensureOwnerToken,
  hasToyAbility,
  requestToyProfile,
  scoreShareUrl,
  shareScore
} from "./toy";
import { readCurrentConverterScore, type CurrentConverterScore } from "../persistence/currentScore";
import {
  libraryPublishConfigured,
  publishScore,
  updatePublicScore
} from "../library/api";
import "./converterCloud.css";

function tagsFrom(value: string) {
  return [...new Set(value.split(/[，,]/).map((item) => item.trim()).filter(Boolean))].slice(0, 8);
}

function publicScoreHref(id: string) {
  const url = new URL(window.location.href);
  url.searchParams.delete("view");
  url.searchParams.set("s", id);
  url.hash = "";
  return `${url.pathname}${url.search}`;
}

export default function ConverterCloudPanel() {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [projectKey, setProjectKey] = useState("");
  const [title, setTitle] = useState("");
  const [composer, setComposer] = useState("");
  const [tags, setTags] = useState("");
  const [difficulty, setDifficulty] = useState(0);
  const [privateId, setPrivateId] = useState<string | null>(null);
  const [publicId, setPublicId] = useState<string | null>(null);

  const toyStorage = hasToyAbility("getCloudStorage") && hasToyAbility("setCloudStorage");
  const toyProfile = hasToyAbility("getUserProfile");

  function adoptCurrent(current: CurrentConverterScore) {
    const sameProject = current.projectKey === projectKey;
    if (!sameProject) {
      setProjectKey(current.projectKey);
      setTitle(current.title);
      setComposer("");
      setTags("");
      setDifficulty(0);
      setPrivateId(null);
      setPublicId(null);
    } else if (!title.trim()) {
      setTitle(current.title);
    }
    return sameProject;
  }

  function currentOrThrow() {
    const current = readCurrentConverterScore();
    if (!current) throw new Error("当前没有可保存的谱面，请先导入、载入 Demo 或手工添加音符");
    const sameProject = adoptCurrent(current);
    return { current, sameProject };
  }

  function show() {
    setMessage("");
    const current = readCurrentConverterScore();
    if (current) adoptCurrent(current);
    else setMessage("当前没有可保存的谱面。");
    setOpen(true);
  }

  async function savePrivate() {
    setBusy(true);
    setMessage("");
    try {
      const { current, sameProject } = currentOrThrow();
      const meta = await saveCloudScore({
        id: sameProject ? privateId ?? undefined : undefined,
        title: title.trim() || current.title,
        snapshot: current.snapshot
      });
      setPrivateId(meta.id);
      setMessage(`已保存到 Toy 云存档 · ${meta.noteCount} notes · ${meta.parts} parts`);
    } catch (reason) {
      setMessage(reason instanceof Error ? reason.message : "Toy 云存档失败");
    } finally {
      setBusy(false);
    }
  }

  async function publishCurrent() {
    setBusy(true);
    setMessage("");
    try {
      const { current, sameProject } = currentOrThrow();
      const ownerToken = await ensureOwnerToken();
      const resolvedTitle = title.trim() || current.title;
      const metadata = {
        title: resolvedTitle,
        composer: composer.trim(),
        tags: tagsFrom(tags),
        difficulty,
        snapshot: current.snapshot
      };

      if (sameProject && publicId) {
        await updatePublicScore(publicId, ownerToken, metadata);
        setMessage(`公开曲谱已更新 · ${publicId}`);
        return;
      }

      const profile = await requestToyProfile();
      const result = await publishScore({
        ...metadata,
        ownerToken,
        uploader: profile.nickname || "匿名玩家",
        avatar: profile.avatar || ""
      });
      setPublicId(result.shortId);
      setMessage(`已发布到公开曲谱库 · ${result.shortId}`);
    } catch (reason) {
      setMessage(reason instanceof Error ? reason.message : "公开发布失败");
    } finally {
      setBusy(false);
    }
  }

  async function sharePublished() {
    if (!publicId) return;
    setBusy(true);
    setMessage("");
    try {
      const outcome = await shareScore(publicId);
      if (outcome === "sheet") setMessage("已打开 Toy 分享面板");
      else {
        const url = scoreShareUrl(publicId);
        setMessage(await copyText(url) ? "分享链接已复制" : `分享链接：${url}`);
      }
    } catch (reason) {
      setMessage(reason instanceof Error ? reason.message : "分享失败");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <button className="converter-cloud-trigger" onClick={show}>
        CLOUD
        <span>保存 / 发布</span>
      </button>

      {open && (
        <div className="converter-cloud-backdrop" onMouseDown={(event) => {
          if (event.target === event.currentTarget) setOpen(false);
        }}>
          <section className="converter-cloud-panel" role="dialog" aria-modal="true" aria-label="云端保存与发布">
            <div className="converter-cloud-head">
              <div>
                <span className="eyebrow">TOY / CLOUDBASE</span>
                <h2>保存与发布当前谱面</h2>
              </div>
              <button className="converter-cloud-close" onClick={() => setOpen(false)} aria-label="关闭">×</button>
            </div>

            <p className="converter-cloud-note">
              保存的是当前编辑后的单音谱面、完整 tempo / 拍号和当前移调，不上传原 MIDI 或音频。
            </p>

            <div className="converter-cloud-fields">
              <label className="field">
                <span>曲谱标题</span>
                <input value={title} onChange={(event) => setTitle(event.target.value)} maxLength={80} placeholder="未命名乐谱" />
              </label>
              <label className="field">
                <span>原曲 / 作者</span>
                <input value={composer} onChange={(event) => setComposer(event.target.value)} maxLength={80} placeholder="可选" />
              </label>
              <label className="field">
                <span>标签</span>
                <input value={tags} onChange={(event) => setTags(event.target.value)} maxLength={120} placeholder="流行, 简单, C调" />
              </label>
              <label className="field">
                <span>难度</span>
                <select value={difficulty} onChange={(event) => setDifficulty(Number(event.target.value))}>
                  <option value={0}>未标注</option>
                  <option value={1}>★☆☆☆☆</option>
                  <option value={2}>★★☆☆☆</option>
                  <option value={3}>★★★☆☆</option>
                  <option value={4}>★★★★☆</option>
                  <option value={5}>★★★★★</option>
                </select>
              </label>
            </div>

            <div className="converter-cloud-actions">
              <button className="button primary" disabled={busy || !toyStorage} onClick={() => void savePrivate()}>
                {privateId ? "更新我的云存档" : "保存到我的云存档"}
              </button>
              <button
                className="button"
                disabled={busy || !toyStorage || !toyProfile || !libraryPublishConfigured}
                onClick={() => void publishCurrent()}
              >
                {publicId ? "更新公开曲谱" : "发布到公开曲谱库"}
              </button>
              {publicId && (
                <button className="button" disabled={busy} onClick={() => void sharePublished()}>分享已发布曲谱</button>
              )}
              {publicId && <a className="button converter-cloud-link" href={publicScoreHref(publicId)}>打开公开页面</a>}
            </div>

            {!toyStorage && <p className="converter-cloud-status">当前不是可用的 Toy CloudStorage 环境；部署前在普通浏览器里按钮会保持禁用。</p>}
            {toyStorage && !libraryPublishConfigured && <p className="converter-cloud-status">私人云存档可用；公开发布要等 CloudBase 网关与存储地址配置后启用。</p>}
            {message && <p className="converter-cloud-message">{message}</p>}
          </section>
        </div>
      )}
    </>
  );
}
