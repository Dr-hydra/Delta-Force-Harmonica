using System.IO;
using DFH.Core.Export;
using DFH.Desktop.Services;
using DFH.Desktop.ViewModels;
using Xunit;

namespace DFH.Desktop.Tests;

public class AppSettingsTests
{
    [Theory]
    [InlineData("{}", 0x74, 0x75, 0x76)]
    [InlineData("{\"StartHotkey\":116,\"StopHotkey\":117}", 0x74, 0x75, 0x76)]
    [InlineData("{\"StartHotkey\":119,\"StopHotkey\":120}", 0x77, 0x75, 0x78)]
    [InlineData("{\"StartHotkey\":117,\"StopHotkey\":118}", 0x75, 0x70, 0x76)]
    [InlineData("{\"StartHotkey\":0,\"PauseHotkey\":116,\"OverlayHotkey\":116}", 0x74, 0x75, 0x76)]
    public void HotkeysMigrateAndRemainUnique(string json, int start, int pause, int overlay)
    {
        var path = Path.Combine(Path.GetTempPath(), $"dfh-settings-{Guid.NewGuid():N}.json");
        try
        {
            File.WriteAllText(path, json);
            var loaded = AppSettings.LoadFrom(path);
            Assert.Equal(start, loaded.StartHotkey);
            Assert.Equal(pause, loaded.PauseHotkey);
            Assert.Equal(overlay, loaded.OverlayHotkey);
            Assert.True(loaded.HasValidHotkeys);
            loaded.SaveTo(path);
            var restored = AppSettings.LoadFrom(path);
            Assert.Equal(start, restored.StartHotkey);
            Assert.Equal(pause, restored.PauseHotkey);
            Assert.Equal(overlay, restored.OverlayHotkey);
        }
        finally { File.Delete(path); }
    }

    [Fact]
    public void SettingsRejectDuplicateKeysAndApplyAllSixCustomKeysOnlyOnSave()
    {
        var current = new AppSettings();
        AppSettings? applied = null;
        AppSettings? saved = null;
        var viewModel = new SettingsViewModel(current, value => applied = value, value => saved = value.Clone());
        var keys = SettingsViewModel.HotkeyOptions;
        viewModel.PauseHotkey = viewModel.StartHotkey;
        viewModel.SaveCommand.Execute(null);
        Assert.Null(saved);
        viewModel.PauseHotkey = keys[5];
        viewModel.OverlayHotkey = viewModel.StartHotkey;
        viewModel.SaveCommand.Execute(null);
        Assert.Null(saved);
        viewModel.OverlayHotkey = viewModel.PauseHotkey;
        viewModel.SaveCommand.Execute(null);
        Assert.Null(applied);
        Assert.Contains("不能重复", viewModel.Status);
        viewModel.StartHotkey = keys[7];
        viewModel.PauseHotkey = keys[8];
        viewModel.OverlayHotkey = keys[9];
        viewModel.PreviousHotkey = keys[10];
        viewModel.NextHotkey = keys[11];
        viewModel.AdjustOverlayHotkey = keys[12];
        Assert.Equal(0x74, current.StartHotkey);
        viewModel.SaveCommand.Execute(null);
        Assert.NotNull(saved);
        Assert.NotNull(applied);
        Assert.Equal(0x77, applied.StartHotkey);
        Assert.Equal(0x78, applied.PauseHotkey);
        Assert.Equal(0x79, applied.OverlayHotkey);
        Assert.Equal(0x7a, applied.PreviousHotkey);
        Assert.Equal(0x7b, applied.NextHotkey);
        Assert.Equal(0x7c, applied.AdjustOverlayHotkey);
        viewModel.ResetCommand.Execute(null);
        Assert.Equal(0x77, applied.StartHotkey);
        viewModel.SaveCommand.Execute(null);
        Assert.Equal(0x74, applied.StartHotkey);
        Assert.Equal(0x75, applied.PauseHotkey);
        Assert.Equal(0x76, applied.OverlayHotkey);
        Assert.Equal(0x77, applied.PreviousHotkey);
        Assert.Equal(0x78, applied.NextHotkey);
        Assert.Equal(0x79, applied.AdjustOverlayHotkey);
    }

    [Fact]
    public void TrackHotkeysRejectConflictsAndPersistCustomValues()
    {
        var path = Path.Combine(Path.GetTempPath(), $"dfh-settings-{Guid.NewGuid():N}.json");
        try
        {
            var settings = new AppSettings { PreviousHotkey = 0x80, NextHotkey = 0x81 };
            settings.SaveTo(path);
            var loaded = AppSettings.LoadFrom(path);
            Assert.Equal(0x80, loaded.PreviousHotkey);
            Assert.Equal(0x81, loaded.NextHotkey);
            Assert.True(loaded.HasValidHotkeys);
            foreach (var key in new[] { loaded.StartHotkey, loaded.PauseHotkey, loaded.OverlayHotkey, loaded.PreviousHotkey })
            {
                loaded.NextHotkey = key;
                Assert.False(loaded.HasValidHotkeys);
            }
        }
        finally { File.Delete(path); }
    }

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
