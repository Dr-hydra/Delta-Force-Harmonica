using DFH.Core.Harmonica;
using DFH.Core.Music;

namespace DFH.Core.Score;

public sealed record ScoreMeasureNote(GameNote Note, int Index, double Beat, double DurationBeats, double OffsetBeats);

public sealed record ScoreMeasure(
    int Number,
    double StartBeat,
    double EndBeat,
    double LengthBeats,
    int Numerator,
    int Denominator,
    IReadOnlyList<ScoreMeasureNote> Notes);

/// <summary>Port of buildScoreMeasures in src/score/measures.ts, used by the score viewer.</summary>
public static class Measures
{
    private const double Epsilon = 1e-6;

    private static double NoteBeat(GameNote note, double bpm) => note.Beat ?? note.Start * bpm / 60000;

    private static double NoteDurationBeats(GameNote note, double bpm) =>
        note.DurationBeats ?? Math.Max(1.0 / 96, note.Duration * bpm / 60000);

    private static List<TimeSignatureEvent> NormalizeSignatures(IReadOnlyList<TimeSignatureEvent> events)
    {
        var sorted = events.Where(e => e.Numerator > 0 && e.Denominator > 0).OrderBy(e => e.Beat).ToList();
        if (sorted.Count == 0 || sorted[0].Beat > Epsilon) sorted.Insert(0, new TimeSignatureEvent(0, 4, 4));
        return sorted;
    }

    private static TimeSignatureEvent SignatureAt(double beat, List<TimeSignatureEvent> signatures)
    {
        var current = signatures[0];
        for (var index = 1; index < signatures.Count; index += 1)
        {
            if (signatures[index].Beat > beat + Epsilon) break;
            current = signatures[index];
        }
        return current;
    }

    private static TimeSignatureEvent? NextSignatureAfter(double beat, List<TimeSignatureEvent> signatures) =>
        signatures.FirstOrDefault(e => e.Beat > beat + Epsilon);

    private static List<double> NormalizedStarts(IReadOnlyList<double> starts, double maxBeat)
    {
        var result = starts
            .Where(beat => double.IsFinite(beat) && beat >= 0 && beat <= maxBeat + Epsilon)
            .OrderBy(beat => beat)
            .ToList();
        var deduped = new List<double>();
        for (var index = 0; index < result.Count; index += 1)
        {
            if (index == 0 || Math.Abs(result[index] - result[index - 1]) > Epsilon) deduped.Add(result[index]);
        }
        if (deduped.Count > 0 && deduped[0] > Epsilon) deduped.Insert(0, 0);
        return deduped;
    }

    private static List<double> DeriveStarts(double maxBeat, List<TimeSignatureEvent> signatures)
    {
        var starts = new List<double> { 0 };
        double cursor = 0;
        var guard = 0;
        while (cursor < maxBeat - Epsilon && guard < 10000)
        {
            guard += 1;
            var signature = SignatureAt(cursor, signatures);
            var nominalLength = signature.Numerator * 4.0 / signature.Denominator;
            var nextSignature = NextSignatureAfter(cursor, signatures);
            var next = cursor + nominalLength;
            if (nextSignature != null && nextSignature.Beat < next - Epsilon) next = nextSignature.Beat;
            if (next <= cursor + Epsilon) next = cursor + Math.Max(1.0 / 16, nominalLength);
            cursor = next;
            if (cursor < maxBeat - Epsilon) starts.Add(cursor);
        }
        return starts;
    }

    public static IReadOnlyList<ScoreMeasure> Build(
        IReadOnlyList<GameNote> notes,
        IReadOnlyList<TimeSignatureEvent> timeSignatures,
        double bpm,
        IReadOnlyList<double>? explicitMeasureStarts = null)
    {
        if (notes.Count == 0) return [];
        var safeBpm = bpm > 0 ? bpm : 120;
        var signatures = NormalizeSignatures(timeSignatures);
        var noteData = notes
            .Select((note, index) => (Note: note, Index: index, Beat: NoteBeat(note, safeBpm), DurationBeats: NoteDurationBeats(note, safeBpm)))
            .ToList();
        var maxBeat = noteData.Max(item => item.Beat + item.DurationBeats);

        var starts = NormalizedStarts(explicitMeasureStarts ?? [], maxBeat);
        if (starts.Count == 0)
        {
            starts = DeriveStarts(maxBeat, signatures);
        }
        else
        {
            var cursor = starts[^1];
            var guard = 0;
            while (cursor < maxBeat - Epsilon && guard < 10000)
            {
                guard += 1;
                var signature = SignatureAt(cursor, signatures);
                var nominalLength = signature.Numerator * 4.0 / signature.Denominator;
                var next = cursor + nominalLength;
                if (next >= maxBeat - Epsilon) break;
                cursor = next;
                starts.Add(cursor);
            }
        }

        var measures = new List<ScoreMeasure>(starts.Count);
        for (var measureIndex = 0; measureIndex < starts.Count; measureIndex += 1)
        {
            var startBeat = starts[measureIndex];
            var signature = SignatureAt(startBeat, signatures);
            var nominalLength = signature.Numerator * 4.0 / signature.Denominator;
            var endBeat = measureIndex + 1 < starts.Count ? starts[measureIndex + 1] : Math.Max(startBeat + nominalLength, maxBeat);
            var lengthBeats = Math.Max(1.0 / 16, endBeat - startBeat);
            var measureNotes = noteData
                .Where(item => item.Beat >= startBeat - Epsilon && item.Beat < endBeat - Epsilon)
                .Select(item => new ScoreMeasureNote(item.Note, item.Index, item.Beat, item.DurationBeats, Math.Max(0, item.Beat - startBeat)))
                .ToList();
            measures.Add(new ScoreMeasure(measureIndex + 1, startBeat, endBeat, lengthBeats, signature.Numerator, signature.Denominator, measureNotes));
        }
        return measures;
    }

    public static string DurationLabel(double beats)
    {
        var value = Math.Max(0, beats);
        (double Beats, string Label)[] candidates =
        [
            (4, "1"), (3, "2·"), (2, "2"), (1.5, "4·"), (1, "4"),
            (0.75, "8·"), (0.5, "8"), (0.375, "16·"), (0.25, "16"), (0.125, "32")
        ];
        foreach (var (candidate, label) in candidates)
        {
            if (Math.Abs(candidate - value) < 0.04) return label;
        }
        return $"{Math.Round(value * 100) / 100}b";
    }
}
