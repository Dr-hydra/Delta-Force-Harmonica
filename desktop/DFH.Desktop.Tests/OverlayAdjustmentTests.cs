using System.IO;
using DFH.Desktop.Services;
using DFH.Desktop.ViewModels;
using Xunit;

namespace DFH.Desktop.Tests;

public class OverlayAdjustmentTests
{
    private static readonly OverlayAdjustmentKeys Keys = new();

    [Fact]
    public void ToggleConsumesBothEdgesAndIgnoresAutoRepeat()
    {
        var input = new OverlayAdjustmentInput();
        Assert.Equal(new OverlayKeyResult(true, true), input.Process(0x79, true, false, true, Keys));
        Assert.Equal(new OverlayKeyResult(true), input.Process(0x79, true, true, true, Keys));
        Assert.True(input.Process(0x79, false, true, true, Keys).Suppress);
        Assert.True(input.Process(0x79, true, true, true, Keys).Toggle);
        Assert.True(input.Process(0x79, false, false, true, Keys).Suppress);
        Assert.False(input.Process(0x25, true, false, true, Keys).Suppress);
    }

    [Fact]
    public void HeldDirectionsRepeatAndBothModifiersCombineForFineResize()
    {
        var input = new OverlayAdjustmentInput();
        Assert.True(input.Process(0xA1, true, true, true, Keys).Suppress); // Right Shift
        Assert.True(input.Process(0xA2, true, true, true, Keys).Suppress); // Left Ctrl
        var expected = new OverlayAdjustment(OverlayDirection.Right, true, true);
        Assert.Equal(expected, input.Process(0x27, true, true, true, Keys).Adjustment);
        Assert.Equal(expected, input.Process(0x27, true, true, true, Keys).Adjustment);
        Assert.True(input.Process(0x27, false, false, false, Keys).Suppress);
        Assert.True(input.Process(0xA1, false, false, false, Keys).Suppress);
        Assert.True(input.Process(0xA2, false, false, false, Keys).Suppress);
        Assert.False(input.Process(0x41, true, true, true, Keys).Suppress);
    }

    [Fact]
    public void PreExistingGamePressesKeepTheirReleaseAndSettingsEditingPassesThrough()
    {
        var input = new OverlayAdjustmentInput();
        Assert.False(input.Process(0x25, true, false, true, Keys).Suppress);
        Assert.False(input.Process(0x25, true, true, true, Keys).Suppress);
        Assert.False(input.Process(0x25, false, true, true, Keys).Suppress);
        Assert.True(input.Process(0x25, true, true, true, Keys).Suppress);
        Assert.True(input.Process(0x25, false, false, true, Keys).Suppress);
        Assert.False(input.Process(0x79, true, false, false, Keys).Toggle);
        Assert.False(input.Process(0x79, false, false, true, Keys).Suppress);
        Assert.False(input.Process(0x10, true, true, false, Keys).Suppress);
    }

    [Fact]
    public void ChangingBindingsDuringAHoldStillConsumesTheOriginalRelease()
    {
        var input = new OverlayAdjustmentInput();
        Assert.True(input.Process(0x25, true, true, true, Keys).Suppress);
        var custom = Keys with { Left = 0x41, FineModifier = 0x11, ResizeModifier = 0x10 };
        Assert.True(input.Process(0x25, false, true, true, custom).Suppress);
        Assert.False(input.Process(0x25, true, true, true, custom).Suppress);
        Assert.True(input.Process(0xA3, true, true, true, custom).Suppress);
        Assert.Equal(new OverlayAdjustment(OverlayDirection.Left, false, true),
            input.Process(0x41, true, true, true, custom).Adjustment);
    }

    [Theory]
    [InlineData(OverlayDirection.Left, false, false, 90, 100, 640, 460)]
    [InlineData(OverlayDirection.Up, false, true, 100, 99, 640, 460)]
    [InlineData(OverlayDirection.Right, true, false, 100, 100, 650, 460)]
    [InlineData(OverlayDirection.Down, true, true, 100, 100, 640, 461)]
    public void AdjustsPhysicalPositionAndSize(OverlayDirection direction, bool resize, bool fine, int x, int y, int w, int h)
    {
        Assert.Equal(new OverlayBounds(x, y, w, h), new OverlayBounds(100, 100, 640, 460)
            .Adjust(new(direction, resize, fine), new(0, 0, 1920, 1080), 440, 260));
    }

    [Fact]
    public void ClampsSizeAndDesktopEdgesIncludingNegativeMonitorCoordinates()
    {
        var desktop = new OverlayBounds(-1920, 0, 3840, 1080);
        var small = new OverlayBounds(-1920, 0, 440, 260);
        Assert.Equal(small, small.Adjust(new(OverlayDirection.Left, false, false), desktop, 440, 260));
        Assert.Equal(small, small.Adjust(new(OverlayDirection.Up, true, false), desktop, 440, 260));
        var edge = new OverlayBounds(1480, 820, 440, 260);
        Assert.Equal(edge, edge.Adjust(new(OverlayDirection.Down, false, false), desktop, 440, 260));
        Assert.Equal(new OverlayBounds(1470, 820, 450, 260), edge.Adjust(new(OverlayDirection.Right, true, false), desktop, 440, 260));
        // A 150% screen has a 660 physical-pixel minimum width.
        Assert.Equal(660, new OverlayBounds(0, 0, 660, 390)
            .Adjust(new(OverlayDirection.Left, true, false), desktop, 660, 390).Width);
    }

    [Fact]
    public void CustomAdjustmentKeysPersistAndConflictsAreRejected()
    {
        var path = Path.Combine(Path.GetTempPath(), $"dfh-adjustment-{Guid.NewGuid():N}.json");
        try
        {
            var settings = new AppSettings { OverlayLeftKey = 0x41, OverlayUpKey = 0x57,
                OverlayRightKey = 0x44, OverlayDownKey = 0x53, OverlayFineModifier = 0x11, OverlayResizeModifier = 0x10 };
            settings.SaveTo(path);
            var restored = AppSettings.LoadFrom(path);
            Assert.Equal(OverlayAdjustmentKeys.From(settings), OverlayAdjustmentKeys.From(restored));
            var saved = false;
            var vm = new SettingsViewModel(restored, _ => { }, _ => saved = true);
            vm.AdjustOverlayHotkey = vm.StartHotkey;
            vm.SaveCommand.Execute(null);
            Assert.False(saved);
            vm.AdjustOverlayHotkey = SettingsViewModel.HotkeyOptions[9];
            vm.OverlayRightKey = vm.OverlayLeftKey;
            vm.SaveCommand.Execute(null);
            Assert.False(saved);
            vm.ResetCommand.Execute(null);
            vm.OverlayFineModifier = vm.OverlayResizeModifier;
            vm.SaveCommand.Execute(null);
            Assert.False(saved);
            vm.ResetCommand.Execute(null);
            vm.SaveCommand.Execute(null);
            Assert.True(saved);
            Assert.Equal(0x25, vm.OverlayLeftKey.VirtualKey);
        }
        finally { File.Delete(path); }
    }

    [Fact]
    public void OlderSettingsPreserveAnExistingF10BindingAndAssignAnUnusedAdjustmentKey()
    {
        var path = Path.Combine(Path.GetTempPath(), $"dfh-adjustment-{Guid.NewGuid():N}.json");
        try
        {
            File.WriteAllText(path, """{"StartHotkey":121,"OverlayLeftKey":0,"OverlayResizeModifier":16}""");
            var settings = AppSettings.LoadFrom(path);
            Assert.Equal(0x79, settings.StartHotkey);
            Assert.NotEqual(settings.StartHotkey, settings.AdjustOverlayHotkey);
            Assert.True(settings.HasValidHotkeys);
            Assert.Equal(0x25, settings.OverlayLeftKey);
            Assert.Equal(0x11, settings.OverlayResizeModifier);
        }
        finally { File.Delete(path); }
    }
}
