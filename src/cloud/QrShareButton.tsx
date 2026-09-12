import { useState } from "react";
import { copyText, hasToyAbility, qrImageSource, scoreQrCode } from "./toy";
import "./qrShare.css";

interface QrResult {
  image: string;
  shortUrl: string;
}

export default function QrShareButton({ id, onMessage, disabled, className = "library-action", label = "二维码分享" }: {
  id: string;
  onMessage: (text: string) => void;
  disabled?: boolean;
  className?: string;
  label?: string;
}) {
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<QrResult | null>(null);
  const supported = hasToyAbility("getQrCode");

  async function open() {
    setBusy(true);
    try {
      const qr = await scoreQrCode(id);
      setResult({ image: qrImageSource(qr.base64), shortUrl: qr.url });
    } catch (reason) {
      onMessage(reason instanceof Error ? reason.message : "二维码生成失败");
    } finally {
      setBusy(false);
    }
  }

  async function copyShortUrl() {
    if (!result) return;
    onMessage((await copyText(result.shortUrl)) ? "短链接已复制" : `短链接：${result.shortUrl}`);
  }

  return (
    <>
      <button
        className={className}
        disabled={disabled || busy || !supported}
        title={supported ? "显示二维码和短链接" : "需要在支持二维码能力的 B站 Toy 中使用"}
        onClick={() => void open()}
      >
        {busy ? "生成中…" : label}
      </button>
      {result && (
        <div className="qr-share-backdrop" onMouseDown={(event) => {
          if (event.target === event.currentTarget) setResult(null);
        }}>
          <section className="qr-share-dialog panel" role="dialog" aria-modal="true" aria-label="二维码分享">
            <header>
              <div><span className="eyebrow">QR SHARE</span><h2>二维码分享</h2></div>
              <button className="qr-share-close" onClick={() => setResult(null)} aria-label="关闭">×</button>
            </header>
            <img src={result.image} width="320" height="320" alt="曲谱分享二维码" />
            <label className="qr-share-link">
              <span>短链接</span>
              <input value={result.shortUrl} readOnly onFocus={(event) => event.currentTarget.select()} />
            </label>
            <div className="qr-share-actions">
              <button className="button primary" onClick={() => void copyShortUrl()}>复制短链接</button>
              <button className="button secondary" onClick={() => setResult(null)}>关闭</button>
            </div>
          </section>
        </div>
      )}
    </>
  );
}
