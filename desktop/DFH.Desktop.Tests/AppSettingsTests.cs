using System.IO;
using DFH.Core.Export;
using DFH.Desktop.Services;
using Xunit;

namespace DFH.Desktop.Tests;

public class AppSettingsTests
{
    [Fact]
    public void DefaultsToTheStandardTier()
    {
        var options = new AppSettings().ToKeySequenceOptions();

        Assert.Equal(TimingTiers.Standard.Timing.ModifierLeadMs, options.ModifierLeadMs);
        Assert.Equal(TimingTiers.Standard.Timing.ReleaseGapMs, options.ReleaseGapMs);
        Assert.Equal(TimingTiers.Standard.Timing.MinNoteMs, options.MinNoteMs);
    }

    [Fact]
    public void TierWinsOverStaleCustomFields()
    {
        var settings = new AppSettings { TimingTier = "safe", ModifierLeadMs = 1, ReleaseGapMs = 2, MinNoteMs = 3 };

        Assert.Equal(TimingTiers.Safe.Timing, settings.EffectiveTiming());
    }

    [Fact]
    public void CustomUsesAndClampsTheFields()
    {
        var settings = new AppSettings { TimingTier = AppSettings.CustomTimingTier, ModifierLeadMs = 33, ReleaseGapMs = -5, MinNoteMs = 5000 };

        Assert.Equal(new KeyTiming(33, 0, 1000), settings.EffectiveTiming());
    }

    [Fact]
    public void UnknownTierFallsBackToDefault()
    {
        Assert.Equal(TimingTiers.Default.Timing, new AppSettings { TimingTier = "turbo" }.EffectiveTiming());
    }

    [Fact]
    public void OldSettingsFileWithoutTierLoadsAsStandard()
    {
        var path = Path.Combine(Path.GetTempPath(), $"dfh-settings-{Guid.NewGuid():N}.json");
        try
        {
            // A v0.1.0 file: the three fields only, at the old 12/18/30 defaults.
            File.WriteAllText(path, """{"CountdownSeconds":5,"ModifierLeadMs":12,"ReleaseGapMs":18,"MinNoteMs":30}""");

            var loaded = AppSettings.LoadFrom(path);

            Assert.Equal(5, loaded.CountdownSeconds);
            Assert.Equal(TimingTiers.Standard.Id, loaded.TimingTier);
            Assert.Equal(TimingTiers.Standard.Timing, loaded.EffectiveTiming());
        }
        finally
        {
            File.Delete(path);
        }
    }
}
