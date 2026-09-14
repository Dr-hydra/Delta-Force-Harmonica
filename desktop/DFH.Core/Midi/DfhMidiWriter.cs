using System.Text;
using DFH.Core.Harmonica;

namespace DFH.Core.Midi;

/// <summary>Writes the same compact, snapshot-bearing standard MIDI shape as the web exporter.</summary>
public static class DfhMidiWriter
{
    private const int Ppq = 480;

    public static void Write(Stream output, IReadOnlyList<GameNote> notes, double bpm, string snapshotBase64Url)
    {
        var safeBpm = bpm > 0 ? bpm : 120;
        WriteAscii(output, "MThd");
        WriteUInt32(output, 6);
        WriteUInt16(output, 1);
        WriteUInt16(output, 2);
        WriteUInt16(output, Ppq);

        using var header = new MemoryStream();
        MetaText(header, 0x03, DfhMidiReader.HeaderName);
        MetaText(header, 0x01, DfhMidiReader.SnapshotPrefix + snapshotBase64Url);
        WriteVarLen(header, 0);
        header.WriteByte(0xff);
        header.WriteByte(0x51);
        header.WriteByte(3);
        var micros = (int)Math.Clamp(Math.Round(60_000_000 / safeBpm), 1, 0xffffff);
        header.WriteByte((byte)(micros >> 16));
        header.WriteByte((byte)(micros >> 8));
        header.WriteByte((byte)micros);
        WriteVarLen(header, 0);
        header.Write([0xff, 0x58, 0x04, 0x04, 0x02, 0x18, 0x08]);
        EndTrack(header);
        WriteTrack(output, header);

        using var track = new MemoryStream();
        MetaText(track, 0x03, DfhMidiReader.TrackName);
        WriteVarLen(track, 0);
        track.Write([0xc0, 0x00]);
        var events = notes.SelectMany(note =>
        {
            var start = ToTicks(note.Start, safeBpm);
            var end = Math.Max(start + 1, ToTicks(note.Start + note.Duration, safeBpm));
            var pitch = (byte)Math.Clamp(note.Pitch, 0, 127);
            return new[] { new NoteMessage(start, true, pitch), new NoteMessage(end, false, pitch) };
        }).OrderBy(message => message.Tick).ThenBy(message => message.On ? 1 : 0).ToList();
        long previous = 0;
        foreach (var message in events)
        {
            WriteVarLen(track, message.Tick - previous);
            track.WriteByte(message.On ? (byte)0x90 : (byte)0x80);
            track.WriteByte(message.Pitch);
            track.WriteByte(message.On ? (byte)95 : (byte)0);
            previous = message.Tick;
        }
        EndTrack(track);
        WriteTrack(output, track);
    }

    private sealed record NoteMessage(long Tick, bool On, byte Pitch);
    private static long ToTicks(double ms, double bpm) => Math.Max(0, (long)Math.Round(ms / 60_000 * bpm * Ppq));

    private static void MetaText(Stream stream, byte type, string value)
    {
        var bytes = Encoding.ASCII.GetBytes(value);
        WriteVarLen(stream, 0);
        stream.WriteByte(0xff);
        stream.WriteByte(type);
        WriteVarLen(stream, bytes.Length);
        stream.Write(bytes);
    }

    private static void EndTrack(Stream stream)
    {
        WriteVarLen(stream, 0);
        stream.Write([0xff, 0x2f, 0x00]);
    }

    private static void WriteTrack(Stream output, MemoryStream track)
    {
        WriteAscii(output, "MTrk");
        WriteUInt32(output, (uint)track.Length);
        track.Position = 0;
        track.CopyTo(output);
    }

    private static void WriteVarLen(Stream stream, long value)
    {
        value = Math.Max(0, value);
        Span<byte> buffer = stackalloc byte[10];
        var index = buffer.Length - 1;
        buffer[index] = (byte)(value & 0x7f);
        while ((value >>= 7) > 0) buffer[--index] = (byte)((value & 0x7f) | 0x80);
        stream.Write(buffer[index..]);
    }

    private static void WriteAscii(Stream stream, string value) => stream.Write(Encoding.ASCII.GetBytes(value));
    private static void WriteUInt16(Stream stream, ushort value) => stream.Write([(byte)(value >> 8), (byte)value]);
    private static void WriteUInt32(Stream stream, uint value) => stream.Write([(byte)(value >> 24), (byte)(value >> 16), (byte)(value >> 8), (byte)value]);
}
