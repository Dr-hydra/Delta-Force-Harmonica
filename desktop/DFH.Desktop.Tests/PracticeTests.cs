using DFH.Core.Harmonica;
using DFH.Core.Music;
using DFH.Desktop.Services;
using Xunit;

namespace DFH.Desktop.Tests;

public class PracticeTests
{
    private static GameNote Note(double start, double duration = 200, int pitch = 60) => new()
    {
        Note = new NoteEvent { Start = start, Duration = duration, Pitch = pitch },
        Candidate = Mapping.CandidatesForPitch(pitch)[0], SourceIndex = 0
    };
    private static PracticeInput Input(GameNote note, double timestamp = 0) => new(
        note.Key == "," ? 0xBC : note.Key[0], timestamp, note.OctaveModifier < 0, note.OctaveModifier > 0, note.Sharp, new IntPtr(42));

    [Theory]
    [InlineData(-150, NoteJudgment.Good)]
    [InlineData(-50, NoteJudgment.Perfect)]
    [InlineData(0, NoteJudgment.Perfect)]
    [InlineData(50, NoteJudgment.Perfect)]
    [InlineData(150, NoteJudgment.Good)]
    public void RhythmWindowsAreInclusiveAndErrorsKeepTheirSign(double offset, NoteJudgment expected)
    {
        var note = Note(500);
        var score = new PracticeScore();
        score.Reset([note], PracticeMode.Rhythm);
        Assert.True(score.Press(Input(note), 500 + offset));
        Assert.Equal(expected, score.Judgments[0]);
        Assert.Equal(offset, score.LastErrorMs);
        Assert.Equal(Math.Abs(offset), score.MeanAbsoluteErrorMs);
    }

    [Fact]
    public void SignedMeanDoesNotHideAbsoluteErrorAndMissesDoNotInventSamples()
    {
        var score = new PracticeScore();
        var notes = new[] { Note(500), Note(1000), Note(1500) };
        score.Reset(notes, PracticeMode.Rhythm);
        score.Press(Input(notes[0]), 460);
        score.Press(Input(notes[1]), 1060);
        score.Advance(1651);
        Assert.Equal(10, score.MeanErrorMs);
        Assert.Equal(50, score.MeanAbsoluteErrorMs);
        Assert.Equal(50, score.StandardDeviationMs);
        Assert.Equal(60, score.MaxAbsoluteErrorMs);
        Assert.Equal(2, score.Hits);
        Assert.Equal(1, score.Misses);
        Assert.Equal(1500, score.Points);
        Assert.Equal(0, score.Combo);
        Assert.Equal(2, score.MaxCombo);
        Assert.Equal(200d / 3, score.Accuracy, 6);
        Assert.Null(score.LastErrorMs);
    }

    [Fact]
    public void RepeatedOrWrongKeysCannotScoreTheSameNoteTwice()
    {
        var note = Note(1000, pitch: 73);
        var score = new PracticeScore();
        score.Reset([note], PracticeMode.Rhythm);
        Assert.False(score.Press(Input(note) with { Middle = false }, 1000));
        Assert.False(score.Press(Input(note) with { Left = true, Right = true }, 1000));
        Assert.True(score.Press(Input(note), 1000));
        Assert.False(score.Press(Input(note), 1000));
        Assert.Equal(1, score.Hits);
        Assert.Equal(3, score.WrongPresses);
        Assert.Equal(25, score.Accuracy);
    }

    [Fact]
    public void DenseNotesMatchTheNearestUnjudgedFingeringAndMissOnlyOnce()
    {
        var notes = new[] { Note(1000), Note(1100), Note(1200, pitch: 62) };
        var score = new PracticeScore();
        score.Reset(notes, PracticeMode.Rhythm);
        Assert.True(score.Press(Input(notes[0]), 1080));
        Assert.Equal(NoteJudgment.Perfect, score.Judgments[1]);
        score.Advance(2000);
        score.Advance(3000);
        Assert.Equal(2, score.Misses);
        Assert.Equal(1, score.Hits);
    }

    [Fact]
    public void StepWaitsForCorrectFingeringThenAdvancesOneNoteAndExcludesPauseFromReaction()
    {
        double now = 0;
        var playback = new VisualPlayback(() => now);
        var first = Note(0);
        var second = Note(1000, pitch: 62);
        playback.Load([first, second]);
        playback.Start(3, PracticeMode.Step);
        now = 2000;
        Assert.False(playback.Press(Input(first, now)));
        now = 3400;
        Assert.True(playback.WaitingForNote);
        Assert.Equal(0, playback.ElapsedMs);
        Assert.False(playback.Press(Input(second, now)));
        Assert.Equal(0, playback.StepIndex);
        playback.TogglePause();
        now = 13400;
        Assert.False(playback.Press(Input(first, now)));
        playback.TogglePause();
        now = 13500;
        Assert.True(playback.Press(Input(first, now)));
        Assert.Equal(500, playback.Score.LastReactionMs);
        Assert.Equal(1, playback.StepIndex);
        now = 14000;
        Assert.Equal(500, playback.ElapsedMs);
        Assert.False(playback.Press(Input(second, now)));
        now = 15000;
        Assert.True(playback.Press(Input(second, now)));
        Assert.Equal(2, playback.Score.Hits);
        Assert.Equal(1, playback.Score.WrongPresses);
        Assert.Null(playback.Score.LastErrorMs);
        now = 15300;
        Assert.True(playback.FinishIfDue());
        Assert.False(playback.IsBusy);
        Assert.Equal(2, playback.Score.Hits);
    }

    [Fact]
    public void TimestampNotUiDelayDeterminesErrorAndPauseFreezesRhythmScoring()
    {
        double now = 0;
        var playback = new VisualPlayback(() => now);
        var note = Note(500);
        playback.Load([note]);
        playback.Start(3, PracticeMode.Rhythm);
        now = 3600; // UI handles the physical 3520 ms event 80 ms later.
        Assert.True(playback.Press(Input(note, 3520)));
        Assert.Equal(20, playback.Score.LastErrorMs);
        playback.TogglePause();
        now += 10000;
        Assert.False(playback.FinishIfDue());
        Assert.False(playback.Press(Input(note, now)));
        Assert.Equal(0, playback.Score.WrongPresses);
        playback.TogglePause();
        now += 200;
        Assert.True(playback.FinishIfDue());
        playback.Start(3, PracticeMode.Rhythm);
        Assert.Equal(0, playback.Score.Hits);
        Assert.Null(playback.Score.LastErrorMs);
    }

    [Fact]
    public void FinalShortNoteGetsFullLateWindowAndStoppingDoesNotMarkFutureNotesMissed()
    {
        double now = 0;
        var playback = new VisualPlayback(() => now);
        var note = Note(0, 20);
        playback.Load([note]);
        playback.Start(3, PracticeMode.Rhythm);
        now = 3100;
        Assert.False(playback.FinishIfDue());
        Assert.True(playback.Press(Input(note, 3100)));
        now = 3151;
        Assert.True(playback.FinishIfDue());
        playback.Load([Note(5000)]);
        playback.Start(3, PracticeMode.Rhythm);
        playback.Stop();
        now += 10000;
        Assert.False(playback.FinishIfDue());
        Assert.Equal(0, playback.Score.Misses);
    }

    [Fact]
    public void FreeVisualModeNeverScores()
    {
        double now = 0;
        var playback = new VisualPlayback(() => now);
        var note = Note(0);
        playback.Load([note]);
        playback.Start(3);
        now = 3000;
        Assert.False(playback.Press(Input(note, now)));
        Assert.False(playback.Score.HasSession);
    }
}
