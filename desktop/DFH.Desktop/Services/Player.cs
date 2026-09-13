using System.Diagnostics;
using System.Runtime.InteropServices;
using DFH.Core.Export;

namespace DFH.Desktop.Services;

public enum PlayerState { Idle, Countdown, Playing }

public sealed record PlayerOptions(int CountdownSeconds, bool StopWhenForegroundChanges);

/// <summary>
/// Executes a key sequence on a dedicated high-priority thread. Events carry
/// absolute millisecond times; the loop sleeps in short slices and spins the last
/// moment so a press lands within a millisecond or two of schedule. The game
/// samples input per frame, so nothing finer is needed. Any stop path releases
/// every input first: the harmonica must never be left sounding.
/// All events are raised on the worker thread.
/// </summary>
public sealed class Player : IDisposable
{
    [DllImport("winmm.dll")] private static extern uint timeBeginPeriod(uint ms);
    [DllImport("winmm.dll")] private static extern uint timeEndPeriod(uint ms);

    private readonly Action<InputTarget, bool> _send;
    private readonly Func<ForegroundInfo> _foreground;
    private readonly object _gate = new();

    /// <param name="send">Input sink; defaults to SendInput. Tests pass a recorder.</param>
    /// <param name="foreground">Foreground window probe; defaults to the real one.</param>
    public Player(Action<InputTarget, bool>? send = null, Func<ForegroundInfo>? foreground = null)
    {
        _send = send ?? InputSender.Send;
        _foreground = foreground ?? Preflight.ForegroundWindow;
    }

    private void ReleaseAll(InputBinding binding)
    {
        foreach (var target in binding.AllTargets()) _send(target, false);
    }
    private readonly ManualResetEventSlim _stop = new(false);
    private Thread? _thread;
    private volatile PlayerState _state = PlayerState.Idle;
    private double _elapsedMs;
    private double _durationMs;

    public event Action<PlayerState>? StateChanged;
    /// <summary>Index of the game note whose key just went down.</summary>
    public event Action<int>? NoteStarted;
    public event Action<string>? Message;
    public event Action? Finished;

    public PlayerState State => _state;
    public double ElapsedMs => Volatile.Read(ref _elapsedMs);
    public double DurationMs => _durationMs;
    public bool IsBusy => _state != PlayerState.Idle;

    public void Start(KeySequence sequence, PlayerOptions options)
    {
        lock (_gate)
        {
            if (_thread is { IsAlive: true }) return;
            _stop.Reset();
            _elapsedMs = 0;
            _durationMs = sequence.DurationMs;
            _thread = new Thread(() => Worker(sequence, options))
            {
                IsBackground = true,
                Name = "DFH playback",
                Priority = ThreadPriority.Highest
            };
            _thread.Start();
        }
    }

    public void Stop()
    {
        _stop.Set();
    }

    private void SetState(PlayerState state)
    {
        _state = state;
        StateChanged?.Invoke(state);
    }

    private void Worker(KeySequence sequence, PlayerOptions options)
    {
        var binding = sequence.Binding;
        var stoppedEarly = false;
        try
        {
            SetState(PlayerState.Countdown);
            for (var remaining = options.CountdownSeconds; remaining > 0; remaining--)
            {
                Message?.Invoke($"{remaining} 秒后开始，请切换到游戏窗口");
                if (_stop.Wait(1000))
                {
                    stoppedEarly = true;
                    return;
                }
            }

            var target = _foreground();
            Message?.Invoke(target.Title.Length > 0 ? $"发送到：{target.Title}" : "发送到当前前台窗口");

            ReleaseAll(binding);
            SetState(PlayerState.Playing);
            timeBeginPeriod(1);
            var clock = Stopwatch.StartNew();
            var lastForegroundCheck = 0.0;

            foreach (var action in sequence.Actions)
            {
                // Sleep in slices until ~2 ms before the deadline, then spin.
                while (true)
                {
                    var now = clock.Elapsed.TotalMilliseconds;
                    Volatile.Write(ref _elapsedMs, now);
                    var remaining = action.Time - now;
                    if (remaining <= 0) break;

                    if (_stop.IsSet)
                    {
                        stoppedEarly = true;
                        return;
                    }

                    if (options.StopWhenForegroundChanges && now - lastForegroundCheck > 100)
                    {
                        lastForegroundCheck = now;
                        if (_foreground().Handle != target.Handle)
                        {
                            Message?.Invoke("前台窗口切换，已停止播放");
                            stoppedEarly = true;
                            return;
                        }
                    }

                    if (remaining > 2) _stop.Wait((int)Math.Min(remaining - 1, 20));
                    else Thread.SpinWait(50);
                }

                _send(action.Target, action.Down);
                if (action.Down && action.NoteIndex >= 0) NoteStarted?.Invoke(action.NoteIndex);
            }

            Volatile.Write(ref _elapsedMs, sequence.DurationMs);
            Message?.Invoke("播放完成");
        }
        catch (Exception reason)
        {
            Message?.Invoke($"播放出错：{reason.Message}");
        }
        finally
        {
            try { ReleaseAll(binding); } catch { /* releasing is best effort */ }
            timeEndPeriod(1);
            if (stoppedEarly) Message?.Invoke("已停止，所有按键已松开");
            SetState(PlayerState.Idle);
            Finished?.Invoke();
        }
    }

    public void Dispose()
    {
        Stop();
        _thread?.Join(2000);
        _stop.Dispose();
    }
}
