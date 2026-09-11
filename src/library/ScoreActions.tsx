import { useState } from "react";
import { ensureOwnerToken, requestToyProfile, sharePublicScore } from "../cloud/toy";
import type { ScoreSnapshot } from "../persistence/scoreCodec";
import { publishScore, updatePublicScore } from "./api";
import type { LibraryEntry } from "./types";

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

function reasonText(reason: unknown, fallback: string) {
  return reason instanceof Error ? reason.message : fallback;
}

function DifficultyField({ value, onChange }: { value: number; onChange: (next: number) => void }) {
  return (
    <label className="field">
      <span>难度</span>
      <select value={value} onChange={(event) => onChange(Number(event.target.value))}>
        {DIFFICULTY_OPTIONS.map((option) => (
          <option key={option.value} value={option.value}>{option.label}</option>
        ))}
      </select>
    </label>
  );
}

/** Toy share sheet first, copied link second — same behaviour everywhere in the library. */
export function ShareScoreButton({ id, onMessage, disabled, label = "分享", className = "library-action" }: {
  id: string;
  onMessage: (text: string) => void;
  disabled?: boolean;
  label?: string;
  className?: string;
}) {
  const [busy, setBusy] = useState(false);
  return (
    <button
      className={className}
      disabled={disabled || busy}
      onClick={() => {
        setBusy(true);
        void sharePublicScore(id)
          .then(onMessage)
          .catch((reason) => onMessage(reasonText(reason, "分享失败")))
          .finally(() => setBusy(false));
      }}
    >
      {label}
    </button>
  );
}


/** Metadata editor for a score the current Toy identity published. */
export function PublicScoreMetaForm({ entry, onSaved, onCancel, onMessage }: {
  entry: LibraryEntry;
  onSaved: () => void;
  onCancel: () => void;
  onMessage: (text: string) => void;
}) {
  const [title, setTitle] = useState(entry.title);
  const [composer, setComposer] = useState(entry.composer);
  const [tags, setTags] = useState(entry.tags.join(", "));
  const [difficulty, setDifficulty] = useState(entry.difficulty);
  const [busy, setBusy] = useState(false);

  function submit() {
    if (!title.trim()) {
      onMessage("曲谱标题不能为空");
      return;
    }
    setBusy(true);
    void ensureOwnerToken()
      .then((ownerToken) => updatePublicScore(entry.id, ownerToken, {
        title: title.trim(),
        composer: composer.trim(),
        tags: tagsFrom(tags),
        difficulty
      }))
      .then(() => {
        onMessage("已更新公开曲谱信息");
        onSaved();
      })
      .catch((reason) => onMessage(reasonText(reason, "修改失败")))
      .finally(() => setBusy(false));
  }

  return (
    <form className="library-form" onSubmit={(event) => { event.preventDefault(); submit(); }}>
      <span className="eyebrow">EDIT PUBLIC SCORE / {entry.id}</span>
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
      <DifficultyField value={difficulty} onChange={setDifficulty} />
      <div className="library-form-actions">
        <button className="button primary" disabled={busy}>保存修改</button>
        <button className="button secondary" type="button" disabled={busy} onClick={onCancel}>取消</button>
      </div>
    </form>
  );
}

/**
 * A Toy cloud archive is private, so the only share that means anything is
 * publishing it: the dialog collects the public metadata and hands back the
 * short id the caller can then share.
 */
export function PublishArchiveDialog({ title, snapshot, onPublished, onClose, onMessage }: {
  title: string;
  snapshot: ScoreSnapshot;
  onPublished: (shortId: string) => void;
  onClose: () => void;
  onMessage: (text: string) => void;
}) {
  const [composer, setComposer] = useState("");
  const [tags, setTags] = useState("");
  const [difficulty, setDifficulty] = useState(0);
  const [busy, setBusy] = useState(false);

  function submit() {
    setBusy(true);
    void (async () => {
      const ownerToken = await ensureOwnerToken();
      const profile = await requestToyProfile();
      const result = await publishScore({
        snapshot,
        ownerToken,
        title,
        composer: composer.trim(),
        uploader: profile.nickname || "匿名玩家",
        avatar: profile.avatar || "",
        tags: tagsFrom(tags),
        difficulty
      });
      onPublished(result.shortId);
    })().catch((reason) => onMessage(reasonText(reason, "发布失败"))).finally(() => setBusy(false));
  }

  return (
    <div className="library-modal-backdrop" onMouseDown={(event) => {
      if (event.target === event.currentTarget) onClose();
    }}>
      <section className="library-modal panel" role="dialog" aria-modal="true" aria-label="分享云存档">
        <div className="library-modal-head">
          <div><span className="eyebrow">SHARE ARCHIVE</span><h2>把「{title}」分享到公开曲谱库</h2></div>
          <button className="library-modal-close" onClick={onClose} aria-label="关闭">×</button>
        </div>
        <p className="library-modal-note">
          云存档只存在你自己的 Toy 云存储里，别人看不到。发布成公开曲谱后就能拿到分享链接；发布不会删掉这份云存档。
        </p>
        <form className="library-form" onSubmit={(event) => { event.preventDefault(); submit(); }}>
          <label className="field">
            <span>原曲 / 作者</span>
            <input value={composer} onChange={(event) => setComposer(event.target.value)} maxLength={80} placeholder="可选" />
          </label>
          <label className="field">
            <span>标签</span>
            <input value={tags} onChange={(event) => setTags(event.target.value)} maxLength={120} placeholder="流行, 简单, C调" />
          </label>
          <DifficultyField value={difficulty} onChange={setDifficulty} />
          <div className="library-form-actions">
            <button className="button primary" disabled={busy}>发布并获取链接</button>
            <button className="button secondary" type="button" disabled={busy} onClick={onClose}>取消</button>
          </div>
        </form>
      </section>
    </div>
  );
}

/**
 * Renaming rewrites the archive entry through the same atomic revision path as a
 * save, so the new title is only visible after the parts are back-verified.
 */
export function RenameCloudScoreDialog({ title, onSave, onClose, onMessage }: {
  title: string;
  onSave: (nextTitle: string) => Promise<void>;
  onClose: () => void;
  onMessage: (text: string) => void;
}) {
  const [value, setValue] = useState(title);
  const [busy, setBusy] = useState(false);

  function submit() {
    if (!value.trim()) {
      onMessage("存档名称不能为空");
      return;
    }
    setBusy(true);
    void onSave(value.trim())
      .then(onClose)
      .catch((reason) => onMessage(reasonText(reason, "修改失败")))
      .finally(() => setBusy(false));
  }

  return (
    <div className="library-modal-backdrop" onMouseDown={(event) => {
      if (event.target === event.currentTarget) onClose();
    }}>
      <section className="library-modal panel" role="dialog" aria-modal="true" aria-label="修改云存档名称">
        <div className="library-modal-head">
          <div><span className="eyebrow">EDIT CLOUD SCORE</span><h2>修改云存档名称</h2></div>
          <button className="library-modal-close" onClick={onClose} aria-label="关闭">×</button>
        </div>
        <p className="library-modal-note">改名会按新 revision 重写这份云存档的分片，谱面内容保持不变。</p>
        <form className="library-form" onSubmit={(event) => { event.preventDefault(); submit(); }}>
          <label className="field">
            <span>存档名称</span>
            <input value={value} onChange={(event) => setValue(event.target.value)} maxLength={48} placeholder="未命名乐谱" />
          </label>
          <div className="library-form-actions">
            <button className="button primary" disabled={busy}>保存修改</button>
            <button className="button secondary" type="button" disabled={busy} onClick={onClose}>取消</button>
          </div>
        </form>
      </section>
    </div>
  );
}
