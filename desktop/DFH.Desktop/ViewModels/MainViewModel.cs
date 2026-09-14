using System.IO;
using System.Windows;
using System.Windows.Threading;
using DFH.Core;
using DFH.Core.Harmonica;
using DFH.Core.Library;
using DFH.Core.Midi;
using DFH.Core.Persistence;
using DFH.Desktop.Infrastructure;
using DFH.Desktop.Services;
using DFH.Desktop.Views;
using Microsoft.Win32;

namespace DFH.Desktop.ViewModels;

public sealed class MainViewModel : ObservableObject, IDisposable
{
    private readonly Dispatcher _dispatcher;
    private readonly Player _player = new();
    private readonly GlobalHotkeys _hotkeys = new();
    private readonly VisualPlayback _visual = new();
    private readonly OverlaySettings _overlaySettings = OverlaySettings.Load();
    private VisualOverlayWindow? _overlay;
    private IReadOnlyList<GameNote> _automaticNotes = [];
    private bool _autoHasStarted;
    private readonly DispatcherTimer _ticker;
    private AppSettings _settings;
    private ScoreDocument? _document;
    private string _statusMessage = "打开本站导出的 MIDI，或从曲库里选一首。";
    private string _sourceLabel = "";
    private string _stateLabel = "空闲";
    private string _hotkeyHint = "";
    private string _preflightLine = "";
    private bool _preflightOk = true;
    private double _progress;
    private string _elapsedLabel = "0:00 / 0:00";
    private int _selectedTab;

    public MainViewModel(Dispatcher dispatcher)
    {
        _dispatcher = dispatcher;
        _settings = AppSettings.Load();

        Score = new ScoreViewModel();
        LocalLibrary = new LocalLibraryViewModel(dispatcher, _settings.LocalLibraryDirectory, LoadFile, SaveLocalLibraryDirectory);
        Library = new LibraryViewModel(() => _settings.StorageBase, () => _settings.LocalLibraryDirectory, LocalLibrary.Refresh, OpenPublicScoreAsync);
        Settings = new SettingsViewModel(_settings, ApplySettings);

        OpenMidiCommand = new RelayCommand(OpenMidiDialog, () => !IsPlaying);
        StartCommand = new RelayCommand(Start, () => _document is { Notes.Count: > 0 } && !IsPlaying);
        StopCommand = new RelayCommand(Stop, () => IsPlaying);
        ShowOverlayCommand = new RelayCommand(ToggleOverlay);
        OpenWebsiteCommand = new RelayCommand(() => Links.Open(Links.WebApp));

        _player.StateChanged += state => Post(() => OnPlayerState(state));
        _player.Message += message => Post(() => StatusMessage = message);
        _player.NoteStarted += index => Post(() => Score.SetCurrent(index));
        _player.Finished += () => Post(() => { Score.SetCurrent(-1); UpdateProgress(); });

        _hotkeys.KeyDown += vk => Post(() => OnHotkey(vk));
        _hotkeys.Status += message => Post(() => StatusMessage = message);
        _hotkeys.Start();

        _ticker = new DispatcherTimer(TimeSpan.FromMilliseconds(100), DispatcherPriority.Background, (_, _) => Tick(), dispatcher);
        _ticker.Start();
        UpdateHotkeyHint();
        RefreshPreflight();
    }

    public ScoreViewModel Score { get; }
    public LocalLibraryViewModel LocalLibrary { get; }
    public LibraryViewModel Library { get; }
    public SettingsViewModel Settings { get; }

    public RelayCommand OpenMidiCommand { get; }
    public RelayCommand StartCommand { get; }
    public RelayCommand StopCommand { get; }
    public RelayCommand OpenWebsiteCommand { get; }
    public RelayCommand ShowOverlayCommand { get; }

    public bool ManualMode
    {
        get => _overlaySettings.ManualMode;
        set
        {
            if (IsPlaying || value == ManualMode) return;
            _overlaySettings.ManualMode = value;
            SaveOverlaySettings();
            Raise();
            Raise(nameof(PlaybackMode));
            Raise(nameof(StartButtonLabel));
            _overlay?.Reload();
            UpdateProgress();
            RefreshPreflight();
        }
    }
    public bool CanChangeMode => !IsPlaying;
    public int PlaybackMode
    {
        get => ManualMode ? 0 : 1;
        set => ManualMode = value == 0;
    }

    private void SaveOverlaySettings()
    {
        try { _overlaySettings.Save(); }
        catch (Exception reason) { StatusMessage = $"悬浮窗设置保存失败：{reason.Message}"; }
    }

    public double OverlayBackgroundTransparency
    {
        get => _overlaySettings.BackgroundTransparency;
        set
        {
            _overlaySettings.BackgroundTransparency = value;
            Raise();
            _overlay?.ApplyAppearance();
            SaveOverlaySettings();
        }
    }

    public double OverlayFlowSpeed
    {
        get => _overlaySettings.FlowSpeed;
        set
        {
            _overlaySettings.FlowSpeed = value;
            Raise();
            _overlay?.ApplyAppearance();
            SaveOverlaySettings();
        }
    }

    private void ToggleOverlay()
    {
        if (_overlay?.IsVisible == true) _overlay.Hide();
        else ShowOverlay();
    }

    private void ShowOverlay()
    {
        if (_overlay != null) { _overlay.Show(); return; }
        _overlay = new VisualOverlayWindow(() => IsPlaying,
            () => ManualMode ? _visual.ElapsedMs : _autoHasStarted ? _player.VisualElapsedMs : -NoteFallView.LookAheadMs,
            () => ManualMode ? _visual.Notes : _automaticNotes,
            () => ManualMode, _overlaySettings, SaveOverlaySettings, () => HotkeyHint);
        _overlay.Closed += (_, _) => { _overlay = null; if (_visual.IsBusy) Stop(); };
        _overlay.Show();
    }

    public string Title => _document?.Title ?? "未载入谱面";
    public bool HasDocument => _document != null;
    public bool IsLegacy => _document?.Legacy == true;

    public string StatusMessage { get => _statusMessage; private set => Set(ref _statusMessage, value); }
    public string SourceLabel { get => _sourceLabel; private set => Set(ref _sourceLabel, value); }
    public string StateLabel { get => _stateLabel; private set => Set(ref _stateLabel, value); }
    public string HotkeyHint { get => _hotkeyHint; private set => Set(ref _hotkeyHint, value); }
    public string PreflightLine { get => _preflightLine; private set => Set(ref _preflightLine, value); }
    public bool PreflightOk { get => _preflightOk; private set => Set(ref _preflightOk, value); }
    public double Progress { get => _progress; private set => Set(ref _progress, value); }
    public string ElapsedLabel { get => _elapsedLabel; private set => Set(ref _elapsedLabel, value); }
    public bool IsPlaying => _player.IsBusy || _visual.IsBusy;

    public int SelectedTab
    {
        get => _selectedTab;
        set
        {
            if (Set(ref _selectedTab, value) && value == 1) _ = Library.EnsureLoadedAsync();
        }
    }

    public string StartButtonLabel => $"{(ManualMode ? "开始下落" : "开始演奏")} ({GlobalHotkeys.KeyName(_settings.StartHotkey)})";
    public string StopButtonLabel => $"停止 ({GlobalHotkeys.KeyName(_settings.StartHotkey)})";

    private void Post(Action action)
    {
        if (_dispatcher.CheckAccess()) action();
        else _dispatcher.BeginInvoke(action);
    }

    // ---------------- loading ----------------

    private void OpenMidiDialog()
    {
        var dialog = new OpenFileDialog
        {
            Title = "打开本站导出的 MIDI",
            Filter = "MIDI 文件 (*.mid;*.midi)|*.mid;*.midi|所有文件|*.*",
            InitialDirectory = Directory.Exists(_settings.LastMidiDirectory) ? _settings.LastMidiDirectory : ""
        };
        if (dialog.ShowDialog() == true) LoadFile(dialog.FileName);
    }

    public void LoadFile(string path)
    {
        if (IsPlaying)
        {
            StatusMessage = "播放中不能换谱，请先停止。";
            return;
        }
        try
        {
            var score = DfhMidiReader.Read(path);
            SetDocument(ScoreDocument.Build(score.Title, path, score.Snapshot, _settings.ToKeySequenceOptions(), score.Legacy));
            SourceLabel = $"本地文件 · {path}";
            StatusMessage = score.Legacy
                ? "这是旧版导出的 MIDI，没有谱面快照，指法按音高重新推算，可能和网页显示略有差别。"
                : $"已打开「{score.Title}」。";
            _settings.LastMidiDirectory = Path.GetDirectoryName(path) ?? "";
            try { _settings.Save(); } catch { /* remembering the folder is optional */ }
            SelectedTab = 0;
        }
        catch (NotSiteExportException reason)
        {
            StatusMessage = reason.Message;
        }
        catch (Exception reason)
        {
            StatusMessage = $"打开失败：{reason.Message}";
        }
    }

    private Task OpenPublicScoreAsync(PublicScore score)
    {
        if (IsPlaying)
        {
            StatusMessage = "播放中不能换谱，请先停止。";
            return Task.CompletedTask;
        }
        SetDocument(ScoreDocument.Build(score.Entry.Title, $"library:{score.Entry.Id}", score.Snapshot, _settings.ToKeySequenceOptions()));
        var by = score.Entry.Composer.Length > 0 ? $"{score.Entry.Composer} · " : "";
        SourceLabel = $"曲库 · {by}{score.Entry.Uploader} 上传 · ID {score.Entry.Id}";
        StatusMessage = $"已打开「{score.Entry.Title}」。";
        return Task.CompletedTask;
    }

    private void SetDocument(ScoreDocument document)
    {
        _document = document;
        _visual.Load(document.Notes);
        _automaticNotes = VisualPlayback.AutomaticNotes(document);
        _autoHasStarted = false;
        _overlay?.Reload();
        Score.Load(document);
        Raise(nameof(Title));
        Raise(nameof(HasDocument));
        Raise(nameof(IsLegacy));
        UpdateProgress();
        StartCommand.RaiseCanExecuteChanged();
    }

    // ---------------- playback ----------------

    private void Start()
    {
        if (_document == null || IsPlaying) return;
        if (ManualMode)
        {
            ShowOverlay();
            Score.SetCurrent(-1);
            _visual.Start(_settings.CountdownSeconds);
            StatusMessage = "手动可视化已开始，切回游戏后按下落音符自行演奏。";
            OnPlayerState(PlayerState.Countdown);
            return;
        }
        var report = Preflight.Run();
        if (!report.Elevated)
        {
            StatusMessage = "当前没有管理员权限。游戏以管理员运行时按键会被系统拦截，请右键以管理员身份重新启动。";
        }
        Score.SetCurrent(-1);
        _autoHasStarted = true;
        _player.Start(_document.Sequence, new PlayerOptions(_settings.CountdownSeconds, _settings.StopWhenForegroundChanges));
        if (_settings.MinimizeOnPlay && Application.Current.MainWindow != null)
        {
            Application.Current.MainWindow.WindowState = WindowState.Minimized;
        }
    }

    private void Stop()
    {
        if (_visual.IsBusy)
        {
            _visual.Stop();
            Score.SetCurrent(-1);
            OnPlayerState(PlayerState.Idle);
            UpdateProgress();
        }
        else _player.Stop();
    }

    private void OnHotkey(int vk)
    {
        if (vk == _settings.StopHotkey)
        {
            ToggleOverlay();
        }
        else if (vk == _settings.StartHotkey)
        {
            if (IsPlaying) Stop();
            else if (StartCommand.CanExecute(null)) Start();
        }
    }

    private void OnPlayerState(PlayerState state)
    {
        StateLabel = state switch
        {
            PlayerState.Countdown => "倒计时",
            PlayerState.Playing => "演奏中",
            _ => "空闲"
        };
        Raise(nameof(IsPlaying));
        Raise(nameof(CanChangeMode));
        ShowOverlayCommand.RaiseCanExecuteChanged();
        StartCommand.RaiseCanExecuteChanged();
        StopCommand.RaiseCanExecuteChanged();
        OpenMidiCommand.RaiseCanExecuteChanged();
        if (!ManualMode && state == PlayerState.Idle && _settings.MinimizeOnPlay && Application.Current.MainWindow is { WindowState: WindowState.Minimized } window)
        {
            window.WindowState = WindowState.Normal;
        }
    }

    private void Tick()
    {
        if (_visual.IsBusy)
        {
            if (_visual.FinishIfDue())
            {
                Score.SetCurrent(-1);
                OnPlayerState(PlayerState.Idle);
                StatusMessage = "手动可视化结束，可再次开始。";
            }
            else
            {
                StateLabel = _visual.ElapsedMs < 0 ? $"倒计时 {Math.Ceiling(-_visual.ElapsedMs / 1000):0}" : "手动演奏中";
                Score.SetCurrent(_visual.CurrentIndex());
            }
            UpdateProgress();
        }
        else if (_player.IsBusy) UpdateProgress();
        RefreshPreflight();
    }

    private void UpdateProgress()
    {
        var total = ManualMode ? _visual.DurationMs : _document?.DurationMs ?? 0;
        var elapsed = Math.Clamp(ManualMode ? _visual.ElapsedMs : _player.ElapsedMs, 0, total);
        Progress = total > 0 ? elapsed / total : 0;
        ElapsedLabel = $"{Clock(elapsed)} / {Clock(total)}";
    }

    private static string Clock(double ms)
    {
        var seconds = (int)(ms / 1000);
        return $"{seconds / 60}:{seconds % 60:00}";
    }

    private void RefreshPreflight()
    {
        if (ManualMode)
        {
            PreflightOk = true;
            PreflightLine = "手动可视化 · 仅显示提示 · 使用游戏的无边框或窗口模式显示悬浮窗";
            return;
        }
        var report = Preflight.Run();
        var front = report.Foreground.Title.Length > 0 ? report.Foreground.Title : "无";
        PreflightOk = report.Elevated && report.ImeSafe;
        PreflightLine = $"{report.ElevationText} · {report.ImeText} · 前台：{Truncate(front, 40)}";
    }

    private static string Truncate(string value, int max) => value.Length <= max ? value : value[..max] + "…";

    // ---------------- settings ----------------

    private void ApplySettings(AppSettings settings)
    {
        _settings = settings;
        LocalLibrary.SetDirectory(settings.LocalLibraryDirectory);
        UpdateHotkeyHint();
        if (_document != null && !IsPlaying)
        {
            SetDocument(_document.WithOptions(settings.ToKeySequenceOptions()));
            StatusMessage = "设置已生效，按键时序已按新参数重新生成。";
        }
    }

    private void SaveLocalLibraryDirectory(string directory)
    {
        _settings.LocalLibraryDirectory = directory;
        Settings.SetLocalLibraryDirectory(directory);
        try { _settings.Save(); }
        catch (Exception reason) { StatusMessage = $"曲库目录已切换，但保存设置失败：{reason.Message}"; }
    }

    private void UpdateHotkeyHint()
    {
        HotkeyHint = $"{GlobalHotkeys.KeyName(_settings.StartHotkey)} 开始 / 结束 · {GlobalHotkeys.KeyName(_settings.StopHotkey)} 隐藏 / 显示悬浮窗 · 游戏内也能按";
        Raise(nameof(StartButtonLabel));
        Raise(nameof(StopButtonLabel));
    }

    public void Dispose()
    {
        _ticker.Stop();
        _visual.Stop();
        _overlay?.Close();
        _player.Dispose();
        _hotkeys.Dispose();
        LocalLibrary.Dispose();
    }
}
