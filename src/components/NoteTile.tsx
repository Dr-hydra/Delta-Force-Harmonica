import { displayOctave, midiName } from "../harmonica/mapping";
import type { GameNote } from "../music/types";

export function NoteTile({
  note,
  active = false,
  onSelect
}: {
  note: GameNote;
  active?: boolean;
  onSelect?: () => void;
}) {
  const octave = displayOctave(note);
  const dots = Math.abs(octave);

  function handleKeyDown(event: React.KeyboardEvent<HTMLElement>) {
    if (!onSelect || (event.key !== "Enter" && event.key !== " ")) return;
    event.preventDefault();
    onSelect();
  }

  return (
    <article
      className={`note-tile ${active ? "active" : ""}`}
      title={`${midiName(note.pitch)} · ${Math.round(note.start)} ms`}
      role={onSelect ? "button" : undefined}
      tabIndex={onSelect ? 0 : undefined}
      aria-current={active ? "true" : undefined}
      onClick={onSelect}
      onKeyDown={handleKeyDown}
    >
      <div className="jianpu-note" aria-label={`简谱 ${note.sharp ? "升" : ""}${note.degree}`}>
        {octave > 0 && <span className="octave-dots top">{"•".repeat(dots)}</span>}
        <span className="note-core">
          {note.sharp && <sup>#</sup>}
          <strong>{note.degree}</strong>
        </span>
        {octave < 0 && <span className="octave-dots bottom">{"•".repeat(dots)}</span>}
      </div>
      <kbd>{note.key}</kbd>
      <span className="note-meta">{midiName(note.pitch)}</span>
    </article>
  );
}
