using DFH.Core.Music;
using NoteEvent = DFH.Core.Music.NoteEvent;
using TimeSignatureEvent = DFH.Core.Music.TimeSignatureEvent;
using DFH.Core.Persistence;
using Melanchall.DryWetMidi.Core;
using Melanchall.DryWetMidi.Interaction;

namespace DFH.Core.Midi;

public sealed class NotSiteExportException(string message) : Exception(message);

public sealed class DfhMidiScore
{
    public required string Title { get; init; }
    public required ScoreSnapshot Snapshot { get; init; }
    /// <summary>True when the file predates the embedded snapshot and only the bare pitches were available.</summary>
    public required bool Legacy { get; init; }
}

/// <summary>
/// Opens a MIDI exported by the web app. Current exports carry a DFHS1 snapshot
/// in a text meta event (see src/export/midi.ts); older exports are recognised
/// by their <c>DFH SCORE</c> track name and rebuilt from the note data. Anything
/// else is refused: the desktop player is deliberately not a general MIDI player.
/// </summary>
public static class DfhMidiReader
{
    public const string SnapshotPrefix = "DFHS1 ";
    public const string HeaderName = "Delta Force Harmonica";
    public const string TrackName = "DFH SCORE";

    public static DfhMidiScore Read(string path)
    {
        using var stream = File.OpenRead(path);
        return Read(stream, Path.GetFileNameWithoutExtension(path));
    }

    public static DfhMidiScore Read(Stream stream, string title)
    {
        MidiFile midi;
        try
        {
            midi = MidiFile.Read(stream, new ReadingSettings
            {
                InvalidChunkSizePolicy = InvalidChunkSizePolicy.Ignore,
                MissedEndOfTrackPolicy = MissedEndOfTrackPolicy.Ignore,
                NoHeaderChunkPolicy = NoHeaderChunkPolicy.Abort
            });
        }
        catch (Exception reason) when (reason is not NotSiteExportException)
        {
            throw new NotSiteExportException($"这不是一个可读取的 MIDI 文件：{reason.Message}");
        }

        var chunks = midi.GetTrackChunks().ToList();
        var trackNames = new HashSet<string>();
        string? payload = null;
        foreach (var chunk in chunks)
        {
            foreach (var midiEvent in chunk.Events)
            {
                switch (midiEvent)
                {
                    case TextEvent text when payload == null && text.Text.StartsWith(SnapshotPrefix, StringComparison.Ordinal):
                        payload = text.Text[SnapshotPrefix.Length..];
                        break;
                    case SequenceTrackNameEvent name:
                        trackNames.Add(name.Text.Trim());
                        break;
                }
            }
        }

        if (payload != null)
        {
            ScoreSnapshot snapshot;
            try
            {
                snapshot = ScoreCodec.DecodeBase64Url(payload.Trim());
            }
            catch (Exception reason) when (reason is DfhsFormatException or FormatException)
            {
                throw new NotSiteExportException($"文件里的谱面快照无法读取：{reason.Message}");
            }
            return new DfhMidiScore { Title = title, Snapshot = snapshot, Legacy = false };
        }

        if (!trackNames.Contains(TrackName) && !trackNames.Contains(HeaderName))
        {
            throw new NotSiteExportException("只接受本站导出的 MIDI。请在网页版转换器或曲库里点击「标准 MIDI .mid」导出后再打开。");
        }

        return new DfhMidiScore { Title = title, Snapshot = LegacySnapshot(midi, chunks), Legacy = true };
    }

    /// <summary>
    /// Old exports have one note track at the converted pitches plus a tempo and
    /// a time signature. Fingering is re-derived from the pitches with transpose 0.
    /// </summary>
    private static ScoreSnapshot LegacySnapshot(MidiFile midi, List<TrackChunk> chunks)
    {
        var ppq = midi.TimeDivision is TicksPerQuarterNoteTimeDivision division ? division.TicksPerQuarterNote : ScoreCodec.DefaultPpq;
        var tempoMap = midi.GetTempoMap();

        var tempos = new List<TempoEvent>();
        var firstTempo = tempoMap.GetTempoAtTime(new MidiTimeSpan(0));
        tempos.Add(new TempoEvent(0, 0, 60_000_000.0 / firstTempo.MicrosecondsPerQuarterNote));
        foreach (var change in tempoMap.GetTempoChanges())
        {
            var beat = (double)change.Time / ppq;
            if (beat <= 1e-7) continue;
            var timeMs = TimeConverter.ConvertTo<MetricTimeSpan>(change.Time, tempoMap).TotalMicroseconds / 1000.0;
            tempos.Add(new TempoEvent(beat, JsMath.Round(timeMs), 60_000_000.0 / change.Value.MicrosecondsPerQuarterNote));
        }

        var signatures = new List<TimeSignatureEvent>();
        var firstSignature = tempoMap.GetTimeSignatureAtTime(new MidiTimeSpan(0));
        signatures.Add(new TimeSignatureEvent(0, firstSignature.Numerator, firstSignature.Denominator));
        foreach (var change in tempoMap.GetTimeSignatureChanges())
        {
            var beat = (double)change.Time / ppq;
            if (beat <= 1e-7) continue;
            signatures.Add(new TimeSignatureEvent(beat, change.Value.Numerator, change.Value.Denominator));
        }

        var notes = new List<NoteEvent>();
        foreach (var chunk in chunks)
        {
            foreach (var note in chunk.GetNotes())
            {
                var startMs = TimeConverter.ConvertTo<MetricTimeSpan>(note.Time, tempoMap).TotalMicroseconds / 1000.0;
                var endMs = TimeConverter.ConvertTo<MetricTimeSpan>(note.EndTime, tempoMap).TotalMicroseconds / 1000.0;
                notes.Add(new NoteEvent
                {
                    Pitch = note.NoteNumber,
                    Start = JsMath.Round(startMs),
                    Duration = Math.Max(1, JsMath.Round(endMs - startMs)),
                    Beat = (double)note.Time / ppq,
                    DurationBeats = Math.Max(1.0 / ppq, (double)note.Length / ppq)
                });
            }
        }

        if (notes.Count == 0) throw new NotSiteExportException("这个 MIDI 里没有音符。");

        return new ScoreSnapshot
        {
            Version = ScoreCodec.Version,
            Ppq = ppq,
            Transpose = 0,
            Tempos = tempos,
            TimeSignatures = signatures,
            MeasureStarts = [],
            Notes = notes.OrderBy(note => note.Start).ThenBy(note => note.Pitch).ToList()
        };
    }
}
