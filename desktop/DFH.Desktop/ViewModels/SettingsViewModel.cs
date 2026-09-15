using DFH.Core.Export;
using DFH.Desktop.Infrastructure;
using DFH.Desktop.Services;

namespace DFH.Desktop.ViewModels;

public sealed record HotkeyOption(int VirtualKey, string Label);

public sealed record TimingTierOption(string Id, string Label);

/// <summary>Edits a copy of the settings; Save writes it back and tells the main view model to re-apply.</summary>
public sealed class SettingsViewModel : ObservableObject
{
    private readonly Action<AppSettings> _apply;
    private readonly Action<AppSettings> _save;
    private AppSettings _draft;
    private string _status = "";

    public SettingsViewModel(AppSettings current, Action<AppSettings> apply, Action<AppSettings>? save = null)
    {
        _draft = current.Clone();
        _apply = apply;
        _save = save ?? (settings => settings.Save());
        SaveCommand = new RelayCommand(Save);
        ResetCommand = new RelayCommand(Reset);
    }

    public static IReadOnlyList<HotkeyOption> HotkeyOptions { get; } =
        Enumerable.Range(1, 24).Select(n => new HotkeyOption(0x70 + n - 1, $"F{n}")).ToList();
    public static IReadOnlyList<HotkeyOption> AdjustmentKeyOptions { get; } = Enumerable.Range(0x25, 4)
        .Concat(Enumerable.Range(0x41, 26)).Select(key => new HotkeyOption(key, GlobalHotkeys.KeyName(key))).ToList();
    public static IReadOnlyList<HotkeyOption> ModifierOptions { get; } =
        [new(0x10, "Shift"), new(0x11, "Ctrl")];

    /// <summary>The three shared tiers plus a custom entry that unlocks the millisecond fields.</summary>
    public static IReadOnlyList<TimingTierOption> TimingTierOptions { get; } =
        TimingTiers.All.Select(tier => new TimingTierOption(tier.Id, $"{tier.Label} · {tier.Hint}"))
            .Append(new TimingTierOption(AppSettings.CustomTimingTier, "自定义 · 手动填写毫秒"))
            .ToList();

    public RelayCommand SaveCommand { get; }
    public RelayCommand ResetCommand { get; }

    public string StorageBase { get => _draft.StorageBase; set { _draft.StorageBase = value; Raise(); } }
    public int CountdownSeconds { get => _draft.CountdownSeconds; set { _draft.CountdownSeconds = Math.Clamp(value, 0, 30); Raise(); } }
    public bool StopWhenForegroundChanges { get => _draft.StopWhenForegroundChanges; set { _draft.StopWhenForegroundChanges = value; Raise(); } }
    public bool MinimizeOnPlay { get => _draft.MinimizeOnPlay; set { _draft.MinimizeOnPlay = value; Raise(); } }

    public TimingTierOption SelectedTimingTier
    {
        get => TimingTierOptions.FirstOrDefault(option => option.Id == _draft.TimingTier)
               ?? TimingTierOptions.First(option => option.Id == TimingTiers.Default.Id);
        set
        {
            if (value is null) return;
            _draft.TimingTier = value.Id;
            // Show the tier's numbers in the (disabled) fields so the user sees
            // what they are getting; custom keeps whatever was typed last.
            var tier = TimingTiers.Find(value.Id);
            if (tier is not null)
            {
                _draft.ModifierLeadMs = tier.Timing.ModifierLeadMs;
                _draft.ReleaseGapMs = tier.Timing.ReleaseGapMs;
                _draft.MinNoteMs = tier.Timing.MinNoteMs;
            }
            RaiseTiming();
        }
    }

    public bool IsCustomTiming => _draft.IsCustomTiming;

    public double ModifierLeadMs { get => _draft.ModifierLeadMs; set { _draft.ModifierLeadMs = value; Raise(); } }
    public double ReleaseGapMs { get => _draft.ReleaseGapMs; set { _draft.ReleaseGapMs = value; Raise(); } }
    public double MinNoteMs { get => _draft.MinNoteMs; set { _draft.MinNoteMs = value; Raise(); } }

    public HotkeyOption StartHotkey
    {
        get => HotkeyOptions.FirstOrDefault(option => option.VirtualKey == _draft.StartHotkey) ?? HotkeyOptions[4];
        set { if (value is null) return; _draft.StartHotkey = value.VirtualKey; Raise(); }
    }

    public HotkeyOption PauseHotkey
    {
        get => HotkeyOptions.FirstOrDefault(option => option.VirtualKey == _draft.PauseHotkey) ?? HotkeyOptions[5];
        set { if (value is null) return; _draft.PauseHotkey = value.VirtualKey; Raise(); }
    }

    public HotkeyOption OverlayHotkey
    {
        get => HotkeyOptions.FirstOrDefault(option => option.VirtualKey == _draft.OverlayHotkey) ?? HotkeyOptions[6];
        set { if (value is null) return; _draft.OverlayHotkey = value.VirtualKey; Raise(); }
    }

    public HotkeyOption PreviousHotkey
    {
        get => HotkeyOptions.FirstOrDefault(option => option.VirtualKey == _draft.PreviousHotkey) ?? HotkeyOptions[7];
        set { if (value is null) return; _draft.PreviousHotkey = value.VirtualKey; Raise(); }
    }

    public HotkeyOption NextHotkey
    {
        get => HotkeyOptions.FirstOrDefault(option => option.VirtualKey == _draft.NextHotkey) ?? HotkeyOptions[8];
        set { if (value is null) return; _draft.NextHotkey = value.VirtualKey; Raise(); }
    }

    public HotkeyOption AdjustOverlayHotkey
    {
        get => HotkeyOptions.FirstOrDefault(option => option.VirtualKey == _draft.AdjustOverlayHotkey) ?? HotkeyOptions[9];
        set { if (value is null) return; _draft.AdjustOverlayHotkey = value.VirtualKey; Raise(); }
    }
    public HotkeyOption OverlayLeftKey
    {
        get => AdjustmentKeyOptions.First(option => option.VirtualKey == _draft.OverlayLeftKey);
        set { if (value is null) return; _draft.OverlayLeftKey = value.VirtualKey; Raise(); }
    }
    public HotkeyOption OverlayUpKey
    {
        get => AdjustmentKeyOptions.First(option => option.VirtualKey == _draft.OverlayUpKey);
        set { if (value is null) return; _draft.OverlayUpKey = value.VirtualKey; Raise(); }
    }
    public HotkeyOption OverlayRightKey
    {
        get => AdjustmentKeyOptions.First(option => option.VirtualKey == _draft.OverlayRightKey);
        set { if (value is null) return; _draft.OverlayRightKey = value.VirtualKey; Raise(); }
    }
    public HotkeyOption OverlayDownKey
    {
        get => AdjustmentKeyOptions.First(option => option.VirtualKey == _draft.OverlayDownKey);
        set { if (value is null) return; _draft.OverlayDownKey = value.VirtualKey; Raise(); }
    }
    public HotkeyOption OverlayFineModifier
    {
        get => ModifierOptions.First(option => option.VirtualKey == _draft.OverlayFineModifier);
        set { if (value is null) return; _draft.OverlayFineModifier = value.VirtualKey; Raise(); }
    }
    public HotkeyOption OverlayResizeModifier
    {
        get => ModifierOptions.First(option => option.VirtualKey == _draft.OverlayResizeModifier);
        set { if (value is null) return; _draft.OverlayResizeModifier = value.VirtualKey; Raise(); }
    }

    public string Status
    {
        get => _status;
        private set => Set(ref _status, value);
    }

    public string SettingsPath => AppSettings.Path;

    public void SetLocalLibraryDirectory(string directory) => _draft.LocalLibraryDirectory = directory;

    private void RaiseTiming()
    {
        foreach (var name in new[] { nameof(SelectedTimingTier), nameof(IsCustomTiming), nameof(ModifierLeadMs), nameof(ReleaseGapMs), nameof(MinNoteMs) })
        {
            Raise(name);
        }
    }

    private void Save()
    {
        if (!_draft.HasValidHotkeys)
        {
            Status = "热键不能重复；调整方向键不能重复，微调与缩放修饰键需不同";
            return;
        }
        try
        {
            _save(_draft);
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
        _draft = new AppSettings { LastMidiDirectory = _draft.LastMidiDirectory, LocalLibraryDirectory = _draft.LocalLibraryDirectory };
        foreach (var name in new[]
                 {
                     nameof(StorageBase), nameof(CountdownSeconds),
                     nameof(StopWhenForegroundChanges), nameof(MinimizeOnPlay), nameof(StartHotkey), nameof(PauseHotkey), nameof(OverlayHotkey), nameof(PreviousHotkey), nameof(NextHotkey),
                     nameof(AdjustOverlayHotkey), nameof(OverlayLeftKey), nameof(OverlayUpKey), nameof(OverlayRightKey), nameof(OverlayDownKey), nameof(OverlayFineModifier), nameof(OverlayResizeModifier)
                 })
        {
            Raise(name);
        }
        RaiseTiming();
        Status = "已恢复默认值，点击保存后生效";
    }
}
