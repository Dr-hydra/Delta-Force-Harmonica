/** Browser-only download helpers shared by the converter export panel and the score library. */

export function downloadBlob(filename: string, blob: Blob) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

export function downloadText(filename: string, content: string, type: string) {
  downloadBlob(filename, new Blob([content], { type }));
}

/** For binary artifacts such as the `.mid` export. */
export function downloadBytes(filename: string, bytes: Uint8Array, type: string) {
  downloadBlob(filename, new Blob([bytes as BlobPart], { type }));
}

export function safeFileName(name: string) {
  return (name.replace(/[\\/:*?"<>|]+/g, "_").trim() || "dfh-score").slice(0, 80);
}
