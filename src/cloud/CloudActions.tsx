import { useState } from "react";
import { saveCloudScore, type CloudScoreMeta } from "./archive";
import { ensureOwnerToken, hasToyAbility, requestToyProfile, sharePublicScore } from "./toy";
import { libraryPublishConfigured, publishScore, updatePublicScore } from "../library/api";
import type { ScoreSnapshotInput } from "../persistence/scoreCodec";
import "./converterCloud.css";

const DIFFICULTY_OPTIONS = [
  { value: 0, label: "未标注" },
  { value: 1, label: "★☆☆☆☆" },
  { value: 2, label: "★★☆☆☆" },
  { value: 3, label: "★★★☆☆" },
  { value: 4, label: "★★★★☆" },
  { value: 5, label: "★★★★★" }
];

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

export interface CloudActionsProps {
  title: string;
  /** The notes to store: the converter's current score, or a library working copy. */
  snapshot: ScoreSnapshotInput;
  /** Existing private archive record, so saving updates it instead of duplicating it. */
  archiveId?: string;
  /** Existing public short id owned by the current Toy identity. */
  publicId?: string;
  /** Renders the converter export-style panel wrapper around the actions. */
  heading?: { eyebrow: string; title: string };
  onMessage?: (text: string) => void;
  onSaved?: (meta: CloudScoreMeta) => void;
  onPublished?: (shortId: string) => void;
}

/**
 * Toy cloud save / publish, shared by the converter's floating CLOUD panel and
 * the score library detail pages. Hosts mount it with a key tied to the score
 * they are showing, so switching score resets the metadata fields.
 */
export default function CloudActions({
  title,
  snapshot,
  archiveId,
  publicId,
  heading,
  onMessage,
  onSaved,
  onPublished
}: CloudActionsProps) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [name, setName] = useState(title);
  const [composer, setComposer] = useState("");
  const [tags, setTags] = useState("");
  const [difficulty, setDifficulty] = useState(0);
  const [privateId, setPrivateId] = useState<string | null>(archiveId ?? null);
  const [publishedId, setPublishedId] = useState<string | null>(publicId ?? null);

  const toyStorage = hasToyAbility("getCloudStorage") && hasToyAbility("setCloudStorage");
  const toyProfile = hasToyAbility("getUserProfile");
  const canPublish = toyStorage && toyProfile && libraryPublishConfigured;

  function say(text: string) {
    setMessage(text);
    onMessage?.(text);
  }

  const resolvedTitle = name.trim() || title.trim() || "未命名乐谱";

  async function savePrivate() {
    setBusy(true);
    setMessage("");
    try {
      const meta = await saveCloudScore({ id: privateId ?? undefined, title: resolvedTitle, snapshot });
      setPrivateId(meta.id);
      say(`已保存到 Toy 云存档 · ${meta.noteCount} notes · ${meta.parts} parts`);
      onSaved?.(meta);
    } catch (reason) {
      say(reason instanceof Error ? reason.message : "Toy 云存档失败");
    } finally {
      setBusy(false);
    }
  }

  async function publish() {
    setBusy(true);
    setMessage("");
    try {
      const ownerToken = await ensureOwnerToken();
      const metadata = {
        title: resolvedTitle,
        composer: composer.trim(),
        tags: tagsFrom(tags),
        difficulty
      };

      if (publishedId) {
        await updatePublicScore(publishedId, ownerToken, { ...metadata, snapshot });
        say(`公开曲谱已更新 · ${publishedId}`);
        return;
      }

      const profile = await requestToyProfile();
      const result = await publishScore({
        ...metadata,
        snapshot,
        ownerToken,
        uploader: profile.nickname || "匿名玩家",
        avatar: profile.avatar || ""
      });
      setPublishedId(result.shortId);
      say(`已发布到公开曲谱库 · ${result.shortId}`);
      onPublished?.(result.shortId);
    } catch (reason) {
      say(reason instanceof Error ? reason.message : "公开发布失败");
    } finally {
      setBusy(false);
    }
  }

  async function sharePublished() {
    if (!publishedId) return;
    setBusy(true);
    setMessage("");
    try {
      say(await sharePublicScore(publishedId));
    } catch (reason) {
      say(reason instanceof Error ? reason.message : "分享失败");
    } finally {
      setBusy(false);
    }
  }

  const body = (
    <>
      <p className="converter-cloud-note">
        保存的是当前编辑后的单音谱面、完整 tempo / 拍号和当前移调，不上传原 MIDI 或音频。
      </p>

      <div className="converter-cloud-fields">
        <label className="field">
          <span>曲谱标题</span>
          <input value={name} onChange={(event) => setName(event.target.value)} maxLength={80} placeholder="未命名乐谱" />
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
            {DIFFICULTY_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </select>
        </label>
      </div>

      <div className="converter-cloud-actions">
        <button className="button primary" disabled={busy || !toyStorage} onClick={() => void savePrivate()}>
          {privateId ? "更新我的云存档" : "保存到我的云存档"}
        </button>
        <button className="button" disabled={busy || !canPublish} onClick={() => void publish()}>
          {publishedId ? "更新公开曲谱" : "发布到公开曲谱库"}
        </button>
        {publishedId && (
          <button className="button" disabled={busy} onClick={() => void sharePublished()}>分享已发布曲谱</button>
        )}
        {publishedId && <a className="button converter-cloud-link" href={publicScoreHref(publishedId)}>打开公开页面</a>}
      </div>

      {!toyStorage && <p className="converter-cloud-status">当前不是可用的 Toy CloudStorage 环境；部署前在普通浏览器里按钮会保持禁用。</p>}
      {toyStorage && !libraryPublishConfigured && <p className="converter-cloud-status">私人云存档可用；公开发布要等 CloudBase 网关与存储地址配置后启用。</p>}
      {message && <p className="converter-cloud-message">{message}</p>}
    </>
  );

  if (!heading) return body;

  return (
    <section className="panel control-panel" style={{ marginTop: 18 }}>
      <div className="section-heading">
        <div><span className="eyebrow">{heading.eyebrow}</span><h2>{heading.title}</h2></div>
        <span className="data-note">{toyStorage ? "TOY CLOUDSTORAGE" : "UNAVAILABLE"}</span>
      </div>
      {body}
    </section>
  );
}
