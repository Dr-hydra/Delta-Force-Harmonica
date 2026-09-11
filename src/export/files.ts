/** Browser-only download helpers shared by the converter export panel and the score library. */

export function downloadText(filename: string, content: string, type: string) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

export function safeFileName(name: string) {
  return (name.replace(/[\\/:*?"<>|]+/g, "_").trim() || "dfh-score").slice(0, 80);
}
