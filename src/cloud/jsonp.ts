type Resolver = (value: unknown) => void;
const pending = new Map<string, Resolver[]>();

declare global {
  interface Window {
    __dfh?: (key: string, value: unknown) => void;
  }
}

function ensureCallback() {
  if (typeof window === "undefined" || window.__dfh) return;
  window.__dfh = (key, value) => {
    const waiting = pending.get(key);
    pending.delete(key);
    waiting?.forEach((resolve) => resolve(value));
  };
}

export interface JsonpOptions {
  freshness?: number;
  timeoutMs?: number;
}

/** CloudBase public storage has no usable CORS headers in Toy; classic scripts do not send Origin. */
export function loadJsonp<T>(base: string, key: string, options: JsonpOptions = {}): Promise<T | null> {
  const { freshness = 30_000, timeoutMs = 12_000 } = options;
  if (!base || typeof document === "undefined") return Promise.resolve(null);
  ensureCallback();

  return new Promise<T | null>((resolve) => {
    let settled = false;
    const script = document.createElement("script");
    let timer = 0;
    const finish = (value: T | null) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timer);
      script.remove();
      const waiting = (pending.get(key) ?? []).filter((item) => item !== onData);
      if (waiting.length) pending.set(key, waiting);
      else pending.delete(key);
      resolve(value);
    };
    const onData = (value: unknown) => finish(value as T);
    pending.set(key, [...(pending.get(key) ?? []), onData]);

    script.src = `${base}/${key}.js?t=${Math.floor(Date.now() / freshness)}`;
    script.async = true;
    script.addEventListener("error", () => finish(null));
    timer = window.setTimeout(() => finish(null), timeoutMs);
    document.head.appendChild(script);
  });
}
