export interface ToyProfile {
  avatar: string;
  nickname: string;
  toyOpenId?: string;
}

interface ToySdk {
  isSupport(ability: string): boolean;
  getUserProfile(): Promise<ToyProfile>;
  setCloudStorage(items: Record<string, string>): Promise<void>;
  getCloudStorage(keys?: string[]): Promise<Record<string, string>>;
  removeCloudStorage(keys: string[]): Promise<void>;
  share(req: { path: string }): Promise<void>;
  getQrCode(req?: { path?: string; size?: number }): Promise<{ base64: string; url: string }>;
}

declare global {
  interface Window {
    toy?: ToySdk;
  }
}

export const OWNER_KEY = "dfh_own";
export const FAVORITES_KEY = "dfh_fav";

function sdk(): ToySdk {
  if (!window.toy) throw new Error("当前环境未加载 Toy SDK，请在 B站 Toy 页面中使用此功能");
  return window.toy;
}

export function hasToyAbility(name: string): boolean {
  try { return Boolean(window.toy?.isSupport(name)); } catch { return false; }
}

export function toyAccountAvailable(): boolean {
  const agent = typeof navigator === "undefined" ? "" : navigator.userAgent;
  if (/BiliApp/i.test(agent)) return true;
  return !/Android|iPhone|iPad|iPod|Mobile/i.test(agent);
}

export async function requestToyProfile(): Promise<ToyProfile> {
  if (!toyAccountAvailable()) throw new Error("手机浏览器里读不到 Toy 账号，请在 B站 App 内打开");
  if (!hasToyAbility("getUserProfile")) throw new Error("当前环境不支持 Toy 登录");
  return sdk().getUserProfile();
}

export async function getCloudStorage(keys?: string[]) {
  if (!hasToyAbility("getCloudStorage")) throw new Error("当前环境不支持 Toy 云存档");
  return sdk().getCloudStorage(keys);
}

export async function setCloudStorage(items: Record<string, string>) {
  if (!hasToyAbility("setCloudStorage")) throw new Error("当前环境不支持 Toy 云存档");
  return sdk().setCloudStorage(items);
}

export async function removeCloudStorage(keys: string[]) {
  if (!hasToyAbility("removeCloudStorage")) throw new Error("当前环境不支持 Toy 云存档");
  return sdk().removeCloudStorage(keys);
}

function randomToken() {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

export async function ensureOwnerToken() {
  const stored = await getCloudStorage([OWNER_KEY]);
  const existing = String(stored[OWNER_KEY] || "");
  if (/^[A-Za-z0-9_-]{40,64}$/.test(existing)) return existing;
  const token = randomToken();
  await setCloudStorage({ [OWNER_KEY]: token });
  return token;
}

export async function loadFavoriteIds() {
  const stored = await getCloudStorage([FAVORITES_KEY]);
  try {
    const parsed = JSON.parse(stored[FAVORITES_KEY] || "[]");
    if (!Array.isArray(parsed)) return [];
    return parsed.map(String).filter((id) => /^[A-Za-z0-9_-]{6,32}$/.test(id)).slice(0, 100);
  } catch {
    return [];
  }
}

export async function saveFavoriteIds(ids: string[]) {
  const unique = [...new Set(ids.filter((id) => /^[A-Za-z0-9_-]{6,32}$/.test(id)))].slice(0, 100);
  const value = JSON.stringify(unique);
  if (new TextEncoder().encode(value).byteLength > 1024) throw new Error("收藏列表超过 Toy 云存储单 key 容量");
  await setCloudStorage({ [FAVORITES_KEY]: value });
}

export function scoreSharePath(shortId: string) {
  return `index.html?s=${encodeURIComponent(shortId)}`;
}

export function scoreShareUrl(shortId: string) {
  return `https://www.bilibili.com/toy/delta-force-harmonica/${scoreSharePath(shortId)}`;
}

export type ShareOutcome = "sheet" | "fallback";

export async function shareScore(shortId: string): Promise<ShareOutcome> {
  if (hasToyAbility("share")) {
    try {
      await sdk().share({ path: scoreSharePath(shortId) });
      return "sheet";
    } catch {
      // Web reports the API surface but throws when the native sheet is unavailable.
    }
  }
  return "fallback";
}

export async function scoreQrCode(shortId: string, size = 320) {
  if (!hasToyAbility("getQrCode")) throw new Error("当前环境不支持 Toy 二维码");
  return sdk().getQrCode({ path: scoreSharePath(shortId), size });
}
