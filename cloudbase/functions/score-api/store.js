"use strict";

// Object storage is the whole public-library database.
// Public objects are JSONP loaded by the Toy page through <script>; private
// objects are gzip JSON used only by the function for read-modify-write state.

const zlib = require("node:zlib");
const cloud = require("@cloudbase/node-sdk");

const app = cloud.init({ env: cloud.SYMBOL_CURRENT_ENV });

const BASE = String(process.env.SCORE_STORAGE_BASE || "").replace(/\/$/, "");
const BUCKET = String(process.env.SCORE_BUCKET || "harmonica");
const DATA_KEY = String(process.env.SCORE_DATA_KEY || "data");

const publicPath = (key) => `${BUCKET}/${key}`;
const privatePath = (key) => `${BUCKET}/${DATA_KEY}/${key}`;

let idPrefix = null;
async function fileId(path) {
  if (idPrefix === null) {
    const probe = publicPath(".probe");
    const meta = await app.getUploadMetadata({ cloudPath: probe });
    const id = String(meta?.data?.fileId || "");
    if (!id.endsWith(probe)) throw new Error("无法解析存储 fileID 前缀");
    idPrefix = id.slice(0, id.length - probe.length);
  }
  return idPrefix + path;
}

async function readPath(path, { fresh = false } = {}) {
  if (!BASE) throw new Error("未配置 SCORE_STORAGE_BASE");
  const suffix = fresh ? `?t=${Date.now()}-${Math.random().toString(36).slice(2)}` : "";
  const response = await fetch(`${BASE}/${path}${suffix}`, { cache: "no-store" });
  if (response.status === 404 || response.status === 403) return null;
  if (!response.ok) throw new Error(`存储读取失败（${response.status}）`);
  return Buffer.from(await response.arrayBuffer());
}

async function writePath(path, body) {
  await app.uploadFile({ cloudPath: path, fileContent: body });
}

async function readPrivate(key) {
  const raw = await readPath(privatePath(key), { fresh: true });
  if (!raw) return null;
  try { return JSON.parse(zlib.gunzipSync(raw).toString("utf8")); }
  catch { return JSON.parse(raw.toString("utf8")); }
}

async function writePrivate(key, value) {
  const bytes = Buffer.from(JSON.stringify(value), "utf8");
  await writePath(privatePath(key), zlib.gzipSync(bytes, { level: 6 }));
}

async function writeScript(key, value) {
  const body = `__dfh(${JSON.stringify(key)},${JSON.stringify(value)});\n`;
  await writePath(publicPath(`${key}.js`), Buffer.from(body, "utf8"));
}

async function readScript(key) {
  const raw = await readPath(publicPath(`${key}.js`), { fresh: true });
  if (!raw) return null;
  const text = raw.toString("utf8");
  const start = text.indexOf(",");
  const end = text.lastIndexOf(")");
  if (start < 0 || end < start) return null;
  try { return JSON.parse(text.slice(start + 1, end)); }
  catch { return null; }
}

async function removeObjects(paths) {
  if (!paths.length) return;
  const fileList = await Promise.all(paths.map(fileId));
  await app.deleteFile({ fileList });
}

const removeScript = (key) => removeObjects([publicPath(`${key}.js`)]);
const removePrivate = (key) => removeObjects([privatePath(key)]);

module.exports = {
  app, BASE, BUCKET,
  publicPath, privatePath,
  readPrivate, writePrivate,
  writeScript, readScript,
  removeScript, removePrivate, removeObjects
};
