using DFH.Core;
using DFH.Core.Harmonica;
using DFH.Core.Music;
using DFH.Core.Persistence;
using DFH.Desktop.Services;
using Xunit;

namespace DFH.Desktop.Tests;

public class VisualPlaybackTests
{
    [Theory]
    [InlineData(1000)]
    [InlineData(3250)]
    public void PauseFreezesCountdownOrLongNoteAndResumePreservesPosition(double advance)
    {
        double now = 0;
        var playback = new VisualPlayback(() => now);
        playback.Load([Note(0, 1000)]);
        playback.Start(3);
        now += advance;
        var position = playback.ElapsedMs;
        var index = playback.CurrentIndex();
        playback.TogglePause();
        now += 10000;
        Assert.True(playback.IsBusy);
        Assert.True(playback.IsPaused);
        Assert.Equal(position, playback.ElapsedMs);
        Assert.Equal(index, playback.CurrentIndex());
        Assert.False(playback.FinishIfDue());
        playback.TogglePause();
        Assert.False(playback.IsPaused);
        Assert.Equal(position, playback.ElapsedMs);
        now += 100;
        Assert.Equal(position + 100, playback.ElapsedMs);
        playback.TogglePause();
        playback.Stop();
        Assert.False(playback.IsBusy);
        Assert.False(playback.IsPaused);
        playback.TogglePause();
        Assert.False(playback.IsPaused);
        playback.Start(3);
        Assert.Equal(-3000, playback.ElapsedMs);
    }

    private static GameNote Note(double start, double duration, int pitch = 60) => new()
    {
        Note = new NoteEvent { Start = start, Duration = duration, Pitch = pitch },
        Candidate = Mapping.CandidatesForPitch(pitch)[0], SourceIndex = 0
    };

    [Fact]
    public void ManualClockPreservesLeadInRestsAndLongNotesThenFinishes()
    {
        double now = 10000;
        var playback = new VisualPlayback(() => now);
        playback.Load([Note(0, 500), Note(1500, 4000)]);
        playback.Start(0);
        Assert.Equal(-3000, playback.ElapsedMs);
        Assert.Equal(-1, playback.CurrentIndex());
        now += 3250;
        Assert.Equal(0, playback.CurrentIndex());
        now += 500;
        Assert.Equal(-1, playback.CurrentIndex());
        now += 2000;
        Assert.Equal(1, playback.CurrentIndex());
        Assert.False(playback.FinishIfDue());
        now += 3000;
        Assert.True(playback.FinishIfDue());
        Assert.False(playback.IsBusy);
        Assert.Equal(5500, playback.ElapsedMs);
        playback.Start(5);
        Assert.Equal(-5000, playback.ElapsedMs);
    }

    [Fact]
    public void StopFreezesClockAndLoadingAnotherScoreResetsIt()
    {
        double now = 0;
        var playback = new VisualPlayback(() => now);
        playback.Load([Note(0, 1000)]);
        playback.Start(3);
        now = 3200;
        playback.Stop();
        now = 9000;
        Assert.Equal(200, playback.ElapsedMs);
        playback.Load([]);
        playback.Start(3);
        Assert.False(playback.IsBusy);
        Assert.Equal(-3000, playback.ElapsedMs);
    }

    [Fact]
    public void AutomaticNotesUseScheduledHoldsInsteadOfOriginalDenseTimings()
    {
        var snapshot = new ScoreSnapshot
        {
            Version = 1, Ppq = 480, Transpose = 0,
            Tempos = [new TempoEvent(0, 0, 120)], TimeSignatures = [], MeasureStarts = [],
            Notes = [Note(0, 50).Note, Note(50, 50, 61).Note, Note(100, 50, 62).Note]
        };
        var document = ScoreDocument.Build("dense", "test", snapshot);
        var visual = VisualPlayback.AutomaticNotes(document);
        Assert.Equal(3, visual.Count);
        var downs = document.Sequence.Actions.Where(action => action.NoteIndex >= 0 && action.Down).ToArray();
        Assert.Equal(downs.Length, visual.Count);
        for (var i = 0; i < visual.Count; i++)
        {
            var up = document.Sequence.Actions.First(action => action.NoteIndex == downs[i].NoteIndex && !action.Down);
            Assert.Equal(downs[i].Time, visual[i].Start);
            Assert.Equal(up.Time - downs[i].Time, visual[i].Duration);
            Assert.Equal(document.Notes[downs[i].NoteIndex].Candidate, visual[i].Candidate);
        }
        Assert.True(visual[1].Start > document.Notes[1].Start);
    }
}
