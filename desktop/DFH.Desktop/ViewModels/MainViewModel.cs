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
    private int _lastLibraryTab;
    private int _settingsSection;
    public bool IsPerformancePage
    {
        get => SelectedTab != 2;
        set { if (value) SelectedTab = _lastLibraryTab; }
    }
    public bool IsSettingsPage
    {
        get => SelectedTab == 2;
        set { if (value) SelectedTab = 2; }
    }
    public int SettingsSection { get => _settingsSection; set => Set(ref _settingsSection, value); }
    private bool _switchingTrack;
    private bool _disposed;
    private int _switchVersion;
    private bool _adjustingOverlay;
    private IntPtr _practiceForeground;
    private PracticeResult? _lastResult;
    private bool _showResult;
    public PracticeResult? LastResult => _lastResult;
    public bool HasResult => _lastResult != null;
    public bool ShowResult { get => _showResult; set => Set(ref _showResult, value); }
    public RelayCommand ShowResultCommand { get; }
    public RelayCommand CloseResultCommand { get; }

    public MainViewModel(Dispatcher dispatcher)
    {
        _dispatcher = dispatcher;
        _settings = AppSettings.Load();

        Score = new ScoreViewModel();
        LocalLibrary = new LocalLibraryViewModel(dispatcher, _settings.LocalLibraryDirectory, LoadFile, SaveLocalLibraryDirectory);
        Library = new LibraryViewModel(() => _settings.StorageBase, () => _settings.LocalLibraryDirectory, LocalLibrary.Refresh, OpenPublicScoreAsync);
        Settings = new SettingsViewModel(_settings, ApplySettings);
        ShowResultCommand = new RelayCommand(() => ShowResult = true, () => HasResult && !IsPlaying);
        CloseResultCommand = new RelayCommand(() => ShowResult = false);

        OpenMidiCommand = new RelayCommand(OpenMidiDialog, () => !IsPlaying && !_switchingTrack);
        StartCommand = new RelayCommand(Start, () => _document is { Notes.Count: > 0 } && !IsPlaying && !_switchingTrack);
        StopCommand = new RelayCommand(Stop, () => IsPlaying || _switchingTrack);
        PauseCommand = new RelayCommand(TogglePause, () => IsPlaying && !_switchingTrack);
        PreviousCommand = new RelayCommand(() => _ = SwitchTrackAsync(-1), () => CanSwitchTrack);
        NextCommand = new RelayCommand(() => _ = SwitchTrackAsync(1), () => CanSwitchTrack);
        LocalLibrary.Entries.CollectionChanged += (_, _) => RefreshTrackCommands();
        ShowOverlayCommand = new RelayCommand(ToggleOverlay);
        AdjustOverlayCommand = new RelayCommand(() => SetOverlayAdjustment(!IsAdjustingOverlay));
        OpenWebsiteCommand = new RelayCommand(() => Links.Open(Links.WebApp));

        _player.StateChanged += state => Post(() => OnPlayerState(state));
        _player.Message += message => Post(() => StatusMessage = message);
        _player.NoteStarted += index => Post(() => Score.SetCurrent(index));
        _player.Finished += () => Post(() => { Score.SetCurrent(-1); UpdateProgress(); });

        _hotkeys.KeyDown += vk => Post(() => OnHotkey(vk));
        _hotkeys.NotePressed += input => Post(() => OnPracticeInput(input));
        _hotkeys.ConfigureAdjustment(_settings);
        _hotkeys.AdjustmentModeChanged += active => Post(() => SetOverlayAdjustment(active));
        _hotkeys.AdjustOverlay += adjustment => Post(() =>
        {
            if (!_disposed && IsAdjustingOverlay && _overlay?.IsVisible == true) _overlay.AdjustWithKeyboard(adjustment);
        });
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
    public RelayCommand PauseCommand { get; }
    public RelayCommand PreviousCommand { get; }
    public RelayCommand NextCommand { get; }
    private bool CanSwitchTrack => !_switchingTrack && LocalLibrary.Entries.Count > 0;
    public RelayCommand OpenWebsiteCommand { get; }
    public RelayCommand ShowOverlayCommand { get; }
    public RelayCommand AdjustOverlayCommand { get; }
    public bool IsAdjustingOverlay => _adjustingOverlay;
    public string AdjustOverlayButtonLabel => $"{(IsAdjustingOverlay ? "完成调整" : "键盘调整悬浮窗")} ({GlobalHotkeys.KeyName(_settings.AdjustOverlayHotkey)})";
    public string OverlayAdjustmentHint => $"键盘调整中 · {GlobalHotkeys.KeyName(_settings.OverlayLeftKey)} {GlobalHotkeys.KeyName(_settings.OverlayUpKey)} {GlobalHotkeys.KeyName(_settings.OverlayRightKey)} {GlobalHotkeys.KeyName(_settings.OverlayDownKey)} 移动 10 像素 · {GlobalHotkeys.KeyName(_settings.OverlayFineModifier)} 微调 1 像素 · {GlobalHotkeys.KeyName(_settings.OverlayResizeModifier)} 改宽高 · {GlobalHotkeys.KeyName(_settings.AdjustOverlayHotkey)} 完成并保存";

    public void UpdateHotkeyEditingState() => _hotkeys.AdjustmentEnabled =
        !(SelectedTab == 2 && Application.Current.MainWindow?.IsActive == true);

    private void SetOverlayAdjustment(bool active)
    {
        if (_disposed) return;
        try
        {
            if (active) ShowOverlay();
            if (active && PracticeEnabled && _visual.IsBusy && !_visual.IsPaused)
            {
                _visual.TogglePause();
                OnPlayerState(PlayerState.Paused);
            }
            _adjustingOverlay = active;
            _hotkeys.AdjustmentActive = active;
            _overlay?.SetKeyboardAdjustment(active, OverlayAdjustmentHint);
            Raise(nameof(IsAdjustingOverlay));
            Raise(nameof(AdjustOverlayButtonLabel));
            StatusMessage = active ? OverlayAdjustmentHint : "悬浮窗调整已完成，位置和尺寸已保存。" + (IsPaused ? " 按暂停 / 继续键恢复练习。" : "");
        }
        catch (Exception reason)
        {
            _adjustingOverlay = false;
            _hotkeys.AdjustmentActive = false;
            Raise(nameof(IsAdjustingOverlay));
            Raise(nameof(AdjustOverlayButtonLabel));
            StatusMessage = $"悬浮窗调整失败：{reason.Message}";
        }
    }

    public bool ManualMode
    {
        get => _overlaySettings.ManualMode;
        set
        {
            if (IsPlaying || _switchingTrack || value == ManualMode) return;
            _overlaySettings.ManualMode = value;
            SaveOverlaySettings();
            Raise();
            Raise(nameof(PlaybackMode));
            Raise(nameof(StartButtonLabel));
            _visual.Score.Clear();
            RaisePractice();
            _overlay?.Reload();
            UpdateProgress();
            RefreshPreflight();
        }
    }
    public bool CanChangeMode => !IsPlaying && !_switchingTrack;
    // A single visible mode selector replaces the nested manual/practice selectors.
    public int ExperienceMode
    {
        get => !ManualMode ? 3 : ManualPracticeMode == 2 ? 1 : ManualPracticeMode == 1 ? 2 : 0;
        set
        {
            if (!CanChangeMode || value is < 0 or > 3 || value == ExperienceMode) return;
            _overlaySettings.ManualMode = value != 3;
            _overlaySettings.ManualPracticeMode = value == 1 ? 2 : value == 2 ? 1 : 0;
            SaveOverlaySettings();
            _visual.Score.Clear();
            ShowResult = false;
            Raise(nameof(ManualMode)); Raise(nameof(ManualPracticeMode)); Raise(nameof(PlaybackMode));
            Raise(nameof(ExperienceMode)); Raise(nameof(ModeDescription)); Raise(nameof(StartButtonLabel));
            RaisePractice();
            _overlay?.Reload();
            UpdateProgress();
            RefreshPreflight();
        }
    }
    public string ModeDescription => ExperienceMode switch
    {
        1 => "练习模式 · 每次一个音，按对键位与修饰键后推进；统计正确率和反应时间。",
        2 => "计分模式 · 按节奏连续演奏；统计分数、连击和起音误差，结束后显示结果。",
        3 => "自动演奏 · 自动向游戏发送按键，不参与练习计分。",
        _ => "普通模式 · 音符自由下落，自行演奏，不判定、不计分。"
    };
    public int PlaybackMode
    {
        get => ManualMode ? 0 : 1;
        set => ManualMode = value == 0;
    }
    public int ManualPracticeMode
    {
        get => _overlaySettings.ManualPracticeMode;
        set
        {
            if (!CanChangeMode) return;
            _overlaySettings.ManualPracticeMode = value;
            SaveOverlaySettings();
            _visual.Score.Clear();
            Raise();
            RaisePractice();
            _overlay?.Reload();
        }
    }
    public bool PracticeEnabled => ManualMode && ManualPracticeMode != 0;
    public string PracticeSummary => PracticeEnabled ? _visual.Score.HasSession ? _visual.Score.Summary : "练习就绪 · 按开始后计分" : "";
    public string PracticeTiming => PracticeEnabled ? _visual.Score.TimingSummary : "";
    public string PracticeFeedback => PracticeEnabled ? _visual.Score.LastJudgment : "";
    public string OverlayPracticeSummary
    {
        get
        {
            if (!PracticeEnabled) return "";
            var score = _visual.Score;
            if (!score.HasSession) return "练习就绪 · 按开始后计分";
            var value = ManualPracticeMode == 2 ? $"正确 {score.Hits} · 错按 {score.WrongPresses}" : $"{score.Points:N0} 分 · 命中 {score.Accuracy:0.0}%";
            var timing = ManualPracticeMode == 2
                ? score.LastReactionMs is { } reaction ? $"反应 {reaction:0} ms" : "等待按键"
                : score.LastErrorMs is { } error ? $"{error:+0.0;-0.0;0.0} ms" : "—";
            return $"{value} · 连击 {score.Combo}\n{score.LastJudgment} · {timing}";
        }
    }
    public string OverlayHotkeyHint => $"{GlobalHotkeys.KeyName(_settings.StartHotkey)} 开始/结束   {GlobalHotkeys.KeyName(_settings.PauseHotkey)} 暂停   {GlobalHotkeys.KeyName(_settings.OverlayHotkey)} 隐藏   {GlobalHotkeys.KeyName(_settings.AdjustOverlayHotkey)} 调整";
    private void RaisePractice()
    {
        Raise(nameof(PracticeEnabled)); Raise(nameof(PracticeSummary)); Raise(nameof(PracticeTiming)); Raise(nameof(PracticeFeedback));
    }

    private void CaptureResult(bool completed)
    {
        if (!PracticeEnabled || !_visual.Score.HasSession) return;
        _lastResult = PracticeResult.Capture(Title, _visual.Score, completed);
        Raise(nameof(LastResult)); Raise(nameof(HasResult));
        ShowResultCommand.RaiseCanExecuteChanged();
        ShowResult = true;
    }

    private void OnPracticeInput(PracticeInput input)
    {
        if (_disposed || !PracticeEnabled || !_visual.IsBusy || _visual.IsPaused || IsAdjustingOverlay) return;
        if (_visual.ElapsedMs < 0) return;
        // Bind to the foreground window reached after the lead-in. Ignore our own UI.
        if (input.Foreground == IntPtr.Zero || input.Foreground == new System.Windows.Interop.WindowInteropHelper(Application.Current.MainWindow).Handle) return;
        if (_practiceForeground == IntPtr.Zero) _practiceForeground = input.Foreground;
        if (input.Foreground != _practiceForeground) return;
        _visual.Press(input);
        RaisePractice();
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
        if (_overlay?.IsVisible == true)
        {
            if (IsAdjustingOverlay) SetOverlayAdjustment(false);
            _overlay.Hide();
        }
        else ShowOverlay();
    }

    private void ShowOverlay()
    {
        if (_overlay != null) { _overlay.Show(); return; }
        _overlay = new VisualOverlayWindow(() => IsPlaying,
            () => ManualMode ? _visual.ElapsedMs : _autoHasStarted ? _player.VisualElapsedMs : -NoteFallView.LookAheadMs,
            () => ManualMode ? _visual.Notes : _automaticNotes,
            () => ManualMode, _overlaySettings, SaveOverlaySettings, () => OverlayHotkeyHint, () => IsPaused,
            () => OverlayPracticeSummary,
            () => PracticeEnabled && ManualPracticeMode == 2 && _visual.IsBusy ? _visual.StepIndex : -1);
        _overlay.Closed += (_, _) =>
        {
            _overlay = null;
            if (IsAdjustingOverlay) SetOverlayAdjustment(false);
            if (_visual.IsBusy) Stop();
        };
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
    public bool IsPaused => ManualMode ? _visual.IsPaused : _player.State == PlayerState.Paused;

    public int SelectedTab
    {
        get => _selectedTab;
        set
        {
            if (Set(ref _selectedTab, value))
            {
                if (value != 2) _lastLibraryTab = value;
                Raise(nameof(IsPerformancePage));
                Raise(nameof(IsSettingsPage));
                UpdateHotkeyEditingState();
                if (value == 1) _ = Library.EnsureLoadedAsync();
            }
        }
    }

    public string StartButtonLabel => $"{(ExperienceMode == 1 ? "开始练习" : ExperienceMode == 2 ? "开始计分" : ManualMode ? "开始下落" : "开始演奏")} ({GlobalHotkeys.KeyName(_settings.StartHotkey)})";
    public string StopButtonLabel => $"停止 ({GlobalHotkeys.KeyName(_settings.StartHotkey)})";
    public string PauseButtonLabel => $"{(IsPaused ? "继续" : "暂停")} ({GlobalHotkeys.KeyName(_settings.PauseHotkey)})";
    public string OverlayButtonLabel => $"隐藏 / 显示悬浮窗 ({GlobalHotkeys.KeyName(_settings.OverlayHotkey)})";
    public string PreviousButtonLabel => $"上一首 ({GlobalHotkeys.KeyName(_settings.PreviousHotkey)})";
    public string NextButtonLabel => $"下一首 ({GlobalHotkeys.KeyName(_settings.NextHotkey)})";

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
        if (IsPlaying || _switchingTrack)
        {
            StatusMessage = "播放中不能换谱，请先停止。";
            return;
        }
        try
        {
            var score = DfhMidiReader.Read(path);
            SetDocument(ScoreDocument.Build(score.Title, path, score.Snapshot, _settings.ToKeySequenceOptions(), score.Legacy));
            LocalLibrary.SelectPath(path);
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
        if (IsPlaying || _switchingTrack)
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
        ShowResult = false;
        _document = document;
        _visual.Load(document.Notes);
        RaisePractice();
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
        if (_document == null || IsPlaying || _switchingTrack) return;
        ShowResult = false;
        if (ManualMode)
        {
            if (PracticeEnabled && !_hotkeys.PracticeInputAvailable)
            {
                StatusMessage = "练习需要键盘和鼠标监听，请重启程序后重试。";
                return;
            }
            if (IsAdjustingOverlay) SetOverlayAdjustment(false);
            ShowOverlay();
            Score.SetCurrent(-1);
            _practiceForeground = IntPtr.Zero;
            _visual.Start(_settings.CountdownSeconds, PracticeEnabled ? ManualPracticeMode == 2 ? PracticeMode.Step : PracticeMode.Rhythm : null);
            RaisePractice();
            StatusMessage = PracticeEnabled ? "练习已开始，切回游戏；按谱面键位及鼠标修饰键演奏。" : "手动可视化已开始，切回游戏后按下落音符自行演奏。";
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
        _player.Start(_document.Sequence, new PlayerOptions(_settings.CountdownSeconds, _settings.StopWhenForegroundChanges, _settings.EffectiveTiming().ModifierLeadMs));
        if (_settings.MinimizeOnPlay && Application.Current.MainWindow != null)
        {
            Application.Current.MainWindow.WindowState = WindowState.Minimized;
        }
    }

    private void Stop()
    {
        _switchVersion++;
        if (_visual.IsBusy)
        {
            _visual.Stop();
            CaptureResult(false);
            Score.SetCurrent(-1);
            OnPlayerState(PlayerState.Idle);
            UpdateProgress();
        }
        else _player.Stop();
    }

    private void RefreshTrackCommands()
    {
        PreviousCommand.RaiseCanExecuteChanged();
        NextCommand.RaiseCanExecuteChanged();
        StartCommand.RaiseCanExecuteChanged();
        StopCommand.RaiseCanExecuteChanged();
        PauseCommand.RaiseCanExecuteChanged();
        OpenMidiCommand.RaiseCanExecuteChanged();
        Raise(nameof(CanChangeMode));
    }

    private async Task SwitchTrackAsync(int direction)
    {
        if (!CanSwitchTrack) return;
        var entry = LocalLibrary.Adjacent(_document?.Source, direction);
        if (entry == null) return;
        var restart = IsPlaying && !IsPaused;
        var version = ++_switchVersion;
        _switchingTrack = true;
        RefreshTrackCommands();
        try
        {
            // Read first: a deleted/unreadable next file must not interrupt this song.
            var score = DfhMidiReader.Read(entry.Path);
            var document = ScoreDocument.Build(score.Title, entry.Path, score.Snapshot, _settings.ToKeySequenceOptions(), score.Legacy);
            _visual.Stop();
            if (PracticeEnabled) CaptureResult(false);
            if (ManualMode) OnPlayerState(PlayerState.Idle);
            if (!await _player.StopAsync())
            {
                StatusMessage = "上一首仍在停止，请稍后重试。";
                return;
            }
            if (_disposed || version != _switchVersion) return;
            SetDocument(document);
            LocalLibrary.SelectPath(entry.Path);
            SourceLabel = $"本地文件 · {entry.Path}";
            StatusMessage = $"已切换到「{score.Title}」。";
            Score.SetCurrent(-1);
            OnPlayerState(PlayerState.Idle);
            _switchingTrack = false;
            if (restart) Start();
        }
        catch (Exception reason) { StatusMessage = $"切换歌曲失败：{reason.Message}"; }
        finally
        {
            _switchingTrack = false;
            if (!_disposed) RefreshTrackCommands();
        }
    }

    private void TogglePause()
    {
        if (!IsPlaying || _switchingTrack) return;
        if (PracticeEnabled && IsAdjustingOverlay) { StatusMessage = "请先退出悬浮窗调整，再继续练习。"; return; }
        if (ManualMode)
        {
            _visual.TogglePause();
            OnPlayerState(_visual.IsPaused ? PlayerState.Paused : _visual.ElapsedMs < 0 ? PlayerState.Countdown : PlayerState.Playing);
            StatusMessage = _visual.IsPaused ? "已暂停，按暂停 / 继续热键接着播放。" : "已继续手动可视化。";
            UpdateProgress();
        }
        else _player.TogglePause();
    }

    private void OnHotkey(int vk)
    {
        // Selecting a function key in a settings combo must not control playback.
        if (SelectedTab == 2 && Application.Current.MainWindow?.IsActive == true) return;
        if (vk == _settings.OverlayHotkey)
        {
            ToggleOverlay();
        }
        else if (vk == _settings.PauseHotkey) TogglePause();
        else if (vk == _settings.PreviousHotkey) PreviousCommand.Execute(null);
        else if (vk == _settings.NextHotkey) NextCommand.Execute(null);
        else if (vk == _settings.StartHotkey)
        {
            if (IsPlaying || _switchingTrack) Stop();
            else if (StartCommand.CanExecute(null)) Start();
        }
    }

    private void OnPlayerState(PlayerState state)
    {
        StateLabel = state switch
        {
            PlayerState.Countdown => "倒计时",
            PlayerState.Playing => "演奏中",
            PlayerState.Paused => "已暂停",
            _ => "空闲"
        };
        Raise(nameof(IsPlaying));
        ShowResultCommand.RaiseCanExecuteChanged();
        Raise(nameof(IsPaused));
        Raise(nameof(PauseButtonLabel));
        Raise(nameof(CanChangeMode));
        ShowOverlayCommand.RaiseCanExecuteChanged();
        StartCommand.RaiseCanExecuteChanged();
        StopCommand.RaiseCanExecuteChanged();
        PauseCommand.RaiseCanExecuteChanged();
        OpenMidiCommand.RaiseCanExecuteChanged();
        if (!_switchingTrack && !ManualMode && state == PlayerState.Idle && _settings.MinimizeOnPlay && Application.Current.MainWindow is { WindowState: WindowState.Minimized } window)
        {
            window.WindowState = WindowState.Normal;
        }
    }

    private void Tick()
    {
        if (_visual.IsBusy)
        {
            if (PracticeEnabled && !_visual.IsPaused && _visual.ElapsedMs >= 0)
            {
                var front = Preflight.ForegroundWindow().Handle;
                var own = new System.Windows.Interop.WindowInteropHelper(Application.Current.MainWindow).Handle;
                if (_practiceForeground == IntPtr.Zero && front != own && front != IntPtr.Zero) _practiceForeground = front;
                if (front == own || front == IntPtr.Zero || (_practiceForeground != IntPtr.Zero && front != _practiceForeground))
                {
                    _visual.TogglePause();
                    OnPlayerState(PlayerState.Paused);
                    StatusMessage = "已切出练习窗口，自动暂停；切回游戏后按继续。";
                }
            }
            if (_visual.FinishIfDue())
            {
                CaptureResult(true);
                Score.SetCurrent(-1);
                OnPlayerState(PlayerState.Idle);
                StatusMessage = PracticeEnabled ? "练习结束，成绩和误差已保留；再次开始会重置。" : "手动可视化结束，可再次开始。";
            }
            else
            {
                StateLabel = _visual.IsPaused ? "已暂停" : _visual.ElapsedMs < 0 ? $"倒计时 {Math.Ceiling(-_visual.ElapsedMs / 1000):0}" : _visual.WaitingForNote ? "等待按对当前音" : "手动演奏中";
                Score.SetCurrent(_visual.CurrentIndex());
            }
            UpdateProgress();
            RaisePractice();
        }
        else if (_player.IsBusy) UpdateProgress();
        RefreshPreflight();
    }

    private void UpdateProgress()
    {
        var total = ManualMode ? _visual.DurationMs : _document?.DurationMs ?? 0;
        var elapsed = Math.Clamp(ManualMode ? _visual.ElapsedMs : _autoHasStarted ? _player.ElapsedMs : 0, 0, total);
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
        _hotkeys.ConfigureAdjustment(settings);
        if (IsAdjustingOverlay) _overlay?.SetKeyboardAdjustment(true, OverlayAdjustmentHint);
        LocalLibrary.SetDirectory(settings.LocalLibraryDirectory);
        UpdateHotkeyHint();
        if (_document != null && !IsPlaying && !_switchingTrack)
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
        HotkeyHint = $"{GlobalHotkeys.KeyName(_settings.StartHotkey)} 开始 / 结束 · {GlobalHotkeys.KeyName(_settings.PauseHotkey)} 暂停 / 继续 · {GlobalHotkeys.KeyName(_settings.OverlayHotkey)} 悬浮窗 · {GlobalHotkeys.KeyName(_settings.PreviousHotkey)} 上一首 · {GlobalHotkeys.KeyName(_settings.NextHotkey)} 下一首 · {GlobalHotkeys.KeyName(_settings.AdjustOverlayHotkey)} 调整";
        Raise(nameof(StartButtonLabel));
        Raise(nameof(StopButtonLabel));
        Raise(nameof(PauseButtonLabel));
        Raise(nameof(OverlayButtonLabel));
        Raise(nameof(PreviousButtonLabel));
        Raise(nameof(NextButtonLabel));
        Raise(nameof(AdjustOverlayButtonLabel));
        Raise(nameof(OverlayAdjustmentHint));
    }

    public void Dispose()
    {
        _disposed = true;
        _hotkeys.AdjustmentActive = false;
        _switchVersion++;
        _ticker.Stop();
        _visual.Stop();
        _overlay?.Close();
        _player.Dispose();
        _hotkeys.Dispose();
        LocalLibrary.Dispose();
    }
}
