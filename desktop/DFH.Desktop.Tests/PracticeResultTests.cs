using DFH.Core.Harmonica;
using DFH.Core.Music;
using DFH.Desktop.Services;
using Xunit;

namespace DFH.Desktop.Tests;

public class PracticeResultTests
{
    [Theory]
    [InlineData(PracticeMode.Rhythm, true)]
    [InlineData(PracticeMode.Step, false)]
    public void ResultIsASnapshotAndDistinguishesScoringFromPractice(PracticeMode mode, bool completed)
    {
        var note = new GameNote { Note = new NoteEvent { Start = 1000, Duration = 300, Pitch = 60 },
            Candidate = Mapping.CandidatesForPitch(60)[0], SourceIndex = 0 };
        var score = new PracticeScore();
        score.Reset([note], mode);
        var input = new PracticeInput(note.Key[0], 0, note.OctaveModifier < 0, note.OctaveModifier > 0, note.Sharp, IntPtr.Zero);
        score.Press(input, 1030, 0, 300);
        var result = PracticeResult.Capture("测试曲", score, completed);
        score.Clear();
        Assert.Equal("测试曲", result.Title);
        Assert.Equal("100.0%", result.Accuracy);
        Assert.Equal("1", result.Combo);
        Assert.Equal(completed ? "已完成" : "提前结束 · 仅统计已演奏部分", result.Completion);
        if (mode == PracticeMode.Rhythm)
        {
            Assert.Equal("计分模式", result.Mode);
            Assert.Equal("本次得分", result.MainLabel);
            Assert.Contains("Perfect 1", result.Judgments);
            Assert.Contains("30.0", result.Timing);
        }
        else
        {
            Assert.Equal("练习模式", result.Mode);
            Assert.Equal("正确音符", result.MainLabel);
            Assert.Contains("300", result.Timing);
            Assert.DoesNotContain("Perfect", result.Judgments);
        }
    }
}
