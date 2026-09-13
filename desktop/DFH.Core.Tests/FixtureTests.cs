using System.Text.Json;
using DFH.Core.Export;
using DFH.Core.Harmonica;
using DFH.Core.Midi;
using DFH.Core.Music;
using DFH.Core.Persistence;
using Xunit;

namespace DFH.Core.Tests;

/// <summary>
/// Golden fixtures written by <c>npm run fixtures:desktop</c> in the web repo.
/// Every stage of the port must reproduce the TypeScript output bit for bit
/// (costs within floating-point noise), otherwise the desktop player would
/// press different keys than the web preview shows.
/// </summary>
public class FixtureTests
{
    private static readonly JsonSerializerOptions JsonOptions = new() { PropertyNameCaseInsensitive = true };

    public sealed record FixtureNote(int Pitch, double Start, double Duration, double? Beat, double? DurationBeats);
    public sealed record FixtureTempo(double Beat, double Bpm, double Time);
    public sealed record FixtureSignature(double Beat, int Numerator, int Denominator);
    public sealed record FixtureDecoded(int Ppq, int Transpose, List<FixtureTempo> Tempos, List<FixtureSignature> TimeSignatures, List<double> MeasureStarts, List<FixtureNote> Notes);
    public sealed record FixtureMono(List<FixtureNote> Notes, List<int> SourceIndices, int CollapsedChordNotes, int TruncatedNotes);
    public sealed record FixtureGameNote(int Pitch, double Start, double Duration, string Key, int Degree, int OctaveModifier, bool Sharp, int SourceIndex);
    public sealed record FixtureConversion(List<FixtureGameNote> Notes, int UnplayableCount, double Cost, int ModifierChanges);
    public sealed record FixtureAction(double Time, string Target, bool Down);
    public sealed record FixtureSequence(List<FixtureAction> Actions, double DurationMs, int NoteCount, int DroppedChordNotes, int TruncatedNotes, int ModifierPresses);
    public sealed record Fixture(string Name, string SnapshotBase64Url, string MidiBase64, FixtureDecoded Decoded, FixtureMono Mono, FixtureConversion Conversion, int BestTranspose, FixtureSequence KeySequence);

    public static IEnumerable<object[]> FixtureNames() =>
        Directory.GetFiles(Path.Combine(AppContext.BaseDirectory, "Fixtures"), "*.json")
            .OrderBy(path => path)
            .Select(path => new object[] { Path.GetFileNameWithoutExtension(path) });

    private static Fixture Load(string name)
    {
        var json = File.ReadAllText(Path.Combine(AppContext.BaseDirectory, "Fixtures", name + ".json"));
        return JsonSerializer.Deserialize<Fixture>(json, JsonOptions) ?? throw new InvalidOperationException($"fixture {name} is empty");
    }

    private static void AssertNotes(IReadOnlyList<FixtureNote> expected, IReadOnlyList<NoteEvent> actual, string stage)
    {
        Assert.True(expected.Count == actual.Count, $"{stage}: expected {expected.Count} notes, got {actual.Count}");
        for (var i = 0; i < expected.Count; i++)
        {
            Assert.True(expected[i].Pitch == actual[i].Pitch, $"{stage}[{i}].pitch {expected[i].Pitch} != {actual[i].Pitch}");
            Assert.True(expected[i].Start == actual[i].Start, $"{stage}[{i}].start {expected[i].Start} != {actual[i].Start}");
            Assert.True(expected[i].Duration == actual[i].Duration, $"{stage}[{i}].duration {expected[i].Duration} != {actual[i].Duration}");
            Assert.True(expected[i].Beat == actual[i].Beat, $"{stage}[{i}].beat {expected[i].Beat} != {actual[i].Beat}");
            Assert.True(expected[i].DurationBeats == actual[i].DurationBeats, $"{stage}[{i}].durationBeats {expected[i].DurationBeats} != {actual[i].DurationBeats}");
        }
    }

    [Theory]
    [MemberData(nameof(FixtureNames))]
    public void Decodes_snapshot_exactly(string name)
    {
        var fixture = Load(name);
        var snapshot = ScoreCodec.DecodeBase64Url(fixture.SnapshotBase64Url);

        Assert.Equal(fixture.Decoded.Ppq, snapshot.Ppq);
        Assert.Equal(fixture.Decoded.Transpose, snapshot.Transpose);
        Assert.Equal(fixture.Decoded.Tempos.Select(t => (t.Beat, t.Bpm, t.Time)), snapshot.Tempos.Select(t => (t.Beat, t.Bpm, t.Time)));
        Assert.Equal(fixture.Decoded.TimeSignatures.Select(s => (s.Beat, s.Numerator, s.Denominator)), snapshot.TimeSignatures.Select(s => (s.Beat, s.Numerator, s.Denominator)));
        Assert.Equal(fixture.Decoded.MeasureStarts, snapshot.MeasureStarts);
        AssertNotes(fixture.Decoded.Notes, snapshot.Notes, "decoded");
    }

    [Theory]
    [MemberData(nameof(FixtureNames))]
    public void Collapses_to_one_voice_like_the_web(string name)
    {
        var fixture = Load(name);
        var snapshot = ScoreCodec.DecodeBase64Url(fixture.SnapshotBase64Url);
        var mono = Monophonic.EnforceMonophonic(snapshot.Notes);

        AssertNotes(fixture.Mono.Notes, mono.Notes, "mono");
        Assert.Equal(fixture.Mono.SourceIndices, mono.SourceIndices);
        Assert.Equal(fixture.Mono.CollapsedChordNotes, mono.CollapsedChordNotes);
        Assert.Equal(fixture.Mono.TruncatedNotes, mono.TruncatedNotes);
    }

    [Theory]
    [MemberData(nameof(FixtureNames))]
    public void Chooses_the_same_fingering(string name)
    {
        var fixture = Load(name);
        var snapshot = ScoreCodec.DecodeBase64Url(fixture.SnapshotBase64Url);
        var mono = Monophonic.EnforceMonophonic(snapshot.Notes);
        var conversion = Optimizer.OptimizeHarmonica(mono.Notes, snapshot.Transpose);

        Assert.Equal(fixture.Conversion.Notes.Count, conversion.Notes.Count);
        for (var i = 0; i < conversion.Notes.Count; i++)
        {
            var expected = fixture.Conversion.Notes[i];
            var actual = conversion.Notes[i];
            var where = $"{name} note {i}";
            Assert.True(expected.Pitch == actual.Pitch, $"{where} pitch {expected.Pitch} != {actual.Pitch}");
            Assert.True(expected.Start == actual.Start, $"{where} start");
            Assert.True(expected.Duration == actual.Duration, $"{where} duration");
            Assert.True(expected.Key == actual.Key, $"{where} key {expected.Key} != {actual.Key}");
            Assert.True(expected.Degree == actual.Degree, $"{where} degree");
            Assert.True(expected.OctaveModifier == actual.OctaveModifier, $"{where} octave {expected.OctaveModifier} != {actual.OctaveModifier}");
            Assert.True(expected.Sharp == actual.Sharp, $"{where} sharp");
            Assert.True(expected.SourceIndex == actual.SourceIndex, $"{where} sourceIndex");
        }
        Assert.Equal(fixture.Conversion.UnplayableCount, conversion.Unplayable.Count);
        Assert.Equal(fixture.Conversion.Cost, conversion.Cost, 9);
        Assert.Equal(fixture.Conversion.ModifierChanges, conversion.ModifierChanges);
    }

    [Theory]
    [MemberData(nameof(FixtureNames))]
    public void Finds_the_same_best_transpose(string name)
    {
        var fixture = Load(name);
        var snapshot = ScoreCodec.DecodeBase64Url(fixture.SnapshotBase64Url);
        var mono = Monophonic.EnforceMonophonic(snapshot.Notes);

        Assert.Equal(fixture.BestTranspose, Optimizer.FindBestTranspose(mono.Notes).Transpose);
    }

    [Theory]
    [MemberData(nameof(FixtureNames))]
    public void Emits_the_same_key_sequence(string name)
    {
        var fixture = Load(name);
        var snapshot = ScoreCodec.DecodeBase64Url(fixture.SnapshotBase64Url);
        var mono = Monophonic.EnforceMonophonic(snapshot.Notes);
        var conversion = Optimizer.OptimizeHarmonica(mono.Notes, snapshot.Transpose);
        var sequence = KeySequenceBuilder.Build(conversion.Notes);

        Assert.Equal(fixture.KeySequence.Actions.Count, sequence.Actions.Count);
        for (var i = 0; i < sequence.Actions.Count; i++)
        {
            var expected = fixture.KeySequence.Actions[i];
            var actual = sequence.Actions[i];
            Assert.True(expected.Time == actual.Time, $"{name} action {i} time {expected.Time} != {actual.Time}");
            Assert.True(expected.Target == actual.Target.Id, $"{name} action {i} target {expected.Target} != {actual.Target.Id}");
            Assert.True(expected.Down == actual.Down, $"{name} action {i} down");
        }
        Assert.Equal(fixture.KeySequence.DurationMs, sequence.DurationMs);
        Assert.Equal(fixture.KeySequence.NoteCount, sequence.NoteCount);
        Assert.Equal(fixture.KeySequence.DroppedChordNotes, sequence.DroppedChordNotes);
        Assert.Equal(fixture.KeySequence.TruncatedNotes, sequence.TruncatedNotes);
        Assert.Equal(fixture.KeySequence.ModifierPresses, sequence.ModifierPresses);
    }

    [Theory]
    [MemberData(nameof(FixtureNames))]
    public void Note_actions_point_back_at_their_game_note(string name)
    {
        var fixture = Load(name);
        var document = ScoreDocument.Build(name, "fixture", ScoreCodec.DecodeBase64Url(fixture.SnapshotBase64Url));

        foreach (var action in document.Sequence.Actions)
        {
            if (action.Target.Kind == InputKind.Mouse)
            {
                Assert.Equal(-1, action.NoteIndex);
                continue;
            }
            Assert.InRange(action.NoteIndex, 0, document.Notes.Count - 1);
            Assert.Equal(InputBinding.Game.Notes[document.Notes[action.NoteIndex].Key], action.Target);
        }
    }

    [Theory]
    [MemberData(nameof(FixtureNames))]
    public void Reads_the_snapshot_back_out_of_the_exported_midi(string name)
    {
        var fixture = Load(name);
        using var stream = new MemoryStream(Convert.FromBase64String(fixture.MidiBase64));
        var score = DfhMidiReader.Read(stream, name);

        Assert.False(score.Legacy);
        Assert.Equal(fixture.Decoded.Transpose, score.Snapshot.Transpose);
        Assert.Equal(fixture.Decoded.MeasureStarts, score.Snapshot.MeasureStarts);
        AssertNotes(fixture.Decoded.Notes, score.Snapshot.Notes, "midi snapshot");
    }

    [Fact]
    public void Measures_cover_every_note_once()
    {
        var fixture = Load("tempo-map");
        var document = ScoreDocument.Build("tempo-map", "fixture", ScoreCodec.DecodeBase64Url(fixture.SnapshotBase64Url));

        var indices = document.Measures.SelectMany(measure => measure.Notes.Select(note => note.Index)).ToList();
        Assert.Equal(Enumerable.Range(0, document.Notes.Count), indices);
        Assert.Equal(3, document.Measures[0].Numerator);
        Assert.Contains(document.Measures, measure => measure.Numerator == 6 && measure.Denominator == 8);
    }
}
