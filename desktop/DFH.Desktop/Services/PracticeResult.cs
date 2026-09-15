namespace DFH.Desktop.Services;

/// <summary>An immutable result, retained when the live score is cleared.</summary>
public sealed record PracticeResult(string Title, string Mode, string Completion, string Summary,
    string Timing, string MainValue, string MainLabel, string Accuracy, string Combo,
    string Judgments, string Samples)
{
    public static PracticeResult Capture(string title, PracticeScore score, bool completed) => new(
        title, score.Mode == PracticeMode.Step ? "练习模式" : "计分模式",
        completed ? "已完成" : "提前结束 · 仅统计已演奏部分",
        score.Summary, score.TimingSummary,
        score.Mode == PracticeMode.Step ? score.Hits.ToString() : score.Points.ToString("N0"),
        score.Mode == PracticeMode.Step ? "正确音符" : "本次得分",
        $"{score.Accuracy:0.0}%", score.MaxCombo.ToString(),
        score.Mode == PracticeMode.Step ? $"正确 {score.Hits} · 错按 {score.WrongPresses}"
            : $"Perfect {score.Perfect} · Good {score.Good} · Miss {score.Misses} · 错按 {score.WrongPresses}",
        score.Mode == PracticeMode.Step ? $"反应时间样本 {score.Hits} · 不评判节奏误差"
            : $"起音误差样本 {score.Hits} · 负数提前，正数延后 · 不含漏音和错按");
}
