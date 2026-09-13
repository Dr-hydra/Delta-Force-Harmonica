export type AppView = "library" | "about" | "batch";

export function converterHref(href = window.location.href) {
  return new URL(href).pathname;
}

export function viewHref(view: AppView, href = window.location.href) {
  const url = new URL(href);
  url.search = "";
  url.searchParams.set("view", view);
  url.hash = "";
  return `${url.pathname}${url.search}`;
}

export const libraryHref = (href?: string) => viewHref("library", href);
export const aboutHref = (href?: string) => viewHref("about", href);
export const batchHref = (href?: string) => viewHref("batch", href);
