import { useMemo } from "react";
import CloudActions from "../cloud/CloudActions";
import EditPanel from "../components/EditPanel";
import ExportPanel from "../components/ExportPanel";
import { ScoreWorkspace } from "../components/ScoreWorkspace";
import { optimizeHarmonica } from "../harmonica/optimizer";
import { enforceMonophonic } from "../music/monophonic";
import type { ScoreSnapshot } from "../persistence/scoreCodec";
import { useScoreEdits } from "../score/useScoreEdits";

/**
 * The converter's preview, 04 / EDIT and 05 / EXPORT panels plus the Toy
 * save/publish actions, applied to a stored score. The library reuses the very
 * same components instead of growing a second, library-only toolset.
 */
export default function ScoreWorkbench({ title, snapshot, archiveId, publicId, onSaved }: {
  title: string;
  snapshot: ScoreSnapshot;
  /** Set when the score came from the private cloud archive, so saving updates it. */
  archiveId?: string;
  /** Set when the current Toy identity already published this score. */
  publicId?: string;
  onSaved?: () => void;
}) {
  const bpm = snapshot.tempos[0]?.bpm ?? 120;
  const edits = useScoreEdits(snapshot.notes, bpm);

  // Same two-stage pipeline the converter uses: hand-made overlaps are collapsed
  // before the fingering runs, so score, preview, macro and cloud stay in sync.
  const mono = useMemo(() => enforceMonophonic(edits.notes), [edits.notes]);
  const conversion = useMemo(
    () => optimizeHarmonica(mono.notes, snapshot.transpose),
    [mono.notes, snapshot.transpose]
  );

  // A game note carries its index in the collapsed list; the editor indexes the
  // list before that pass, so the two have to be composed.
  const editIndexOf = (index: number) => {
    const sourceIndex = conversion.notes[index]?.sourceIndex;
    if (sourceIndex === undefined) return null;
    return mono.sourceIndices[sourceIndex] ?? null;
  };

  return (
    <>
      <ScoreWorkspace
        notes={conversion.notes}
        unplayableCount={conversion.unplayable.length}
        timeSignatures={snapshot.timeSignatures}
        measureStarts={snapshot.measureStarts}
        bpm={bpm}
        selectedIndex={conversion.notes.findIndex((_, index) => editIndexOf(index) === edits.selectedNote)}
        onNoteSelect={(index) => edits.setSelectedNote(editIndexOf(index))}
      />

      <EditPanel
        notes={edits.notes}
        editing={edits.editing}
        selectedNote={edits.selectedNote}
        canUndo={edits.canUndo}
        canRedo={edits.canRedo}
        editStep={edits.editStep}
        resetHint="编辑只影响当前页面：导出、保存和发布都使用编辑后的谱面，「放弃编辑」会回到这份存档里的原谱。"
        onEditStepChange={edits.setEditStep}
        onApply={edits.applyEdit}
        onUndo={edits.undo}
        onRedo={edits.redo}
        onReset={edits.reset}
        onStartBlank={edits.startBlank}
      />

      <ExportPanel
        title={title}
        notes={conversion.notes}
        unplayableCount={conversion.unplayable.length}
        bpm={bpm}
        timeSignatures={snapshot.timeSignatures}
        measureStarts={snapshot.measureStarts}
        transpose={snapshot.transpose}
      />

      <CloudActions
        key={title}
        title={title}
        snapshot={{ ...snapshot, notes: mono.notes }}
        archiveId={archiveId}
        publicId={publicId}
        heading={{ eyebrow: "TOY / CLOUDBASE", title: "保存与发布" }}
        onSaved={onSaved}
      />
    </>
  );
}
