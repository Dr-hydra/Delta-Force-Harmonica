import {
  base64UrlToBytes,
  bytesToBase64Url,
  decodeScoreSnapshot,
  encodeScoreSnapshot,
  scoreSnapshotSummary,
  type ScoreSnapshot,
  type ScoreSnapshotInput
} from "../persistence/scoreCodec";
import { getCloudStorage, removeCloudStorage, setCloudStorage } from "./toy";

export const CLOUD_PART_CHARS = 960;
export const CLOUD_MAX_KEYS = 128;
export const CLOUD_RESERVED_KEYS = 4; // owner, favorites and room for future preferences/migration marker
const INDEX_KEY = "dfh_idx";
const INDEX_PREFIX = "dfh_idx_";
const RECORD_PREFIX = "dfh_rec_";
const INDEX_PAGE_MAX_BYTES = 940;

export interface CloudScoreMeta {
  id: string;
  title: string;
  updatedAt: number;
  revision: string;
  parts: number;
  bytes: number;
  noteCount: number;
  durationMs: number;
}

export interface CloudScoreRecord {
  meta: CloudScoreMeta;
  snapshot: ScoreSnapshot;
}

interface WireMeta {
  i: string;
  n: string;
  t: number;
  r: string;
  p: number;
  b: number;
  c: number;
  d: number;
}

interface IndexHead {
  v: 1;
  p: number;
}

const encoder = new TextEncoder();
const byteLength = (value: string) => encoder.encode(value).byteLength;

function wire(meta: CloudScoreMeta): WireMeta {
  return {
    i: meta.id,
    n: meta.title,
    t: meta.updatedAt,
    r: meta.revision,
    p: meta.parts,
    b: meta.bytes,
    c: meta.noteCount,
    d: meta.durationMs
  };
}

function widen(meta: WireMeta): CloudScoreMeta {
  return {
    id: String(meta.i || ""),
    title: String(meta.n || "未命名乐谱"),
    updatedAt: Number(meta.t) || 0,
    revision: String(meta.r || ""),
    parts: Math.max(0, Number(meta.p) || 0),
    bytes: Math.max(0, Number(meta.b) || 0),
    noteCount: Math.max(0, Number(meta.c) || 0),
    durationMs: Math.max(0, Number(meta.d) || 0)
  };
}

function randomId(bytes = 6) {
  const value = crypto.getRandomValues(new Uint8Array(bytes));
  return bytesToBase64Url(value);
}

function safeTitle(value: string) {
  return (value.trim() || "未命名乐谱").slice(0, 48);
}

function partKey(id: string, revision: string, index: number) {
  return `${RECORD_PREFIX}${id}_${revision}_${index}`;
}

export function splitCloudPayload(value: string, size = CLOUD_PART_CHARS) {
  const result: string[] = [];
  for (let offset = 0; offset < value.length; offset += size) result.push(value.slice(offset, offset + size));
  return result;
}

/**
 * Atomic replacement temporarily keeps the previous revision while all new
 * parts are written and verified. Count that peak, not only the final layout,
 * otherwise a save can pass preflight and then hit Toy's 128-key ceiling.
 */
export function estimateCloudPeakKeyCount(
  currentRecords: CloudScoreMeta[],
  currentPages: number,
  nextPages: number,
  newParts: number
) {
  const currentScoreParts = currentRecords.reduce((sum, item) => sum + item.parts, 0);
  return CLOUD_RESERVED_KEYS + 1 + Math.max(currentPages, nextPages) + currentScoreParts + newParts;
}

/** Packs variable-length metadata pages while keeping every Toy value comfortably under 1024 bytes. */
export function packCloudIndexPages(records: CloudScoreMeta[]) {
  const pages: string[] = [];
  let current: WireMeta[] = [];
  for (const meta of records) {
    const item = wire(meta);
    const candidate = JSON.stringify([...current, item]);
    if (current.length && byteLength(candidate) > INDEX_PAGE_MAX_BYTES) {
      pages.push(JSON.stringify(current));
      current = [item];
    } else {
      current.push(item);
    }
    if (byteLength(JSON.stringify(current)) > 1024) throw new Error("云存档索引条目过大，请缩短乐谱标题");
  }
  if (current.length) pages.push(JSON.stringify(current));
  return pages;
}

function parseHead(value: string | undefined): IndexHead {
  try {
    const parsed = JSON.parse(value || "") as Partial<IndexHead>;
    if (parsed.v === 1 && Number.isInteger(parsed.p) && (parsed.p as number) >= 0) return parsed as IndexHead;
  } catch {
    // Missing/corrupt index behaves as an empty archive; individual parts are never guessed.
  }
  return { v: 1, p: 0 };
}

async function readArchiveState() {
  const headOnly = await getCloudStorage([INDEX_KEY]);
  const head = parseHead(headOnly[INDEX_KEY]);
  if (!head.p) return { head, records: [] as CloudScoreMeta[] };
  const keys = Array.from({ length: head.p }, (_, index) => `${INDEX_PREFIX}${index}`);
  const pages = await getCloudStorage(keys);
  const records: CloudScoreMeta[] = [];
  for (const key of keys) {
    try {
      const items = JSON.parse(pages[key] || "[]") as WireMeta[];
      if (Array.isArray(items)) records.push(...items.map(widen).filter((item) => item.id && item.revision && item.parts > 0));
    } catch {
      throw new Error("Toy 云存档索引损坏");
    }
  }
  return { head, records };
}

async function commitIndex(records: CloudScoreMeta[], previousPages: number) {
  const sorted = [...records].sort((a, b) => b.updatedAt - a.updatedAt);
  const pages = packCloudIndexPages(sorted);
  const writes: Record<string, string> = { [INDEX_KEY]: JSON.stringify({ v: 1, p: pages.length } satisfies IndexHead) };
  pages.forEach((page, index) => { writes[`${INDEX_PREFIX}${index}`] = page; });
  await setCloudStorage(writes);

  const verify = await getCloudStorage([INDEX_KEY, ...pages.map((_, index) => `${INDEX_PREFIX}${index}`)]);
  if (verify[INDEX_KEY] !== writes[INDEX_KEY] || pages.some((page, index) => verify[`${INDEX_PREFIX}${index}`] !== page)) {
    throw new Error("Toy 云存档索引回读校验失败");
  }

  const stale = Array.from({ length: Math.max(0, previousPages - pages.length) }, (_, offset) => `${INDEX_PREFIX}${pages.length + offset}`);
  if (stale.length) await removeCloudStorage(stale);
}

export async function listCloudScores() {
  return (await readArchiveState()).records.sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function cloudArchiveQuota() {
  const { head, records } = await readArchiveState();
  const scoreKeys = records.reduce((sum, item) => sum + item.parts, 0);
  const used = 1 + head.p + scoreKeys + 2; // index/index-pages/score-parts + owner/favorites
  return {
    usedKeys: used,
    availableKeys: Math.max(0, CLOUD_MAX_KEYS - CLOUD_RESERVED_KEYS - (1 + head.p + scoreKeys)),
    maxKeys: CLOUD_MAX_KEYS,
    records: records.length
  };
}

export async function loadCloudScore(id: string): Promise<CloudScoreRecord> {
  const { records } = await readArchiveState();
  const meta = records.find((item) => item.id === id);
  if (!meta) throw new Error("云端乐谱不存在");
  const keys = Array.from({ length: meta.parts }, (_, index) => partKey(meta.id, meta.revision, index));
  const stored = await getCloudStorage(keys);
  const encoded = keys.map((key) => stored[key] || "").join("");
  if (!encoded || keys.some((key) => !stored[key])) throw new Error("云端乐谱分片不完整");
  const bytes = base64UrlToBytes(encoded);
  if (bytes.byteLength !== meta.bytes) throw new Error("云端乐谱大小校验失败");
  return { meta, snapshot: decodeScoreSnapshot(bytes) };
}

export interface SaveCloudScoreArgs {
  id?: string;
  title: string;
  snapshot: ScoreSnapshotInput;
}

/**
 * Revisioned parts make save atomic from the index's point of view: new parts are
 * written and read back first; only then does the index switch to the new revision.
 */
export async function saveCloudScore(args: SaveCloudScoreArgs): Promise<CloudScoreMeta> {
  const { head, records } = await readArchiveState();
  const id = args.id && /^[A-Za-z0-9_-]{6,16}$/.test(args.id) ? args.id : randomId();
  const previous = records.find((item) => item.id === id);
  const bytes = encodeScoreSnapshot(args.snapshot);
  const encoded = bytesToBase64Url(bytes);
  const parts = splitCloudPayload(encoded);
  const revision = randomId(4);
  const summary = scoreSnapshotSummary(decodeScoreSnapshot(bytes));
  const meta: CloudScoreMeta = {
    id,
    title: safeTitle(args.title),
    updatedAt: Date.now(),
    revision,
    parts: parts.length,
    bytes: bytes.byteLength,
    noteCount: summary.noteCount,
    durationMs: summary.durationMs
  };

  const nextRecords = [...records.filter((item) => item.id !== id), meta];
  const nextPages = packCloudIndexPages(nextRecords).length;
  const peakKeys = estimateCloudPeakKeyCount(records, head.p, nextPages, parts.length);
  if (peakKeys > CLOUD_MAX_KEYS) {
    const transient = previous ? "更新时需要同时保留上一版分片；" : "";
    throw new Error(`Toy 云存档空间不足：${transient}本次写入峰值需要 ${peakKeys} 个 key，上限 ${CLOUD_MAX_KEYS}`);
  }

  const writes: Record<string, string> = {};
  parts.forEach((part, index) => { writes[partKey(id, revision, index)] = part; });
  await setCloudStorage(writes);

  const newKeys = Object.keys(writes);
  const verify = await getCloudStorage(newKeys);
  if (newKeys.some((key) => verify[key] !== writes[key])) {
    await removeCloudStorage(newKeys).catch(() => undefined);
    throw new Error("Toy 云存档分片回读校验失败");
  }

  try {
    await commitIndex(nextRecords, head.p);
  } catch (error) {
    await removeCloudStorage(newKeys).catch(() => undefined);
    throw error;
  }

  if (previous) {
    const oldKeys = Array.from({ length: previous.parts }, (_, index) => partKey(previous.id, previous.revision, index));
    await removeCloudStorage(oldKeys).catch(() => undefined);
  }
  return meta;
}

export async function deleteCloudScore(id: string) {
  const { head, records } = await readArchiveState();
  const target = records.find((item) => item.id === id);
  if (!target) return;
  const remaining = records.filter((item) => item.id !== id);
  await commitIndex(remaining, head.p);
  const keys = Array.from({ length: target.parts }, (_, index) => partKey(target.id, target.revision, index));
  await removeCloudStorage(keys).catch(() => undefined);
}
