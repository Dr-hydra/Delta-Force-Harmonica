"use strict";

// HTTP write API for the public score library. Public reads never come through
// this function: the browser loads JSONP objects from CloudBase storage/CDN.

const crypto = require("node:crypto");
const zlib = require("node:zlib");
const store = require("./store");

const MAX_PAYLOAD_CHARS = 256 * 1024;
const MAX_SCORES = 50;
const DFHS_VERSION = 1;

function json(statusCode, body) {
  return {
    statusCode,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers": "Content-Type",
      "Access-Control-Allow-Methods": "GET,POST,PATCH,DELETE,OPTIONS",
      "Access-Control-Max-Age": "86400"
    },
    body: JSON.stringify(body)
  };
}

function requestBody(event) {
  if (!event.body) return {};
  const body = event.isBase64Encoded ? Buffer.from(event.body, "base64").toString("utf8") : event.body;
  try { return JSON.parse(body); }
  catch { throw new Error("请求体不是有效 JSON"); }
}

const pathOf = (event) => String(event.path || event.rawPath || "/").replace(/\/+$/, "") || "/";
const methodOf = (event) => String(event.httpMethod || event.method || "GET").toUpperCase();
const queryOf = (event) => event.queryStringParameters || event.queryString || {};
const sha256 = (value) => crypto.createHash("sha256").update(String(value)).digest("hex");
const shortId = () => crypto.randomBytes(9).toString("base64url");
const shardOf = (id) => sha256(id)[0];
const shardKey = (shard) => `catalog/${shard}.json`;
const ownerKey = (ownerHash) => `own/${ownerHash}.json`;

class Cursor {
  constructor(bytes) { this.bytes = bytes; this.offset = 0; }
  u8() {
    if (this.offset >= this.bytes.length) throw new Error("DFHS 数据不完整");
    return this.bytes[this.offset++];
  }
  varint() {
    let result = 0;
    let shift = 1;
    for (;;) {
      const byte = this.u8();
      result += (byte & 0x7f) * shift;
      if (!(byte & 0x80)) return result;
      shift *= 128;
      if (shift > 2 ** 49) throw new Error("DFHS varint 过长");
    }
  }
}

/** Parse the authoritative score bytes; catalog statistics never trust the JSON body. */
function inspectPayload(payload) {
  if (!payload || payload.length > MAX_PAYLOAD_CHARS) throw new Error("曲谱数据为空或过大");
  if (!/^[A-Za-z0-9_-]+$/.test(payload)) throw new Error("曲谱数据不是 base64url");

  let packed;
  try { packed = Buffer.from(payload, "base64url"); }
  catch { throw new Error("曲谱数据无法解码"); }

  let bytes;
  try { bytes = zlib.inflateRawSync(packed); }
  catch { throw new Error("曲谱压缩数据损坏"); }

  const cursor = new Cursor(bytes);
  if (cursor.u8() !== 0x44 || cursor.u8() !== 0x46 || cursor.u8() !== 0x48 || cursor.u8() !== 0x53) {
    throw new Error("不是 DFHS 曲谱");
  }
  const version = cursor.u8();
  if (version !== DFHS_VERSION) throw new Error(`不支持的 DFHS 版本 ${version}`);

  const ppq = cursor.varint();
  if (ppq < 24 || ppq > 9600) throw new Error("曲谱 PPQ 无效");
  cursor.varint(); // zig-zag transpose

  const tempoCount = cursor.varint();
  if (tempoCount > 4096) throw new Error("速度事件过多");
  let tempoTick = 0;
  let bpm = 120;
  const tempoMap = [];
  for (let index = 0; index < tempoCount; index += 1) {
    tempoTick += cursor.varint();
    const eventBpm = cursor.varint() / 100;
    if (!(eventBpm > 0 && eventBpm <= 1000)) throw new Error("速度事件无效");
    if (index === 0) bpm = eventBpm;
    tempoMap.push([tempoTick, eventBpm]);
  }

  const signatureCount = cursor.varint();
  if (signatureCount > 1024) throw new Error("拍号事件过多");
  let tick = 0;
  for (let index = 0; index < signatureCount; index += 1) {
    tick += cursor.varint();
    const numerator = cursor.varint();
    const denominator = cursor.varint();
    if (!numerator || !denominator || numerator > 32 || denominator > 64) throw new Error("拍号事件无效");
  }

  const measureCount = cursor.varint();
  if (measureCount > 100000) throw new Error("小节数量异常");
  for (let index = 0; index < measureCount; index += 1) cursor.varint();

  const noteCount = cursor.varint();
  if (!noteCount) throw new Error("曲谱没有音符");
  if (noteCount > 1000000) throw new Error("音符数量异常");
  tick = 0;
  let endTick = 0;
  for (let index = 0; index < noteCount; index += 1) {
    tick += cursor.varint();
    const duration = cursor.varint();
    const pitch = cursor.u8();
    if (!duration || pitch > 127) throw new Error("音符数据无效");
    endTick = Math.max(endTick, tick + duration);
  }

  function ticksToMs(targetTick) {
    if (!tempoMap.length) return targetTick / ppq * 500;
    let time = 0;
    let previousTick = 0;
    let activeBpm = tempoMap[0][1];
    for (const [at, nextBpm] of tempoMap) {
      if (at > targetTick) break;
      time += (at - previousTick) / ppq * 60000 / activeBpm;
      previousTick = at;
      activeBpm = nextBpm;
    }
    time += (targetTick - previousTick) / ppq * 60000 / activeBpm;
    return Math.round(time);
  }

  return {
    version,
    ppq,
    bpm: Math.round(bpm * 100) / 100,
    noteCount,
    durationMs: ticksToMs(endTick),
    payloadHash: sha256(packed)
  };
}

function text(value, max) {
  return String(value || "").trim().slice(0, max);
}

function tagsOf(value) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map((tag) => text(tag, 16)).filter(Boolean))].slice(0, 8);
}

function difficultyOf(value) {
  const number = Math.round(Number(value) || 0);
  return Math.min(5, Math.max(0, number));
}

/** [id,title,composer,uploader,avatar,tags,difficulty,bpm,durationMs,noteCount,updatedAt] */
function publicRow(row) {
  return [row.i, row.t, row.c, row.u, row.a, row.g, row.d, row.b, row.l, row.n, row.m];
}

function publicScore(row) {
  return {
    i: row.i, t: row.t, c: row.c, u: row.u, a: row.a, g: row.g,
    d: row.d, b: row.b, l: row.l, n: row.n, m: row.m, p: row.p
  };
}

const readShard = async (shard) => (await store.readPrivate(shardKey(shard)))?.rows ?? [];
const readOwner = async (ownerHash) => (await store.readPrivate(ownerKey(ownerHash)))?.rows ?? [];

/** The owner file is the authority for update/delete permission, so it gets the same write verification as catalog shards. */
async function mutateOwner(ownerHash, apply, verify) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const rows = apply(await readOwner(ownerHash));
    await store.writePrivate(ownerKey(ownerHash), { rows });
    const settled = await readOwner(ownerHash);
    if (verify(settled)) return settled;
  }
  throw new Error("个人曲谱索引写入冲突，请稍后重试");
}

async function mutateIndex(shard, count) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const index = (await store.readPrivate("index.json")) || { v: 1, s: {} };
    if (count > 0) index.s[shard] = count;
    else delete index.s[shard];
    index.v = 1;
    index.n = Object.values(index.s).reduce((sum, value) => sum + Number(value || 0), 0);
    index.t = Date.now();
    await store.writePrivate("index.json", index);
    const settled = await store.readPrivate("index.json");
    if (Number(settled?.s?.[shard] || 0) === count) {
      await store.writeScript("index", settled);
      return settled;
    }
  }
  throw new Error("索引写入冲突，请稍后重试");
}

async function republishShard(shard, rows) {
  const sorted = [...rows].sort((a, b) => b.m - a.m || a.t.localeCompare(b.t));
  if (sorted.length) await store.writeScript(`catalog/${shard}`, { r: sorted.map(publicRow) });
  else await store.removeScript(`catalog/${shard}`).catch(() => undefined);
  await mutateIndex(shard, sorted.length);
}

/** Object storage has no CAS. Verify the settled private copy and retry against the latest value. */
async function mutateShard(shard, apply, verify) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const rows = apply(await readShard(shard));
    await store.writePrivate(shardKey(shard), { rows });
    const settled = await readShard(shard);
    if (verify(settled)) {
      await republishShard(shard, settled);
      return settled;
    }
  }
  throw new Error("曲谱目录写入冲突，请稍后重试");
}

async function ingest(body) {
  const ownerToken = String(body.ownerToken || "");
  if (ownerToken.length < 32) throw new Error("缺少 owner token");
  const title = text(body.title, 80);
  if (!title) throw new Error("曲谱标题不能为空");

  const payload = String(body.payload || "");
  const head = inspectPayload(payload);
  const ownerHash = sha256(ownerToken);
  const mine = await readOwner(ownerHash);
  if (mine.length >= MAX_SCORES) throw new Error(`公开曲谱已达上限（${MAX_SCORES} 首）`);
  if (mine.some((row) => row.h === head.payloadHash)) throw new Error("你已经发布过相同内容的曲谱");

  const row = {
    i: shortId(),
    o: ownerHash,
    h: head.payloadHash,
    t: title,
    c: text(body.composer, 80),
    u: text(body.uploader, 32) || "匿名玩家",
    a: text(body.avatar, 512),
    g: tagsOf(body.tags),
    d: difficultyOf(body.difficulty),
    b: head.bpm,
    l: head.durationMs,
    n: head.noteCount,
    m: Date.now(),
    p: payload
  };
  row.s = shardOf(row.i);

  // Publish the record body first. It is intentionally not discoverable until catalog succeeds.
  await store.writeScript(`score/${row.i}`, publicScore(row));

  // Owner authority must exist before catalog exposes the row, otherwise a partial upload could be impossible to delete.
  await mutateOwner(
    ownerHash,
    (rows) => [...rows.filter((item) => item.i !== row.i), row],
    (rows) => rows.some((item) => item.i === row.i && item.h === row.h)
  );

  try {
    await mutateShard(
      row.s,
      (rows) => [...rows.filter((item) => item.i !== row.i), row],
      (rows) => rows.some((item) => item.i === row.i && item.h === row.h)
    );
  } catch (error) {
    // Roll back the authority and orphan object when catalog publication failed.
    await mutateOwner(ownerHash, (rows) => rows.filter((item) => item.i !== row.i), (rows) => !rows.some((item) => item.i === row.i)).catch(() => undefined);
    await store.removeScript(`score/${row.i}`).catch(() => undefined);
    throw error;
  }

  return { shortId: row.i };
}

async function ownedRow(id, ownerToken) {
  if (String(ownerToken || "").length < 32) throw new Error("缺少 owner token");
  const ownerHash = sha256(ownerToken);
  const mine = await readOwner(ownerHash);
  const index = mine.findIndex((row) => row.i === id);
  if (index < 0) throw new Error("曲谱不存在或无权修改");
  return { ownerHash, mine, index, row: mine[index] };
}

async function updateScore(id, body) {
  const { ownerHash, row } = await ownedRow(id, body.ownerToken);
  const next = { ...row };

  if (Object.hasOwn(body, "title")) {
    next.t = text(body.title, 80);
    if (!next.t) throw new Error("曲谱标题不能为空");
  }
  if (Object.hasOwn(body, "composer")) next.c = text(body.composer, 80);
  if (Object.hasOwn(body, "tags")) next.g = tagsOf(body.tags);
  if (Object.hasOwn(body, "difficulty")) next.d = difficultyOf(body.difficulty);
  if (body.snapshot) {
    const payload = String(body.snapshot);
    const head = inspectPayload(payload);
    next.p = payload;
    next.h = head.payloadHash;
    next.b = head.bpm;
    next.l = head.durationMs;
    next.n = head.noteCount;
  }
  next.m = Date.now();

  await store.writeScript(`score/${id}`, publicScore(next));
  await mutateOwner(
    ownerHash,
    (rows) => rows.map((item) => item.i === id ? next : item),
    (rows) => rows.some((item) => item.i === id && item.m === next.m && item.h === next.h)
  );
  // Upsert instead of map-only: a later edit repairs a catalog row missing after an interrupted older deployment.
  await mutateShard(
    next.s,
    (rows) => [...rows.filter((item) => item.i !== id), next],
    (rows) => rows.some((item) => item.i === id && item.m === next.m && item.h === next.h)
  );
}

async function removeScore(id, ownerToken) {
  const { ownerHash, row } = await ownedRow(id, ownerToken);
  await mutateShard(
    row.s,
    (rows) => rows.filter((item) => item.i !== id),
    (rows) => !rows.some((item) => item.i === id)
  );
  await mutateOwner(
    ownerHash,
    (rows) => rows.filter((item) => item.i !== id),
    (rows) => !rows.some((item) => item.i === id)
  );
  await store.removeScript(`score/${id}`).catch(() => undefined);
}

exports.main = async (event) => {
  const method = methodOf(event);
  const path = pathOf(event);
  if (method === "OPTIONS") return json(204, {});

  try {
    const scoreMatch = /^\/scores\/([A-Za-z0-9_-]{6,32})$/.exec(path);

    if (method === "GET" && path === "/health") {
      const index = (await store.readPrivate("index.json")) || { s: {}, n: 0 };
      return json(200, {
        ok: true,
        storage: store.BUCKET,
        scores: Number(index.n || 0),
        shards: Object.keys(index.s || {}).length
      });
    }

    if (method === "POST" && path === "/scores") return json(201, await ingest(requestBody(event)));

    if (method === "GET" && path === "/me/scores") {
      const ownerToken = String(queryOf(event).ownerToken || "");
      if (ownerToken.length < 32) throw new Error("缺少 owner token");
      const rows = await readOwner(sha256(ownerToken));
      return json(200, { scores: rows.map(publicRow), limit: MAX_SCORES });
    }

    if (method === "PATCH" && scoreMatch) {
      await updateScore(scoreMatch[1], requestBody(event));
      return json(200, { ok: true });
    }

    if (method === "DELETE" && scoreMatch) {
      await removeScore(scoreMatch[1], requestBody(event).ownerToken);
      return json(200, { ok: true });
    }

    return json(404, { message: "未知接口" });
  } catch (error) {
    return json(400, { message: error?.message || "请求失败" });
  }
};

module.exports.inspectPayload = inspectPayload;
module.exports.publicRow = publicRow;
