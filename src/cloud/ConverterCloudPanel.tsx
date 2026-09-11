import { useState } from "react";
import CloudActions from "./CloudActions";
import { readCurrentConverterScore, type CurrentConverterScore } from "../persistence/currentScore";
import "./converterCloud.css";

/**
 * The converter's floating CLOUD button. The panel stays mounted once it has
 * been opened so the metadata, archive id and public id survive closing it,
 * which is what the pre-refactor version did with its own state.
 */
export default function ConverterCloudPanel() {
  const [armed, setArmed] = useState(false);
  const [open, setOpen] = useState(false);
  const [current, setCurrent] = useState<CurrentConverterScore | null>(null);

  function show() {
    setCurrent(readCurrentConverterScore());
    setArmed(true);
    setOpen(true);
  }

  return (
    <>
      <button className="converter-cloud-trigger" onClick={show}>
        CLOUD
        <span>保存 / 发布</span>
      </button>

      {armed && (
        <div
          className="converter-cloud-backdrop"
          hidden={!open}
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setOpen(false);
          }}
        >
          <section className="converter-cloud-panel" role="dialog" aria-modal="true" aria-label="云端保存与发布">
            <div className="converter-cloud-head">
              <div>
                <span className="eyebrow">TOY / CLOUDBASE</span>
                <h2>保存与发布当前谱面</h2>
              </div>
              <button className="converter-cloud-close" onClick={() => setOpen(false)} aria-label="关闭">×</button>
            </div>

            {current ? (
              <CloudActions key={current.projectKey} title={current.title} snapshot={current.snapshot} />
            ) : (
              <p className="converter-cloud-status">当前没有可保存的谱面，请先导入、载入 Demo 或手工添加音符。</p>
            )}
          </section>
        </div>
      )}
    </>
  );
}
