using DFH.Desktop.Infrastructure;
using DFH.Desktop.Services;

namespace DFH.Desktop.ViewModels;

public sealed record HotkeyOption(int VirtualKey, string Label);

/// <summary>Edits a copy of the settings; Save writes it back and tells the main view model to re-apply.</summary>
public sealed class SettingsViewModel : ObservableObject
{
    private readonly Action<AppSettings> _apply;
    private AppSettings _draft;
    private string _status = "";

    public SettingsViewModel(AppSettings current, Action<AppSettings> apply)
    {
        _draft = current.Clone();
        _apply = apply;
        SaveCommand = new RelayCommand(Save);
        ResetCommand = new RelayCommand(Reset);
    }

    public static IReadOnlyList<HotkeyOption> HotkeyOptions { get; } =
        Enumerable.Range(1, 12).Select(n => new HotkeyOption(0x70 + n - 1, $"F{n}")).ToList();

    public RelayCommand SaveCommand { get; }
    public RelayCommand ResetCommand { get; }

    public string StorageBase { get => _draft.StorageBase; set { _draft.StorageBase = value; Raise(); } }
    public int CountdownSeconds { get => _draft.CountdownSeconds; set { _draft.CountdownSeconds = Math.Clamp(value, 0, 30); Raise(); } }
    public double ModifierLeadMs { get => _draft.ModifierLeadMs; set { _draft.ModifierLeadMs = value; Raise(); } }
    public double ReleaseGapMs { get => _draft.ReleaseGapMs; set { _draft.ReleaseGapMs = value; Raise(); } }
    public double MinNoteMs { get => _draft.MinNoteMs; set { _draft.MinNoteMs = value; Raise(); } }
    public bool StopWhenForegroundChanges { get => _draft.StopWhenForegroundChanges; set { _draft.StopWhenForegroundChanges = value; Raise(); } }
    public bool MinimizeOnPlay { get => _draft.MinimizeOnPlay; set { _draft.MinimizeOnPlay = value; Raise(); } }

    public HotkeyOption StartHotkey
    {
        get => HotkeyOptions.FirstOrDefault(option => option.VirtualKey == _draft.StartHotkey) ?? HotkeyOptions[4];
        set { _draft.StartHotkey = value.VirtualKey; Raise(); }
    }

    public HotkeyOption StopHotkey
    {
        get => HotkeyOptions.FirstOrDefault(option => option.VirtualKey == _draft.StopHotkey) ?? HotkeyOptions[5];
        set { _draft.StopHotkey = value.VirtualKey; Raise(); }
    }

    public string Status
    {
        get => _status;
        private set => Set(ref _status, value);
    }

    public string SettingsPath => AppSettings.Path;

    private void Save()
    {
        if (_draft.StartHotkey == _draft.StopHotkey)
        {
            Status = "开始键和停止键不能相同";
            return;
        }
        try
        {
            _draft.Save();
            _apply(_draft.Clone());
            Status = "已保存并生效";
        }
        catch (Exception reason)
        {
            Status = $"保存失败：{reason.Message}";
        }
    }

    private void Reset()
    {
        _draft = new AppSettings { LastMidiDirectory = _draft.LastMidiDirectory };
        foreach (var name in new[]
                 {
                     nameof(StorageBase), nameof(CountdownSeconds), nameof(ModifierLeadMs), nameof(ReleaseGapMs), nameof(MinNoteMs),
                     nameof(StopWhenForegroundChanges), nameof(MinimizeOnPlay), nameof(StartHotkey), nameof(StopHotkey)
                 })
        {
            Raise(name);
        }
        Status = "已恢复默认值，点击保存后生效";
    }
}
