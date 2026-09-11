import { describe, expect, it } from "vitest";
import { searchCatalog } from "./api";
import type { LibraryEntry } from "./types";

const rows: LibraryEntry[] = [
  { id: "a", title: "夜曲", composer: "周杰伦", uploader: "Hydra", avatar: "", tags: ["流行", "慢歌"], difficulty: 2, bpm: 90, durationMs: 1000, noteCount: 20, updatedAt: 2 },
  { id: "b", title: "Canon", composer: "Pachelbel", uploader: "User", avatar: "", tags: ["古典"], difficulty: 3, bpm: 80, durationMs: 1000, noteCount: 20, updatedAt: 1 }
];

describe("library search", () => {
  it("searches title, composer, uploader and tags locally", () => {
    expect(searchCatalog(rows, "周杰伦").map((row) => row.id)).toEqual(["a"]);
    expect(searchCatalog(rows, "hydra").map((row) => row.id)).toEqual(["a"]);
    expect(searchCatalog(rows, "古典").map((row) => row.id)).toEqual(["b"]);
  });

  it("applies required tags", () => {
    expect(searchCatalog(rows, "", ["流行", "慢歌"]).map((row) => row.id)).toEqual(["a"]);
    expect(searchCatalog(rows, "", ["流行", "古典"])).toEqual([]);
  });
});
