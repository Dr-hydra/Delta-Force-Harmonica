using System.IO;
using System.Windows.Threading;
using DFH.Desktop.ViewModels;
using Melanchall.DryWetMidi.Common;
using Melanchall.DryWetMidi.Core;
using Xunit;

namespace DFH.Desktop.Tests;

public class LocalLibraryNavigationTests
{
    [Fact]
    public void NavigationReadsFolderOrderWrapsAndTracksLoadedPathInsteadOfSelection()
    {
        var folder = Path.Combine(Path.GetTempPath(), $"dfh-navigation-{Guid.NewGuid():N}");
        Directory.CreateDirectory(folder);
        var first = Path.Combine(folder, "01-first.mid");
        var second = Path.Combine(folder, "02-second.midi");
        var last = Path.Combine(folder, "03-last.mid");
        var invalid = Path.Combine(folder, "04-invalid.mid");
        try
        {
            WriteMidi(last);
            WriteMidi(first);
            WriteMidi(second);
            File.WriteAllText(invalid, "invalid midi");
            using var library = new LocalLibraryViewModel(Dispatcher.CurrentDispatcher, folder, _ => { }, _ => { });
            Assert.Equal(new[] { first, second, last }, library.Entries.Select(entry => entry.Path));
            Assert.Equal(first, library.Adjacent(null, 1)?.Path);
            Assert.Equal(last, library.Adjacent("library:cloud-score", -1)?.Path);
            Assert.Equal(last, library.Adjacent(first, -1)?.Path);
            Assert.Equal(first, library.Adjacent(last, 1)?.Path);
            library.SelectPath(last);
            Assert.Equal(second, library.Adjacent(first.ToUpperInvariant(), 1)?.Path);
            library.SelectPath(second);
            library.Refresh();
            Assert.Equal(second, library.Selected?.Path);
            Assert.Contains(library.Selected, library.Entries);
            File.Delete(second);
            library.Refresh();
            Assert.Null(library.Selected);
            Assert.Equal(last, library.Adjacent(first, 1)?.Path);
            Assert.Equal(first, library.Adjacent(second, 1)?.Path);
            File.Delete(last);
            library.Refresh();
            Assert.Equal(first, library.Adjacent(first, 1)?.Path);
            Assert.Equal(first, library.Adjacent(first, -1)?.Path);
            File.Delete(first);
            library.Refresh();
            Assert.Null(library.Adjacent(null, 1));
            Assert.Null(library.Adjacent(null, -1));
        }
        finally
        {
            foreach (var path in new[] { first, second, last, invalid }) File.Delete(path);
            Directory.Delete(folder);
        }
    }

    private static void WriteMidi(string path)
    {
        var midi = new MidiFile(new TrackChunk(
            new SequenceTrackNameEvent("DFH SCORE"),
            new NoteOnEvent((SevenBitNumber)60, (SevenBitNumber)96),
            new NoteOffEvent((SevenBitNumber)60, (SevenBitNumber)0) { DeltaTime = 480 }))
        { TimeDivision = new TicksPerQuarterNoteTimeDivision(480) };
        using var stream = File.Create(path);
        midi.Write(stream);
    }
}
