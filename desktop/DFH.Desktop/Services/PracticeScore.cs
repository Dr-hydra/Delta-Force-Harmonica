using DFH.Core.Harmonica;

namespace DFH.Desktop.Services;

public enum PracticeMode { Rhythm, Step }
public enum NoteJudgment { Pending, Perfect, Good, Miss }

/// <summary>A physical note press captured on the hook thread, before UI dispatch.</summary>
public readonly record struct PracticeInput(int VirtualKey, double TimestampMs, bool Left, bool Right, bool Middle, IntPtr Foreground)
{
    public string Key => VirtualKey == 0xBC ? "," : ((char)VirtualKey).ToString();
    public bool Matches(GameNote note) => Key == note.Key && !(Left && Right)
        && (Right ? 1 : Left ? -1 : 0) == note.OctaveModifier && Middle == note.Sharp;
    public static bool IsNoteKey(int key) => key is 0x5A or 0x58 or 0x43 or 0x56 or 0x42 or 0x4E or 0x4D or 0xBC;
}

/// <summary>Onset scoring only. Misses and wrong presses have no fictitious timing error.</summary>
public sealed class PracticeScore
{
    public const double PerfectWindowMs = 50;
    public const double HitWindowMs = 150;
    private IReadOnlyList<GameNote> _notes = [];
    private NoteJudgment[] _judgments = [];
    private int _nextPending;
    private double _errorSum, _absoluteSum, _squareSum, _reactionSum;
    public PracticeMode Mode { get; private set; }
    public int Hits { get; private set; }
    public int Perfect { get; private set; }
    public int Good { get; private set; }
    public int Misses { get; private set; }
    public int WrongPresses { get; private set; }
    public int Combo { get; private set; }
    public int MaxCombo { get; private set; }
    public int Points => Perfect * 1000 + Good * 500;
    public double Accuracy => Hits + Misses + WrongPresses == 0 ? 0 : 100d * Hits / (Hits + Misses + WrongPresses);
    public double? LastErrorMs { get; private set; }
    public double MeanErrorMs => Hits == 0 ? 0 : _errorSum / Hits;
    public double MeanAbsoluteErrorMs => Hits == 0 ? 0 : _absoluteSum / Hits;
    public double StandardDeviationMs => Hits == 0 ? 0 : Math.Sqrt(Math.Max(0, _squareSum / Hits - MeanErrorMs * MeanErrorMs));
    public double MaxAbsoluteErrorMs { get; private set; }
    public double? LastReactionMs { get; private set; }
    public double MeanReactionMs => Hits == 0 ? 0 : _reactionSum / Hits;
    public string LastJudgment { get; private set; } = "等待开始";
    public bool HasSession { get; private set; }
    public int JudgedCount => Hits + Misses;
    public IReadOnlyList<NoteJudgment> Judgments => _judgments;

    public void Reset(IReadOnlyList<GameNote> notes, PracticeMode mode)
    {
        _notes = notes;
        _judgments = new NoteJudgment[notes.Count];
        Mode = mode;
        HasSession = true;
        _nextPending = Hits = Perfect = Good = Misses = WrongPresses = Combo = MaxCombo = 0;
        _errorSum = _absoluteSum = _squareSum = _reactionSum = MaxAbsoluteErrorMs = 0;
        LastErrorMs = LastReactionMs = null;
        LastJudgment = "等待音符";
    }

    public void Clear() { Reset([], Mode); HasSession = false; }

    public void Advance(double elapsedMs)
    {
        if (Mode != PracticeMode.Rhythm) return;
        while (_nextPending < _notes.Count && _notes[_nextPending].Start + HitWindowMs < elapsedMs)
        {
            if (_judgments[_nextPending] == NoteJudgment.Pending)
            {
                _judgments[_nextPending] = NoteJudgment.Miss;
                Misses++;
                Combo = 0;
                LastJudgment = "Miss · 漏音";
                LastErrorMs = null;
            }
            _nextPending++;
        }
    }

    public bool Press(PracticeInput input, double elapsedMs, int stepIndex = -1, double reactionMs = 0)
    {
        Advance(elapsedMs);
        if (Mode == PracticeMode.Step)
        {
            if (stepIndex < 0 || stepIndex >= _notes.Count || elapsedMs < _notes[stepIndex].Start) return false;
            if (!input.Matches(_notes[stepIndex])) { Wrong(); return false; }
            if (_judgments[stepIndex] != NoteJudgment.Pending) return false;
            _judgments[stepIndex] = NoteJudgment.Perfect;
            LastReactionMs = Math.Max(0, reactionMs);
            _reactionSum += LastReactionMs.Value;
            LastJudgment = "正确 · 进入下一音";
            Hit();
            return true;
        }

        // Find the nearest still-pending note with the exact displayed fingering.
        var candidate = -1;
        var distance = double.PositiveInfinity;
        for (var i = _nextPending; i < _notes.Count && _notes[i].Start <= elapsedMs + HitWindowMs; i++)
        {
            var delta = Math.Abs(elapsedMs - _notes[i].Start);
            if (_judgments[i] != NoteJudgment.Pending || delta > HitWindowMs || !input.Matches(_notes[i]) || delta >= distance) continue;
            candidate = i;
            distance = delta;
        }
        if (candidate < 0) { Wrong(); return false; }
        var error = elapsedMs - _notes[candidate].Start;
        var perfect = distance <= PerfectWindowMs;
        _judgments[candidate] = perfect ? NoteJudgment.Perfect : NoteJudgment.Good;
        if (perfect) Perfect++; else Good++;
        LastErrorMs = error;
        _errorSum += error;
        _absoluteSum += distance;
        _squareSum += error * error;
        MaxAbsoluteErrorMs = Math.Max(MaxAbsoluteErrorMs, distance);
        LastJudgment = perfect ? "Perfect" : "Good";
        Hit();
        return true;
    }

    private void Hit() { Hits++; Combo++; MaxCombo = Math.Max(MaxCombo, Combo); }
    private void Wrong() { WrongPresses++; Combo = 0; LastErrorMs = null; LastJudgment = "错按"; }

    public string Summary => !HasSession ? "" : Mode == PracticeMode.Step
        ? $"逐音练习 · 正确 {Hits}/{_notes.Count} · 错按 {WrongPresses} · 正确率 {Accuracy:0.0}% · 连击 {Combo} / 最高 {MaxCombo}"
        : $"{Points:N0} 分 · Perfect {Perfect} · Good {Good} · Miss {Misses} · 错按 {WrongPresses} · 命中率 {Accuracy:0.0}% · 连击 {Combo} / 最高 {MaxCombo}";
    public string TimingSummary => !HasSession ? "" : Mode == PracticeMode.Step
        ? (Hits == 0 ? "等待正确按键 · 反应时间不作为节奏误差" : $"最近反应 {LastReactionMs:0} ms · 平均反应 {MeanReactionMs:0} ms（扣除暂停时间）")
        : Hits == 0 ? "暂无有效误差样本 · 仅统计按对的音符"
        : $"最近 {(LastErrorMs is { } error ? $"{error:+0.0;-0.0;0.0} ms" : "—")} · 平均偏差 {MeanErrorMs:+0.0;-0.0;0.0} ms · 平均绝对误差 {MeanAbsoluteErrorMs:0.0} ms · 最大 {MaxAbsoluteErrorMs:0.0} ms · 标准差 {StandardDeviationMs:0.0} ms · 样本 {Hits}（负=提前，正=延后）";
}
