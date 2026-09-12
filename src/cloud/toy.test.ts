import { afterEach, describe, expect, it, vi } from "vitest";
import { openBilibiliAuthor, openBilibiliVideo } from "./toy";

afterEach(() => vi.unstubAllGlobals());

describe("Toy resource navigation", () => {
  it("uses Toy navigate for the author space and associated video", async () => {
    const navigate = vi.fn().mockResolvedValue(undefined);
    const open = vi.fn();
    vi.stubGlobal("window", {
      toy: { isSupport: (ability: string) => ability === "navigate", navigate },
      open
    });

    await openBilibiliAuthor("441133155");
    await openBilibiliVideo("BV1QbYS6GEu7");

    expect(navigate).toHaveBeenNthCalledWith(1, { type: "space", id: "441133155", extra: { from: "toy" } });
    expect(navigate).toHaveBeenNthCalledWith(2, { type: "video", id: "BV1QbYS6GEu7", extra: { from: "toy" } });
    expect(open).not.toHaveBeenCalled();
  });

  it("falls back to clean web links outside Toy", async () => {
    const open = vi.fn();
    vi.stubGlobal("window", { toy: undefined, open });

    await openBilibiliAuthor("441133155");
    await openBilibiliVideo("BV1QbYS6GEu7");

    expect(open).toHaveBeenNthCalledWith(1, "https://space.bilibili.com/441133155", "_blank", "noopener,noreferrer");
    expect(open).toHaveBeenNthCalledWith(2, "https://www.bilibili.com/video/BV1QbYS6GEu7", "_blank", "noopener,noreferrer");
  });
});
