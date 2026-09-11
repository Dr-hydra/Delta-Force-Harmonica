import { loadJsonp } from "../cloud/jsonp";
import {
  base64UrlToBytes,
  bytesToBase64Url,
  decodeScoreSnapshot,
  encodeScoreSnapshot,
  type ScoreSnapshotInput
} from "../persistence/scoreCodec";
import type { LibraryEntry, LibraryIndex, PublicScore, PublishScoreArgs } from "./types";

const API_BASE = (import.meta.env.VITE_CLOUDBASE_API as string | undefined)?.replace(/\/$/, "") ?? "";
const STORAGE_BASE = (import.meta.env.VITE_SCORE_STORAGE as string | undefined)?.replace(/\/$/, "") ?? "";

export const libraryConfigured = Boolean(STORAGE_BASE);
export const libraryPublishConfigured = Boolean(API_BASE && STORAGE_BASE);
export const MAX_PUBLIC_SCORES_PER_USER = 50;

// [id,title,composer,uploader,avatar,tags,difficulty,bpm,durationMs,noteCount,updatedAt]
type WireCatalogRow = [string, string, string, string, string, string[], number, number, number, number, number];

interface WireIndex {
  v?: number;
  n?: number;
  t?: number;
  s?: Record<string, number>;
}

interface WirePublicScore {
  i: string;
  t: string;
  c: string;
  u: string;
  a: string;
  g: string[];
  d: number;
  b: number;
  l: number;
  n: number;
  m: number;
  p: string;
}

function endpoint(path: string) {
  if (!API_BASE) throw new Error("尚未配置 CloudBase API 地址");
  return `${API_BASE}${path}`;
}

async function responseJson<T>(response: Response): Promise<T> {
  const payload = (await response.json().catch(() => ({}))) as { message?: string } & T;
  if (!response.ok) throw new Error(payload.message || `请求失败（${response.status}）`);
  return payload;
}

function widen(row: WireCatalogRow): LibraryEntry {
  return {
    id: row[0],
    title: row[1],
    composer: row[2] || "",
    uploader: row[3] || "匿名玩家",
    avatar: row[4] || "",
    tags: Array.isArray(row[5]) ? row[5] : [],
    difficulty: row[6] || 0,
    bpm: row[7] || 120,
    durationMs: row[8] || 0,
    noteCount: row[9] || 0,
    updatedAt: row[10] || 0
  };
}

function widenPublic(payload: WirePublicScore): PublicScore {
  return {
    id: payload.i,
    title: payload.t,
    composer: payload.c || "",
    uploader: payload.u || "匿名玩家",
    avatar: payload.a || "",
    tags: Array.isArray(payload.g) ? payload.g : [],
    difficulty: payload.d || 0,
    bpm: payload.b || 120,
    durationMs: payload.l || 0,
    noteCount: payload.n || 0,
    updatedAt: payload.m || 0,
    snapshot: decodeScoreSnapshot(base64UrlToBytes(payload.p))
  };
}

export async function getLibraryIndex(): Promise<LibraryIndex> {
  const payload = await loadJsonp<WireIndex>(STORAGE_BASE, "index", { freshness: 60_000 });
  return {
    version: payload?.v ?? 1,
    count: payload?.n ?? 0,
    updatedAt: payload?.t ?? 0,
    shards: payload?.s ?? {}
  };
}

export async function getCatalog(): Promise<LibraryEntry[]> {
  const index = await getLibraryIndex();
  const shardIds = Object.entries(index.shards)
    .filter(([, count]) => count > 0)
    .map(([id]) => id)
    .sort();
  const pages = await Promise.all(shardIds.map(async (shard) => {
    const payload = await loadJsonp<{ r?: WireCatalogRow[] }>(STORAGE_BASE, `catalog/${shard}`, { freshness: 60_000 });
    return payload?.r ?? [];
  }));
  return pages.flat().map(widen).sort((a, b) => b.updatedAt - a.updatedAt || a.title.localeCompare(b.title));
}

export function searchCatalog(entries: LibraryEntry[], query: string, tags: string[] = []) {
  const needle = query.trim().toLocaleLowerCase();
  const requiredTags = tags.map((tag) => tag.trim().toLocaleLowerCase()).filter(Boolean);
  return entries.filter((entry) => {
    const haystack = [entry.title, entry.composer, entry.uploader, ...entry.tags].join("\n").toLocaleLowerCase();
    if (needle && !haystack.includes(needle)) return false;
    if (requiredTags.length && !requiredTags.every((tag) => entry.tags.some((value) => value.toLocaleLowerCase() === tag))) return false;
    return true;
  });
}

export async function getPublicScore(shortId: string): Promise<PublicScore> {
  if (!/^[A-Za-z0-9_-]{6,32}$/.test(shortId)) throw new Error("曲谱 ID 无效");
  const payload = await loadJsonp<WirePublicScore>(STORAGE_BASE, `score/${shortId}`, { freshness: 300_000 });
  if (!payload) throw new Error("曲谱不存在或已下架");
  return widenPublic(payload);
}

export async function publishScore(args: PublishScoreArgs): Promise<{ shortId: string }> {
  const payload = bytesToBase64Url(encodeScoreSnapshot(args.snapshot));
  const response = await fetch(endpoint("/scores"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      payload,
      ownerToken: args.ownerToken,
      title: args.title,
      composer: args.composer || "",
      uploader: args.uploader,
      avatar: args.avatar || "",
      tags: args.tags ?? [],
      difficulty: args.difficulty ?? 0
    })
  });
  return responseJson(response);
}

export async function updatePublicScore(
  shortId: string,
  ownerToken: string,
  changes: Partial<Pick<PublishScoreArgs, "title" | "composer" | "tags" | "difficulty">> & { snapshot?: ScoreSnapshotInput }
) {
  const response = await fetch(endpoint(`/scores/${encodeURIComponent(shortId)}`), {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      ownerToken,
      ...changes,
      snapshot: changes.snapshot ? bytesToBase64Url(encodeScoreSnapshot(changes.snapshot)) : undefined
    })
  });
  return responseJson<{ ok: true }>(response);
}

export async function deletePublicScore(shortId: string, ownerToken: string) {
  const response = await fetch(endpoint(`/scores/${encodeURIComponent(shortId)}`), {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ownerToken })
  });
  return responseJson<{ ok: true }>(response);
}

export async function myPublicScores(ownerToken: string): Promise<LibraryEntry[]> {
  const response = await fetch(endpoint(`/me/scores?ownerToken=${encodeURIComponent(ownerToken)}`));
  const payload = await responseJson<{ scores: WireCatalogRow[]; limit: number }>(response);
  return payload.scores.map(widen).sort((a, b) => b.updatedAt - a.updatedAt);
}
