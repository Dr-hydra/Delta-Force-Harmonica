import { displayOctave } from "../harmonica/mapping";
import { buildScoreMeasures, durationLabel } from "../score/measures";
import type { GameNote, TimeSignatureEvent } from "../music/types";

export interface TabOptions {
  songName: string;
  bpm: number;
  timeSignatures: TimeSignatureEvent[];
  measureStarts?: number[];
  transpose?: number;
  unplayableCount?: number;
}

/** `1` `2̇` `1̣` style degree with the octave dot and a sharp marker. */
function degreeLabel(note: GameNote): string {
  const octave = displayOctave(note);
  const marks = octave > 0 ? "'".repeat(octave) : octave < 0 ? ".".repeat(-octave) : "";
  return `${note.sharp ? "#" : ""}${note.degree}${marks}`;
}

/**
 * The key line shows only the modifiers actually held down, so it uses
 * octaveModifier rather than the displayed octave: `,` is intrinsically the
 * upper 1 and needs no octave key, even though it reads as `1'` in notation.
 */
function keyLabel(note: GameNote): string {
  const shift = note.octaveModifier > 0 ? "+" : note.octaveModifier < 0 ? "-" : "";
  return `${note.key}${shift}${note.sharp ? "#" : ""}`;
}

/**
 * Plain-text tab for the human-playable version: one block per measure with the
 * numbered-notation line, the key line and the rhythm line aligned in columns so
 * the three can be read together.
 */
export function toTabText(notes: GameNote[], options: TabOptions): string {
  const measures = buildScoreMeasures(notes, options.timeSignatures, options.bpm, options.measureStarts ?? []);
  const lines: string[] = [];

  lines.push(`${options.songName} — 三角洲口琴谱`);
  lines.push(
    [
      `BPM ${Math.round(options.bpm)}`,
      `${notes.length} 音符`,
      `${measures.length} 小节`,
      options.transpose ? `移调 ${options.transpose > 0 ? "+" : ""}${options.transpose}` : "移调 0"
    ].join(" · ")
  );
  if (options.unplayableCount) lines.push(`超出音域被略过：${options.unplayableCount} 个音符`);
  lines.push("");
  lines.push("键位标记：+ 升调（鼠标右键） / - 降调（鼠标左键） / # 半音（鼠标中键）");
  lines.push("");

  for (const measure of measures) {
    const columns = measure.notes.map((item) => {
      const degree = degreeLabel(item.note);
      const key = keyLabel(item.note);
      const rhythm = durationLabel(item.durationBeats);
      const width = Math.max(degree.length, key.length, rhythm.length);
      return {
        degree: degree.padEnd(width),
        key: key.padEnd(width),
        rhythm: rhythm.padEnd(width)
      };
    });

    const header = `小节 ${String(measure.number).padStart(3)} (${measure.numerator}/${measure.denominator})`;
    if (columns.length === 0) {
      lines.push(`${header}  —`);
      lines.push("");
      continue;
    }
    lines.push(header);
    lines.push(`  简谱  ${columns.map((column) => column.degree).join(" ")}`);
    lines.push(`  键位  ${columns.map((column) => column.key).join(" ")}`);
    lines.push(`  节奏  ${columns.map((column) => column.rhythm).join(" ")}`);
    lines.push("");
  }

  return lines.join("\n");
}
