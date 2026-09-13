using DFH.Core.Music;

namespace DFH.Core.Harmonica;

/// <summary>One way to sound a pitch: a note key plus octave / sharp modifiers.</summary>
public sealed record HarmonicaCandidate(
    string Key,
    int Degree,
    int KeyIndex,
    int IntrinsicOctave,
    int OctaveModifier,
    bool Sharp,
    int Pitch);

/// <summary>A note together with the fingering the optimizer chose for it.</summary>
public sealed record GameNote
{
    public required NoteEvent Note { get; init; }
    public required HarmonicaCandidate Candidate { get; init; }
    /// <summary>Position of this note in the list handed to the optimizer.</summary>
    public required int SourceIndex { get; init; }

    public int Pitch => Candidate.Pitch;
    public double Start => Note.Start;
    public double Duration => Note.Duration;
    public double? Beat => Note.Beat;
    public double? DurationBeats => Note.DurationBeats;
    public string Key => Candidate.Key;
    public int Degree => Candidate.Degree;
    public int KeyIndex => Candidate.KeyIndex;
    public int OctaveModifier => Candidate.OctaveModifier;
    public bool Sharp => Candidate.Sharp;
}

public sealed record BaseKey(string Key, int Degree, int Semitone, int IntrinsicOctave, int KeyIndex);

/// <summary>Port of src/harmonica/mapping.ts.</summary>
public static class Mapping
{
    /// <summary>Middle C is the provisional 1.</summary>
    public const int RootMidi = 60;

    public static readonly IReadOnlyList<BaseKey> BaseKeys =
    [
        new("Z", 1, 0, 0, 0),
        new("X", 2, 2, 0, 1),
        new("C", 3, 4, 0, 2),
        new("V", 4, 5, 0, 3),
        new("B", 5, 7, 0, 4),
        new("N", 6, 9, 0, 5),
        new("M", 7, 11, 0, 6),
        new(",", 1, 12, 1, 7)
    ];

    private static readonly int[] OctaveModifiers = [-1, 0, 1];

    /// <summary>Candidates in the exact order the web enumerates them; the optimizer's tie-breaking depends on it.</summary>
    public static List<HarmonicaCandidate> CandidatesForPitch(int pitch)
    {
        var candidates = new List<HarmonicaCandidate>();
        foreach (var baseKey in BaseKeys)
        {
            foreach (var octaveModifier in OctaveModifiers)
            {
                foreach (var sharp in new[] { false, true })
                {
                    var resulting = RootMidi + baseKey.Semitone + octaveModifier * 12 + (sharp ? 1 : 0);
                    if (resulting != pitch) continue;
                    candidates.Add(new HarmonicaCandidate(baseKey.Key, baseKey.Degree, baseKey.KeyIndex, baseKey.IntrinsicOctave, octaveModifier, sharp, resulting));
                }
            }
        }
        return candidates;
    }

    public static int DisplayOctave(HarmonicaCandidate candidate) => candidate.IntrinsicOctave + candidate.OctaveModifier;

    /// <summary>↑ / ↓ for the octave mouse buttons, # for the semitone button.</summary>
    public static string ModifierLabel(HarmonicaCandidate candidate)
    {
        var octave = candidate.OctaveModifier > 0 ? "↑" : candidate.OctaveModifier < 0 ? "↓" : "";
        return octave + (candidate.Sharp ? "#" : "");
    }

    private static readonly string[] NoteNames = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];

    public static string MidiName(int pitch) => $"{NoteNames[((pitch % 12) + 12) % 12]}{(int)Math.Floor(pitch / 12.0) - 1}";
}
