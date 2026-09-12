import { afterEach, describe, expect, it, vi } from "vitest";
import { openBilibiliAuthor, openBilibiliVideo, qrImageSource, scoreQrCode } from "./toy";

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

describe("Toy QR sharing", () => {
  it("requests a QR code for the public score path", async () => {
    const getQrCode = vi.fn().mockResolvedValue({ base64: "png-data", url: "https://b23.tv/short" });
    vi.stubGlobal("window", {
      toy: { isSupport: (ability: string) => ability === "getQrCode", getQrCode }
    });

    await expect(scoreQrCode("abc_123")).resolves.toEqual({ base64: "png-data", url: "https://b23.tv/short" });
    expect(getQrCode).toHaveBeenCalledWith({ path: "index.html?s=abc_123", size: 320 });
  });

  it("normalizes raw base64 without changing complete data URLs", () => {
    expect(qrImageSource("abc123")).toBe("data:image/png;base64,abc123");
    expect(qrImageSource("data:image/webp;base64,xyz")).toBe("data:image/webp;base64,xyz");
  });
});
