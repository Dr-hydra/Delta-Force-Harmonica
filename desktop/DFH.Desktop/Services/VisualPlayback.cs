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
    private double _pausedRawMs;
    private int _stepIndex;
    public PracticeMode Mode { get; private set; }
    public PracticeScore Score { get; } = new();
    private bool _practice;
    public static double NowMs => Stopwatch.GetTimestamp() * (1000d / Stopwatch.Frequency);
    public IReadOnlyList<GameNote> Notes { get; private set; } = [];
    public double DurationMs { get; private set; }
    public bool IsBusy { get; private set; }
    public bool IsPaused { get; private set; }
    private double RawElapsed(double now) => IsPaused ? _pausedRawMs : now - _startedAt - _countdownMs;
    private double Cap(double raw) => _practice && Mode == PracticeMode.Step && _stepIndex < Notes.Count ? Math.Min(raw, Notes[_stepIndex].Start) : raw;
    public double ElapsedMs => IsBusy && !IsPaused ? Cap(RawElapsed(_now())) : _stoppedMs;
    public bool WaitingForNote => IsBusy && !IsPaused && _practice && Mode == PracticeMode.Step && _stepIndex < Notes.Count && RawElapsed(_now()) >= Notes[_stepIndex].Start;
    public int StepIndex => _stepIndex;

    public void Load(IReadOnlyList<GameNote> notes)
    {
        Stop();
        Notes = notes.OrderBy(note => note.Start).ToArray();
        DurationMs = Notes.Count == 0 ? 0 : Notes.Max(note => note.Start + note.Duration);
        _stoppedMs = -3000;
        Score.Clear();
    }

    public void Start(int countdownSeconds, PracticeMode? practiceMode = null)
    {
        if (IsBusy || Notes.Count == 0) return;
        _countdownMs = Math.Max(3, countdownSeconds) * 1000d;
        IsBusy = true;
        IsPaused = false;
        _startedAt = _now();
        _practice = practiceMode != null;
        Mode = practiceMode ?? PracticeMode.Rhythm;
        _stepIndex = 0;
        if (_practice) Score.Reset(Notes, Mode); else Score.Clear();
    }

    public void Stop()
    {
        _stoppedMs = ElapsedMs;
        IsBusy = false;
        IsPaused = false;
    }

    public void TogglePause()
    {
        if (!IsBusy) return;
        if (IsPaused) _startedAt = _now() - _countdownMs - _pausedRawMs;
        else { _pausedRawMs = RawElapsed(_now()); _stoppedMs = Cap(_pausedRawMs); }
        IsPaused = !IsPaused;
    }

    public bool FinishIfDue()
    {
        if (!IsBusy || IsPaused) return false;
        if (_practice) Score.Advance(ElapsedMs);
        var tail = _practice && Mode == PracticeMode.Rhythm ? Math.Max(DurationMs, Notes[^1].Start + PracticeScore.HitWindowMs + 1) : DurationMs;
        if (ElapsedMs < tail || (_practice && Mode == PracticeMode.Step && _stepIndex < Notes.Count)) return false;
        Stop();
        _stoppedMs = DurationMs;
        return true;
    }

    public bool Press(PracticeInput input)
    {
        if (!_practice || !IsBusy || IsPaused) return false;
        var raw = RawElapsed(input.TimestampMs);
        if (raw < 0) return false;
        if (Mode == PracticeMode.Rhythm) return Score.Press(input, raw);
        if (_stepIndex >= Notes.Count) return false;
        var start = Notes[_stepIndex].Start;
        if (!Score.Press(input, Cap(raw), _stepIndex, raw - start)) return false;
        // Remove the wait, preserving the original interval before the next note.
        _startedAt += Math.Max(0, raw - start);
        _stepIndex++;
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
