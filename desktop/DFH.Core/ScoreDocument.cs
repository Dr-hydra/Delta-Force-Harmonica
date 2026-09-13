using DFH.Core.Export;
using DFH.Core.Harmonica;
using DFH.Core.Music;
using DFH.Core.Persistence;
using DFH.Core.Score;

namespace DFH.Core;

/// <summary>
/// A score ready to display and play: the same two-stage pipeline the web runs
/// (collapse to one voice, then fingering) followed by the key sequence the
/// player executes. Built once per opened score; rebuilt when timing options change.
/// </summary>
public sealed class ScoreDocument
{
    public required string Title { get; init; }
    /// <summary>Where the score came from, for the UI: a file path or a library id.</summary>
    public required string Source { get; init; }
    public required ScoreSnapshot Snapshot { get; init; }
    public required MonoResult Mono { get; init; }
    public required ConversionResult Conversion { get; init; }
    public required KeySequence Sequence { get; init; }
    public required IReadOnlyList<ScoreMeasure> Measures { get; init; }
    public bool Legacy { get; init; }

    public IReadOnlyList<GameNote> Notes => Conversion.Notes;
    public double Bpm => Snapshot.Bpm;
    public double DurationMs => Sequence.DurationMs;

    public static ScoreDocument Build(string title, string source, ScoreSnapshot snapshot, KeySequenceOptions? options = null, bool legacy = false)
    {
        var mono = Monophonic.EnforceMonophonic(snapshot.Notes);
        var conversion = Optimizer.OptimizeHarmonica(mono.Notes, snapshot.Transpose);
        var sequence = KeySequenceBuilder.Build(conversion.Notes, options);
        var measures = Score.Measures.Build(conversion.Notes, snapshot.TimeSignatures, snapshot.Bpm, snapshot.MeasureStarts);
        return new ScoreDocument
        {
            Title = title,
            Source = source,
            Snapshot = snapshot,
            Mono = mono,
            Conversion = conversion,
            Sequence = sequence,
            Measures = measures,
            Legacy = legacy
        };
    }

    public ScoreDocument WithOptions(KeySequenceOptions options) => Build(Title, Source, Snapshot, options, Legacy);
}
