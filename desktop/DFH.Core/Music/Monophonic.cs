namespace DFH.Core.Music;

public sealed class MonoResult
{
    public required IReadOnlyList<NoteEvent> Notes { get; init; }
    /// <summary>For every output note, its index in the input list.</summary>
    public required IReadOnlyList<int> SourceIndices { get; init; }
    public required int CollapsedChordNotes { get; init; }
    public required int TruncatedNotes { get; init; }
}

/// <summary>Port of src/music/monophonic.ts. Keep the two in lockstep.</summary>
public static class Monophonic
{
    /// <summary>Onsets closer than this are one chord rather than a melodic step.</summary>
    public const double ChordWindowMs = 45;

    private static NoteEvent Shorten(NoteEvent note, NoteEvent next)
    {
        var duration = Math.Max(1, next.Start - note.Start);
        double? durationBeats = note.DurationBeats;
        if (note.Beat.HasValue && next.Beat.HasValue)
        {
            durationBeats = Math.Max(1.0 / 96, next.Beat.Value - note.Beat.Value);
        }
        else if (note.DurationBeats.HasValue && note.Duration > 0)
        {
            durationBeats = Math.Max(1.0 / 96, note.DurationBeats.Value * (duration / note.Duration));
        }
        return note with { Duration = duration, DurationBeats = durationBeats };
    }

    /// <summary>
    /// Makes a note list playable on the in-game harmonica, which sounds exactly
    /// one note at a time: chords keep their highest note, a note still ringing
    /// at the next onset is cut there. A no-op for monophonic input.
    /// </summary>
    public static MonoResult EnforceMonophonic(IReadOnlyList<NoteEvent> notes)
    {
        // JS sort is stable; OrderBy/ThenBy are too, so ties keep input order.
        var indexed = notes
            .Select((note, sourceIndex) => (Note: note, SourceIndex: sourceIndex))
            .Where(item => double.IsFinite(item.Note.Start) && double.IsFinite(item.Note.Duration))
            .OrderBy(item => item.Note.Start)
            .ThenByDescending(item => item.Note.Pitch)
            .ToList();

        var picked = new List<(NoteEvent Note, int SourceIndex)>();
        var collapsedChordNotes = 0;

        for (var i = 0; i < indexed.Count;)
        {
            var groupStart = indexed[i].Note.Start;
            var best = indexed[i];
            var j = i + 1;
            while (j < indexed.Count && indexed[j].Note.Start - groupStart <= ChordWindowMs)
            {
                var candidate = indexed[j];
                var higher = candidate.Note.Pitch > best.Note.Pitch;
                var sameButLonger = candidate.Note.Pitch == best.Note.Pitch && candidate.Note.Duration > best.Note.Duration;
                if (higher || sameButLonger) best = candidate;
                j += 1;
            }

            collapsedChordNotes += j - i - 1;
            picked.Add((best.Note, best.SourceIndex));
            i = j;
        }

        var truncatedNotes = 0;
        for (var i = 0; i < picked.Count - 1; i += 1)
        {
            var current = picked[i].Note;
            var next = picked[i + 1].Note;
            if (current.Start + current.Duration > next.Start)
            {
                picked[i] = (Shorten(current, next), picked[i].SourceIndex);
                truncatedNotes += 1;
            }
        }

        return new MonoResult
        {
            Notes = picked.Select(entry => entry.Note).ToList(),
            SourceIndices = picked.Select(entry => entry.SourceIndex).ToList(),
            CollapsedChordNotes = collapsedChordNotes,
            TruncatedNotes = truncatedNotes
        };
    }
}
