using System.Collections.Concurrent;
using System.Diagnostics;
using DFH.Core.Export;
using DFH.Desktop.Services;
using Xunit;

namespace DFH.Desktop.Tests;

public class PlayerTests
{
    private sealed record Sent(double AtMs, InputTarget Target, bool Down);

    private static KeySequence Sequence(params (double Time, string Key, bool Down)[] steps)
    {
        var actions = steps.Select((step, index) => new InputAction(step.Time, InputTarget.Key(step.Key), step.Down, index / 2)).ToList();
        return new KeySequence
        {
            Actions = actions,
            DurationMs = actions.Count > 0 ? actions[^1].Time : 0,
            Binding = InputBinding.Game,
            NoteCount = actions.Count / 2,
            DroppedChordNotes = 0,
            TruncatedNotes = 0,
            ModifierPresses = 0
        };
    }

    private static readonly ForegroundInfo Window = new(new IntPtr(42), "game", "game");

    [Fact]
    public void Plays_actions_in_order_and_close_to_schedule()
    {
        var sent = new ConcurrentQueue<Sent>();
        var clock = new Stopwatch();
        var player = new Player((target, down) => sent.Enqueue(new Sent(clock.Elapsed.TotalMilliseconds, target, down)), () => Window);
        var finished = new ManualResetEventSlim();
        var started = new List<int>();
        player.StateChanged += state => { if (state == PlayerState.Playing) clock.Start(); };
        player.NoteStarted += started.Add;
        player.Finished += finished.Set;

        player.Start(Sequence((0, "z", true), (120, "z", false), (150, "x", true), (300, "x", false), (330, "comma", true), (420, "comma", false)), new PlayerOptions(0, false));

        Assert.True(finished.Wait(5000), "playback did not finish");
        var list = sent.ToList();
        // Leading and trailing release-all, then the six scheduled events in order.
        var scheduled = list.Skip(InputBinding.Game.AllTargets().Count).Take(6).ToList();
        Assert.Equal(new[] { "key:z", "key:z", "key:x", "key:x", "key:comma", "key:comma" }, scheduled.Select(item => item.Target.Id));
        Assert.Equal(new[] { true, false, true, false, true, false }, scheduled.Select(item => item.Down));
        var expected = new[] { 0, 120, 150, 300, 330, 420 };
        for (var i = 0; i < expected.Length; i++)
        {
            Assert.True(scheduled[i].AtMs >= expected[i] - 2, $"event {i} fired early at {scheduled[i].AtMs:0.0}");
            Assert.True(scheduled[i].AtMs <= expected[i] + 25, $"event {i} fired late at {scheduled[i].AtMs:0.0}");
        }
        Assert.Equal(new[] { 0, 1, 2 }, started);
        Assert.Equal(PlayerState.Idle, player.State);
    }

    [Fact]
    public void Stop_releases_everything_and_sends_nothing_more()
    {
        var sent = new ConcurrentQueue<Sent>();
        var player = new Player((target, down) => sent.Enqueue(new Sent(0, target, down)), () => Window);
        var finished = new ManualResetEventSlim();
        var firstNote = new ManualResetEventSlim();
        player.NoteStarted += _ => firstNote.Set();
        player.Finished += finished.Set;

        player.Start(Sequence((0, "z", true), (2000, "z", false), (2100, "x", true), (2500, "x", false)), new PlayerOptions(0, false));
        Assert.True(firstNote.Wait(3000));
        player.Stop();
        Assert.True(finished.Wait(3000), "stop did not finish playback");

        var list = sent.ToList();
        Assert.DoesNotContain(list, item => item.Target.Id == "key:x" && item.Down);
        // The tail is a release of every bound input.
        var tail = list.TakeLast(InputBinding.Game.AllTargets().Count).ToList();
        Assert.All(tail, item => Assert.False(item.Down));
        Assert.Equal(InputBinding.Game.AllTargets().Select(target => target.Id).OrderBy(id => id), tail.Select(item => item.Target.Id).OrderBy(id => id));
    }

    [Fact]
    public void Countdown_can_be_cancelled_before_anything_is_sent()
    {
        var sent = new ConcurrentQueue<Sent>();
        var player = new Player((target, down) => sent.Enqueue(new Sent(0, target, down)), () => Window);
        var finished = new ManualResetEventSlim();
        var countdown = new ManualResetEventSlim();
        player.StateChanged += state => { if (state == PlayerState.Countdown) countdown.Set(); };
        player.Finished += finished.Set;

        player.Start(Sequence((0, "z", true), (100, "z", false)), new PlayerOptions(5, false));
        Assert.True(countdown.Wait(2000));
        player.Stop();
        Assert.True(finished.Wait(3000));

        // Only the safety release-all from the finally block; no scheduled press.
        Assert.DoesNotContain(sent, item => item.Down);
    }

    [Fact]
    public void Foreground_change_aborts_playback()
    {
        var sent = new ConcurrentQueue<Sent>();
        var current = Window;
        var player = new Player((target, down) => sent.Enqueue(new Sent(0, target, down)), () => current);
        var finished = new ManualResetEventSlim();
        var messages = new ConcurrentQueue<string>();
        player.Message += messages.Enqueue;
        player.Finished += finished.Set;
        player.NoteStarted += _ => current = new ForegroundInfo(new IntPtr(7), "other", "other");

        player.Start(Sequence((0, "z", true), (1500, "z", false), (1600, "x", true), (1700, "x", false)), new PlayerOptions(0, true));
        Assert.True(finished.Wait(4000));

        Assert.DoesNotContain(sent, item => item.Target.Id == "key:x" && item.Down);
        Assert.Contains(messages, message => message.Contains("前台窗口切换"));
    }
}
