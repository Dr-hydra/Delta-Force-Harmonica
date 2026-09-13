namespace DFH.Core.Music;

/// <summary>Mirror of <c>NoteEvent</c> in src/music/types.ts. Times are milliseconds.</summary>
public sealed record NoteEvent
{
    public required int Pitch { get; init; }
    public required double Start { get; init; }
    public required double Duration { get; init; }
    public double? Beat { get; init; }
    public double? DurationBeats { get; init; }
}

public sealed record TempoEvent(double Beat, double Time, double Bpm);

public sealed record TimeSignatureEvent(double Beat, int Numerator, int Denominator);

/// <summary>
/// JavaScript number helpers. The TypeScript pipeline is the reference
/// implementation, so rounding has to follow Math.round (half toward +∞), not
/// .NET's banker's rounding.
/// </summary>
public static class JsMath
{
    public static double Round(double value) => Math.Floor(value + 0.5);
}
