import { describe, expect, it } from "vitest";
import { aboutHref, converterHref, libraryHref } from "./navigation";

const current = "https://www.bilibili.com/toy/deltaforce/index.html?view=library&s=abc#detail";

describe("application navigation", () => {
  it("builds subpath-safe view links without carrying score state", () => {
    expect(converterHref(current)).toBe("/toy/deltaforce/index.html");
    expect(libraryHref(current)).toBe("/toy/deltaforce/index.html?view=library");
    expect(aboutHref(current)).toBe("/toy/deltaforce/index.html?view=about");
  });
});
