using System.Diagnostics;
using DFH.Core;
using DFH.Core.Harmonica;

namespace DFH.Desktop.Services;

/// <summary>A score clock only. This mode never creates or dispatches input events.</summary>
public sealed class VisualPlayback
{
    /// <summary>Match the actual scheduled key holds, including timing-tier delays.</summary>
    public static IReadOnlyList<GameNote> AutomaticNotes(ScoreDocument document) => document.Sequence.Actions
        .Where(action => action.NoteIndex >= 0)
        .GroupBy(action => action.NoteIndex)
        .Select(group =>
        {
            var original = document.Notes[group.Key];
            var start = group.First(action => action.Down).Time;
            var end = group.First(action => !action.Down).Time;
            return original with { Note = original.Note with { Start = start, Duration = end - start } };
        }).OrderBy(note => note.Start).ToArray();

    private readonly Func<double> _now;
    private double _startedAt;
    public VisualPlayback(Func<double>? milliseconds = null) =>
        _now = milliseconds ?? (() => Stopwatch.GetTimestamp() * (1000d / Stopwatch.Frequency));
    private double _countdownMs;
    private double _stoppedMs = -3000;
    public IReadOnlyList<GameNote> Notes { get; private set; } = [];
    public double DurationMs { get; private set; }
    public bool IsBusy { get; private set; }
    public double ElapsedMs => IsBusy ? _now() - _startedAt - _countdownMs : _stoppedMs;

    public void Load(IReadOnlyList<GameNote> notes)
    {
        Stop();
        Notes = notes.OrderBy(note => note.Start).ToArray();
        DurationMs = Notes.Count == 0 ? 0 : Notes.Max(note => note.Start + note.Duration);
        _stoppedMs = -3000;
    }

    public void Start(int countdownSeconds)
    {
        if (IsBusy || Notes.Count == 0) return;
        _countdownMs = Math.Max(3, countdownSeconds) * 1000d;
        IsBusy = true;
        _startedAt = _now();
    }

    public void Stop()
    {
        _stoppedMs = ElapsedMs;
        IsBusy = false;
    }

    public bool FinishIfDue()
    {
        if (!IsBusy || ElapsedMs < DurationMs) return false;
        Stop();
        _stoppedMs = DurationMs;
        return true;
    }

    public int CurrentIndex()
    {
        var time = ElapsedMs;
        var low = 0;
        var high = Notes.Count;
        while (low < high)
        {
            var mid = (low + high) / 2;
            if (Notes[mid].Start <= time) low = mid + 1;
            else high = mid;
        }
        var index = low - 1;
        return index >= 0 && time < Notes[index].Start + Notes[index].Duration ? index : -1;
    }
}
