import { describe, expect, it } from "vitest";
import {
  CLOUD_MAX_KEYS,
  CLOUD_PART_CHARS,
  estimateCloudPeakKeyCount,
  packCloudIndexPages,
  splitCloudPayload,
  type CloudScoreMeta
} from "./archive";

function meta(index: number, title = `乐谱 ${index}`): CloudScoreMeta {
  return {
    id: `score_${index}`,
    title,
    updatedAt: 1000 + index,
    revision: `rev_${index}`,
    parts: 3,
    bytes: 1600,
    noteCount: 300,
    durationMs: 120000
  };
}

describe("Toy cloud archive layout", () => {
  it("splits base64url payload into safe ASCII values", () => {
    const value = "a".repeat(CLOUD_PART_CHARS * 2 + 17);
    const parts = splitCloudPayload(value);
    expect(parts.map((part) => part.length)).toEqual([CLOUD_PART_CHARS, CLOUD_PART_CHARS, 17]);
    expect(parts.join("")).toBe(value);
  });

  it("packs index pages below the Toy 1024 byte value limit", () => {
    const pages = packCloudIndexPages(Array.from({ length: 30 }, (_, index) => meta(index, `很长的中文乐谱标题 ${index} abcdefghijklmnop`)));
    expect(pages.length).toBeGreaterThan(1);
    for (const page of pages) {
      expect(new TextEncoder().encode(page).byteLength).toBeLessThanOrEqual(1024);
      expect(Array.isArray(JSON.parse(page))).toBe(true);
    }
  });

  it("counts the old revision during an atomic replacement", () => {
    const existing = { ...meta(1), parts: 118 };
    const peak = estimateCloudPeakKeyCount([existing], 1, 1, 5);
    expect(peak).toBe(129);
    expect(peak).toBeGreaterThan(CLOUD_MAX_KEYS);
  });

  it("allows a replacement when both revisions fit at the transient peak", () => {
    const existing = { ...meta(1), parts: 116 };
    expect(estimateCloudPeakKeyCount([existing], 1, 1, 5)).toBe(127);
  });
});
