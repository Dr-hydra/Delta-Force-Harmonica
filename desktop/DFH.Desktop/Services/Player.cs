using System.Diagnostics;
using System.Runtime.InteropServices;
using DFH.Core.Export;

namespace DFH.Desktop.Services;

public enum PlayerState { Idle, Countdown, Playing, Paused }

public sealed record PlayerOptions(int CountdownSeconds, bool StopWhenForegroundChanges, double ModifierLeadMs = 40);

/// <summary>
/// Executes a key sequence on a dedicated high-priority thread. Events carry
/// absolute millisecond times; the loop sleeps in short slices and spins the last
/// moment so a press lands within a millisecond or two of schedule. The game
/// samples input per frame, so nothing finer is needed. Any stop path releases
/// every input first: the harmonica must never be left sounding.
/// Events are raised on the worker thread, except the initial countdown state.
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
    private double _countdownElapsedMs;
    private volatile bool _pauseRequested;

    public event Action<PlayerState>? StateChanged;
    /// <summary>Index of the game note whose key just went down.</summary>
    public event Action<int>? NoteStarted;
    public event Action<string>? Message;
    public event Action? Finished;

    public PlayerState State => _state;
    public double ElapsedMs => Volatile.Read(ref _elapsedMs);
    public double VisualElapsedMs => Volatile.Read(ref _countdownElapsedMs) < 0 ? Volatile.Read(ref _countdownElapsedMs) : ElapsedMs;
    public double DurationMs => _durationMs;
    public bool IsBusy => _state != PlayerState.Idle;

    public void Start(KeySequence sequence, PlayerOptions options)
    {
        lock (_gate)
        {
            if (_thread is { IsAlive: true }) return;
            _stop.Reset();
            _pauseRequested = false;
            _elapsedMs = 0;
            _durationMs = sequence.DurationMs;
            _countdownElapsedMs = -Math.Max(0, options.CountdownSeconds) * 1000d;
            _thread = new Thread(() => Worker(sequence, options))
            {
                IsBackground = true,
                Name = "DFH playback",
                Priority = ThreadPriority.Highest
            };
            SetState(PlayerState.Countdown);
            _thread.Start();
        }
    }

    public void Stop()
    {
        _stop.Set();
    }

    public void TogglePause()
    {
        lock (_gate)
        {
            if (IsBusy && !_stop.IsSet) _pauseRequested = !_pauseRequested;
        }
    }

    /// <summary>Wait for the worker's final releases before replacing its score.</summary>
    public async Task<bool> StopAsync()
    {
        Stop();
        var worker = _thread;
        return worker == null || await Task.Run(() => worker.Join(2000));
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
        var held = new HashSet<InputTarget>();
        ForegroundInfo? target = null;

        bool WaitForResume(Stopwatch clock, PlayerState resumeState)
        {
            if (_stop.IsSet) return false;
            while (_pauseRequested)
            {
                clock.Stop();
                if (resumeState == PlayerState.Countdown)
                    Volatile.Write(ref _countdownElapsedMs, clock.Elapsed.TotalMilliseconds - options.CountdownSeconds * 1000d);
                else Volatile.Write(ref _elapsedMs, clock.Elapsed.TotalMilliseconds);
                ReleaseAll(binding);
                SetState(PlayerState.Paused);
                Message?.Invoke("已暂停，再按暂停 / 继续热键接着播放");
                while (_pauseRequested)
                    if (_stop.Wait(10)) return false;
                if (_stop.IsSet) return false;
                if (target != null && options.StopWhenForegroundChanges && _foreground().Handle != target.Handle)
                {
                    Message?.Invoke("前台窗口切换，已停止播放");
                    return false;
                }
                // Restore pitch modifiers before the sustained note, with the configured lead time.
                foreach (var input in held.Where(input => input.Kind == InputKind.Mouse)) _send(input, true);
                if (held.Any(input => input.Kind == InputKind.Mouse) && _stop.Wait((int)Math.Clamp(options.ModifierLeadMs, 0, 500))) return false;
                lock (_gate)
                {
                    if (_stop.IsSet) return false;
                    if (_pauseRequested) continue;
                    if (target != null && options.StopWhenForegroundChanges && _foreground().Handle != target.Handle)
                    {
                        Message?.Invoke("前台窗口切换，已停止播放");
                        return false;
                    }
                    foreach (var input in held.Where(input => input.Kind == InputKind.Key)) _send(input, true);
                }
                clock.Start();
                SetState(resumeState);
                Message?.Invoke(resumeState == PlayerState.Countdown ? "倒计时继续，请切换到游戏窗口" : "已继续播放");
            }
            return true;
        }
        try
        {
            var countdownClock = Stopwatch.StartNew();
            for (var remaining = options.CountdownSeconds; remaining > 0; remaining--)
            {
                Message?.Invoke($"{remaining} 秒后开始，请切换到游戏窗口");
                var deadline = (options.CountdownSeconds - remaining + 1) * 1000d;
                while (countdownClock.Elapsed.TotalMilliseconds < deadline)
                {
                    if (!WaitForResume(countdownClock, PlayerState.Countdown)) { stoppedEarly = true; return; }
                    Volatile.Write(ref _countdownElapsedMs, countdownClock.Elapsed.TotalMilliseconds - options.CountdownSeconds * 1000d);
                    if (_stop.Wait(10))
                    {
                        stoppedEarly = true;
                        return;
                    }
                }
            }

            if (!WaitForResume(countdownClock, PlayerState.Countdown)) { stoppedEarly = true; return; }
            Volatile.Write(ref _countdownElapsedMs, 0);
            target = _foreground();
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
                    if (!WaitForResume(clock, PlayerState.Playing)) { stoppedEarly = true; return; }
                    var now = clock.Elapsed.TotalMilliseconds;
                    Volatile.Write(ref _elapsedMs, now);
                    var remaining = action.Time - now;
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

                    if (remaining <= 0)
                    {
                        lock (_gate)
                        {
                            if (_pauseRequested) continue;
                            if (_stop.IsSet) { stoppedEarly = true; return; }
                            _send(action.Target, action.Down);
                            if (action.Down) held.Add(action.Target);
                            else held.Remove(action.Target);
                        }
                        if (action.Down && action.NoteIndex >= 0) NoteStarted?.Invoke(action.NoteIndex);
                        break;
                    }

                    if (remaining > 2) _stop.Wait((int)Math.Min(remaining - 1, 20));
                    else Thread.SpinWait(50);
                }

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
            _pauseRequested = false;
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
