using System.Runtime.ExceptionServices;
using System.Text.Json;
using System.Windows;
using System.Windows.Media;
using System.Windows.Media.Imaging;
using DFH.Core.Harmonica;
using DFH.Core.Music;
using DFH.Desktop.Services;
using DFH.Desktop.Views;
using Xunit;

namespace DFH.Desktop.Tests;

public class OverlayAppearanceTests
{
    [Fact]
    public void OlderPreferencesKeepDefaultsAndNewPreferencesRoundTrip()
    {
        var old = JsonSerializer.Deserialize<OverlaySettings>("{\"Width\":720}")!;
        Assert.Equal(25, old.BackgroundTransparency);
        Assert.Equal(1, old.FlowSpeed);
        old.BackgroundTransparency = 100;
        old.FlowSpeed = 2.5;
        var restored = JsonSerializer.Deserialize<OverlaySettings>(JsonSerializer.Serialize(old))!;
        Assert.Equal(100, restored.BackgroundTransparency);
        Assert.Equal(2.5, restored.FlowSpeed);
        Assert.Equal(720, restored.Width);
    }

    [Fact]
    public void FlowSpeedChangesTravelDistanceButKeepsArrivalAtTheSameTime() => OnSta(() =>
    {
        var normal = Render(1, 0, 0);
        var fast = Render(2, 0, 0);
        Assert.True(Alpha(normal, 190) > 0);
        Assert.Equal(0, Alpha(fast, 190));
        Assert.True(Alpha(fast, 90) > 0);
        Assert.True(Alpha(Render(1, 0, 1000), 290) > 0);
        Assert.True(Alpha(Render(2, 0, 1000), 290) > 0);
    });

    [Fact]
    public void FullyTransparentBackgroundKeepsNotesVisible() => OnSta(() =>
    {
        var clear = Render(1, 0, 0);
        var opaque = Render(1, 1, 0);
        Assert.Equal(0, Alpha(clear, 10));
        Assert.True(Alpha(opaque, 10) > 0);
        Assert.Equal(255, Alpha(clear, 190));
        Assert.Equal(Alpha(opaque, 190), Alpha(clear, 190));
    });

    private static readonly HarmonicaCandidate NoteCandidate = Mapping.CandidatesForPitch(60)[0];

    private static byte[] Render(double speed, double opacity, double time)
    {
        var view = new NoteFallView { FlowSpeed = speed, BackgroundOpacity = opacity, TimeMs = time };
        view.Load([new GameNote
        {
            Note = new NoteEvent { Start = 1000, Duration = 100, Pitch = 60 },
            Candidate = NoteCandidate, SourceIndex = 0
        }]);
        view.Measure(new Size(640, 348));
        view.Arrange(new Rect(0, 0, 640, 348));
        view.UpdateLayout();
        var bitmap = new RenderTargetBitmap(640, 348, 96, 96, PixelFormats.Pbgra32);
        bitmap.Render(view);
        var pixels = new byte[640 * 348 * 4];
        bitmap.CopyPixels(pixels, 640 * 4, 0);
        return pixels;
    }

    private static byte Alpha(byte[] pixels, int y) => pixels[(y * 640 + NoteCandidate.KeyIndex * 80 + 12) * 4 + 3];

    private static void OnSta(Action action)
    {
        Exception? error = null;
        var thread = new Thread(() => { try { action(); } catch (Exception e) { error = e; } });
        thread.SetApartmentState(ApartmentState.STA);
        thread.Start();
        thread.Join();
        if (error != null) ExceptionDispatchInfo.Capture(error).Throw();
    }
}
