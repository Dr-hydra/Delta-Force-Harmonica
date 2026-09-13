using DFH.Core.Export;
using DFH.Core.Harmonica;
using DFH.Core.Music;
using Xunit;

namespace DFH.Core.Tests;

/// <summary>
/// Frame-floor behaviour of the key sequence. The fixtures pin the exact output
/// against the web; these spell out the two guarantees the tiers rely on.
/// </summary>
public class KeyTimingTests
{
    private static GameNote Note(double start, double duration, string key = "Z", bool sharp = false) => new()
    {
        Note = new NoteEvent { Pitch = 60, Start = start, Duration = duration },
        Candidate = new HarmonicaCandidate(key, 1, 0, 0, 0, sharp, 60),
        SourceIndex = 0
    };

    [Fact]
    public void DefaultOptionsAreTheStandardTier()
    {
        var options = new KeySequenceOptions();
        Assert.Equal(TimingTiers.Standard.Timing, new KeyTiming(options.ModifierLeadMs, options.ReleaseGapMs, options.MinNoteMs));
    }

    [Fact]
    public void RepeatedKeyWaitsTheReleaseGapAfterThePreviousRelease()
    {
        var sequence = KeySequenceBuilder.Build([Note(0, 30), Note(30, 30)], KeySequenceOptions.From(TimingTiers.Standard.Timing));
        var keys = sequence.Actions.Where(action => action.Target.Kind == InputKind.Key).ToList();

        Assert.Equal(0, keys[0].Time);
        Assert.Equal(45, keys[1].Time);      // min hold
        Assert.Equal(85, keys[2].Time);      // 45 + release gap 40, not the score's 30
        Assert.Equal(130, keys[3].Time);
    }

    [Fact]
    public void ModifierChangeKeepsItsLeadInADensePassage()
    {
        var sequence = KeySequenceBuilder.Build([Note(0, 50), Note(50, 100, "X", sharp: true)], KeySequenceOptions.From(TimingTiers.Safe.Timing));
        var semitone = sequence.Actions.First(action => action.Target.Kind == InputKind.Mouse && action.Down);
        var x = sequence.Actions.First(action => action.Target.Name == "x" && action.Down);

        Assert.Equal(TimingTiers.Safe.Timing.ModifierLeadMs, x.Time - semitone.Time);
    }

    [Fact]
    public void PlainFirstNoteStartsAtZeroButAModifiedOneWaitsForTheLead()
    {
        var plain = KeySequenceBuilder.Build([Note(0, 500)]);
        Assert.Equal(0, plain.Actions.First(action => action.Target.Kind == InputKind.Key && action.Down).Time);

        var modified = KeySequenceBuilder.Build([Note(0, 500, sharp: true)]);
        Assert.Equal(0, modified.Actions.First(action => action.Target.Kind == InputKind.Mouse && action.Down).Time);
        Assert.Equal(TimingTiers.Default.Timing.ModifierLeadMs,
            modified.Actions.First(action => action.Target.Kind == InputKind.Key && action.Down).Time);
    }
}
