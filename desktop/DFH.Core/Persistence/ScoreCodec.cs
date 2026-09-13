using System.IO.Compression;
using DFH.Core.Music;

namespace DFH.Core.Persistence;

public sealed class ScoreSnapshot
{
    public required int Version { get; init; }
    public required int Ppq { get; init; }
    public required int Transpose { get; init; }
    public required IReadOnlyList<TempoEvent> Tempos { get; init; }
    public required IReadOnlyList<TimeSignatureEvent> TimeSignatures { get; init; }
    public required IReadOnlyList<double> MeasureStarts { get; init; }
    public required IReadOnlyList<NoteEvent> Notes { get; init; }

    public double Bpm => Tempos.Count > 0 ? Tempos[0].Bpm : 120;

    public double DurationMs
    {
        get
        {
            double last = 0;
            foreach (var note in Notes) last = Math.Max(last, (note.Beat ?? 0) + (note.DurationBeats ?? 0));
            return JsMath.Round(ScoreCodec.BeatToMs(last, Tempos));
        }
    }
}

public sealed class DfhsFormatException(string message) : Exception(message);

/// <summary>
/// Decoder for DFHS1, the persistence format of src/persistence/scoreCodec.ts:
/// raw deflate around a varint stream of PPQ, transpose, tempo map, time
/// signatures, explicit measure starts and delta-coded notes. Only authoritative
/// tick data is stored; milliseconds are derived here exactly as the web does.
/// </summary>
public static class ScoreCodec
{
    private static readonly byte[] Magic = [0x44, 0x46, 0x48, 0x53]; // DFHS
    public const int Version = 1;
    public const int DefaultPpq = 480;

    private sealed class Reader(byte[] bytes)
    {
        private int _offset;

        public byte U8()
        {
            if (_offset >= bytes.Length) throw new DfhsFormatException("DFHS data is truncated");
            return bytes[_offset++];
        }

        public long Varint()
        {
            long result = 0;
            long shift = 1;
            for (;;)
            {
                var b = U8();
                result += (b & 0x7f) * shift;
                if ((b & 0x80) == 0) return result;
                shift *= 128;
                if (shift > (1L << 49)) throw new DfhsFormatException("DFHS varint is too large");
            }
        }
    }

    private static long Unzigzag(long value) => value % 2 == 0 ? value / 2 : -(value + 1) / 2;

    public static double BeatToMs(double beat, IReadOnlyList<TempoEvent> tempos)
    {
        var target = Math.Max(0, beat);
        var active = tempos.Count > 0 ? tempos[0] : new TempoEvent(0, 0, 120);
        foreach (var tempo in tempos)
        {
            if (tempo.Beat > target) break;
            active = tempo;
        }
        return active.Time + (target - active.Beat) * 60000 / active.Bpm;
    }

    public static double MsToBeat(double ms, IReadOnlyList<TempoEvent> tempos)
    {
        var target = Math.Max(0, ms);
        var active = tempos.Count > 0 ? tempos[0] : new TempoEvent(0, 0, 120);
        foreach (var tempo in tempos)
        {
            if (tempo.Time > target) break;
            active = tempo;
        }
        return active.Beat + (target - active.Time) * active.Bpm / 60000;
    }

    private static byte[] Inflate(byte[] compressed)
    {
        using var input = new MemoryStream(compressed);
        using var deflate = new DeflateStream(input, CompressionMode.Decompress);
        using var output = new MemoryStream();
        deflate.CopyTo(output);
        return output.ToArray();
    }

    public static ScoreSnapshot Decode(byte[] compressed)
    {
        byte[] raw;
        try
        {
            raw = Inflate(compressed);
        }
        catch (InvalidDataException reason)
        {
            throw new DfhsFormatException($"Not a DFHS score: {reason.Message}");
        }

        var reader = new Reader(raw);
        foreach (var expected in Magic)
        {
            if (reader.U8() != expected) throw new DfhsFormatException("Not a DFHS score");
        }
        var version = reader.U8();
        if (version != Version) throw new DfhsFormatException($"Unsupported DFHS version {version}");

        var ppq = (int)reader.Varint();
        if (ppq < 24 || ppq > 9600) throw new DfhsFormatException("Invalid DFHS PPQ");
        var transpose = (int)Unzigzag(reader.Varint());

        var tempoCount = reader.Varint();
        if (tempoCount > 4096) throw new DfhsFormatException("DFHS contains too many tempo events");
        var tempos = new List<TempoEvent>();
        long tick = 0;
        double time = 0;
        for (var index = 0; index < tempoCount; index += 1)
        {
            tick += reader.Varint();
            var bpm = reader.Varint() / 100.0;
            var beat = (double)tick / ppq;
            if (index > 0)
            {
                var previous = tempos[index - 1];
                time += (beat - previous.Beat) * 60000 / previous.Bpm;
            }
            tempos.Add(new TempoEvent(beat, JsMath.Round(time), bpm));
        }
        if (tempos.Count == 0) tempos.Add(new TempoEvent(0, 0, 120));

        var signatureCount = reader.Varint();
        if (signatureCount > 1024) throw new DfhsFormatException("DFHS contains too many time signatures");
        var signatures = new List<TimeSignatureEvent>();
        tick = 0;
        for (var index = 0; index < signatureCount; index += 1)
        {
            tick += reader.Varint();
            var numerator = (int)reader.Varint();
            var denominator = (int)reader.Varint();
            signatures.Add(new TimeSignatureEvent((double)tick / ppq, numerator, denominator));
        }
        if (signatures.Count == 0) signatures.Add(new TimeSignatureEvent(0, 4, 4));

        var measureCount = reader.Varint();
        if (measureCount > 100_000) throw new DfhsFormatException("DFHS contains too many measures");
        var measureStarts = new List<double>();
        tick = 0;
        for (var index = 0; index < measureCount; index += 1)
        {
            tick += reader.Varint();
            measureStarts.Add((double)tick / ppq);
        }

        var noteCount = reader.Varint();
        if (noteCount > 1_000_000) throw new DfhsFormatException("DFHS contains too many notes");
        var notes = new List<NoteEvent>();
        tick = 0;
        for (var index = 0; index < noteCount; index += 1)
        {
            tick += reader.Varint();
            var durationTick = reader.Varint();
            var pitch = reader.U8();
            var beat = (double)tick / ppq;
            var durationBeats = Math.Max(1.0 / ppq, (double)durationTick / ppq);
            var start = BeatToMs(beat, tempos);
            var end = BeatToMs(beat + durationBeats, tempos);
            notes.Add(new NoteEvent
            {
                Pitch = pitch,
                Start = JsMath.Round(start),
                Duration = Math.Max(1, JsMath.Round(end - start)),
                Beat = beat,
                DurationBeats = durationBeats
            });
        }

        return new ScoreSnapshot
        {
            Version = version,
            Ppq = ppq,
            Transpose = transpose,
            Tempos = tempos,
            TimeSignatures = signatures,
            MeasureStarts = measureStarts,
            Notes = notes
        };
    }

    public static ScoreSnapshot DecodeBase64Url(string payload) => Decode(Base64Url.Decode(payload));
}

public static class Base64Url
{
    public static byte[] Decode(string value)
    {
        var padded = value.Replace('-', '+').Replace('_', '/');
        padded += new string('=', (4 - padded.Length % 4) % 4);
        return Convert.FromBase64String(padded);
    }

    public static string Encode(byte[] bytes) =>
        Convert.ToBase64String(bytes).Replace('+', '-').Replace('/', '_').TrimEnd('=');
}
