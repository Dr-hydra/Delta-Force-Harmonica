using DFH.Core.Midi;
using Melanchall.DryWetMidi.Common;
using Melanchall.DryWetMidi.Core;
using Xunit;

namespace DFH.Core.Tests;

public class MidiReaderTests
{
    private static MemoryStream Write(MidiFile file)
    {
        var stream = new MemoryStream();
        file.Write(stream);
        stream.Position = 0;
        return stream;
    }

    private static TrackChunk NoteTrack(string name, params (int Pitch, long Start, long Length)[] notes)
    {
        var events = new List<MidiEvent> { new SequenceTrackNameEvent(name) };
        var timeline = new List<(long Time, MidiEvent Event)>();
        foreach (var (pitch, start, length) in notes)
        {
            timeline.Add((start, new NoteOnEvent((SevenBitNumber)pitch, (SevenBitNumber)96)));
            timeline.Add((start + length, new NoteOffEvent((SevenBitNumber)pitch, (SevenBitNumber)0)));
        }
        long previous = 0;
        foreach (var (time, midiEvent) in timeline.OrderBy(item => item.Time).ThenBy(item => item.Event is NoteOffEvent ? 0 : 1))
        {
            midiEvent.DeltaTime = time - previous;
            previous = time;
            events.Add(midiEvent);
        }
        return new TrackChunk(events);
    }

    [Fact]
    public void Legacy_export_is_rebuilt_from_its_note_track()
    {
        var file = new MidiFile(
            new TrackChunk(new SequenceTrackNameEvent("Delta Force Harmonica"), new SetTempoEvent(500_000), new TimeSignatureEvent(3, 4)),
            NoteTrack("DFH SCORE", (60, 0, 480), (67, 480, 240), (72, 720, 240)))
        {
            TimeDivision = new TicksPerQuarterNoteTimeDivision(480)
        };

        var score = DfhMidiReader.Read(Write(file), "old");

        Assert.True(score.Legacy);
        Assert.Equal(0, score.Snapshot.Transpose);
        Assert.Equal(120, score.Snapshot.Bpm, 6);
        Assert.Equal((3, 4), (score.Snapshot.TimeSignatures[0].Numerator, score.Snapshot.TimeSignatures[0].Denominator));
        Assert.Equal(new[] { 60, 67, 72 }, score.Snapshot.Notes.Select(note => note.Pitch));
        Assert.Equal(new double[] { 0, 500, 750 }, score.Snapshot.Notes.Select(note => note.Start));
        Assert.Equal(new double[] { 500, 250, 250 }, score.Snapshot.Notes.Select(note => note.Duration));
        Assert.Equal(new double[] { 0, 1, 1.5 }, score.Snapshot.Notes.Select(note => note.Beat!.Value));
    }

    [Fact]
    public void Foreign_midi_is_refused()
    {
        var file = new MidiFile(NoteTrack("Piano", (60, 0, 480)))
        {
            TimeDivision = new TicksPerQuarterNoteTimeDivision(480)
        };

        var reason = Assert.Throws<NotSiteExportException>(() => DfhMidiReader.Read(Write(file), "song"));
        Assert.Contains("本站导出", reason.Message);
    }

    [Fact]
    public void Garbage_is_refused_with_a_readable_message()
    {
        using var stream = new MemoryStream("definitely not midi"u8.ToArray());
        Assert.Throws<NotSiteExportException>(() => DfhMidiReader.Read(stream, "junk"));
    }

    [Fact]
    public void Broken_snapshot_payload_is_refused()
    {
        var file = new MidiFile(
            new TrackChunk(new SequenceTrackNameEvent("Delta Force Harmonica"), new TextEvent("DFHS1 AAAA")),
            NoteTrack("DFH SCORE", (60, 0, 480)))
        {
            TimeDivision = new TicksPerQuarterNoteTimeDivision(480)
        };

        Assert.Throws<NotSiteExportException>(() => DfhMidiReader.Read(Write(file), "broken"));
    }
}
