using System.IO;
using System.Text.Json;
using DFH.Core.Export;
using DFH.Core.Library;

namespace DFH.Desktop.Services;

/// <summary>Persisted under %LocalAppData%\DeltaForceHarmonica\settings.json.</summary>
public sealed class AppSettings
{
    /// <summary>Marker for <see cref="TimingTier"/> meaning "use the three millisecond fields".</summary>
    public const string CustomTimingTier = "custom";

    public string StorageBase { get; set; } = LibraryClientDefaults.StorageBase;
    public int CountdownSeconds { get; set; } = 3;
    /// <summary>Virtual key codes; F5 through F9 by default.</summary>
    public int StartHotkey { get; set; } = 0x74;
    public int PauseHotkey { get; set; } = 0x75;
    public int OverlayHotkey { get; set; } = 0x76;
    public int PreviousHotkey { get; set; } = 0x77;
    public int NextHotkey { get; set; } = 0x78;
    public int AdjustOverlayHotkey { get; set; } = 0x79;
    public int OverlayLeftKey { get; set; } = 0x25;
    public int OverlayUpKey { get; set; } = 0x26;
    public int OverlayRightKey { get; set; } = 0x27;
    public int OverlayDownKey { get; set; } = 0x28;
    public int OverlayFineModifier { get; set; } = 0x10;
    public int OverlayResizeModifier { get; set; } = 0x11;
    /// <summary>A <see cref="TimingTiers"/> id, or <see cref="CustomTimingTier"/>. Unknown values fall back to the default tier.</summary>
    public string TimingTier { get; set; } = TimingTiers.Default.Id;
    /// <summary>Only used when <see cref="TimingTier"/> is custom; otherwise the tier's values win.</summary>
    public double ModifierLeadMs { get; set; } = TimingTiers.Default.Timing.ModifierLeadMs;
    public double ReleaseGapMs { get; set; } = TimingTiers.Default.Timing.ReleaseGapMs;
    public double MinNoteMs { get; set; } = TimingTiers.Default.Timing.MinNoteMs;
    public bool StopWhenForegroundChanges { get; set; } = true;
    public bool MinimizeOnPlay { get; set; } = false;
    public string LastMidiDirectory { get; set; } = "";
    public string LocalLibraryDirectory { get; set; } = DefaultLocalLibraryDirectory;

    public static string DefaultLocalLibraryDirectory => System.IO.Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.MyMusic), "Delta Force Harmonica");

    public bool IsCustomTiming => TimingTier == CustomTimingTier;

    /// <summary>The effective timing: the selected tier, or the clamped custom fields.</summary>
    public KeyTiming EffectiveTiming()
    {
        if (IsCustomTiming)
        {
            return new KeyTiming(
                Math.Clamp(ModifierLeadMs, 0, 500),
                Math.Clamp(ReleaseGapMs, 0, 500),
                Math.Clamp(MinNoteMs, 1, 1000));
        }
        return (TimingTiers.Find(TimingTier) ?? TimingTiers.Default).Timing;
    }

    public KeySequenceOptions ToKeySequenceOptions() => KeySequenceOptions.From(EffectiveTiming());

    public AppSettings Clone() => (AppSettings)MemberwiseClone();

    private static readonly JsonSerializerOptions JsonOptions = new() { WriteIndented = true };

    public static string Path => System.IO.Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "DeltaForceHarmonica", "settings.json");

    public static AppSettings Load() => LoadFrom(Path);

    public static AppSettings LoadFrom(string path)
    {
        try
        {
            if (File.Exists(path))
            {
                var json = File.ReadAllText(path);
                var loaded = JsonSerializer.Deserialize<AppSettings>(json, JsonOptions);
                if (loaded != null)
                {
                    using var document = JsonDocument.Parse(json);
                    // The old StopHotkey actually toggled the overlay. Move its old
                    // default F6 to F7, but retain a user's non-default selection.
                    if (!document.RootElement.TryGetProperty(nameof(OverlayHotkey), out _) &&
                        document.RootElement.TryGetProperty("StopHotkey", out var legacy) &&
                        legacy.TryGetInt32(out var key))
                        loaded.OverlayHotkey = key == 0x75 ? 0x76 : key;
                    loaded.NormalizeHotkeys();
                    return loaded;
                }
            }
        }
        catch
        {
            // A corrupt file must not stop the app from starting; defaults win.
        }
        return new AppSettings();
    }

    public void Save() => SaveTo(Path);

    public bool HasValidHotkeys => new[] { StartHotkey, PauseHotkey, OverlayHotkey, PreviousHotkey, NextHotkey, AdjustOverlayHotkey }.All(IsSupportedHotkey)
        && new[] { StartHotkey, PauseHotkey, OverlayHotkey, PreviousHotkey, NextHotkey, AdjustOverlayHotkey }.Distinct().Count() == 6
        && new[] { OverlayLeftKey, OverlayUpKey, OverlayRightKey, OverlayDownKey }.All(IsAdjustmentKey)
        && new[] { OverlayLeftKey, OverlayUpKey, OverlayRightKey, OverlayDownKey }.Distinct().Count() == 4
        && OverlayFineModifier is 0x10 or 0x11 && OverlayResizeModifier is 0x10 or 0x11
        && OverlayFineModifier != OverlayResizeModifier;

    public static bool IsAdjustmentKey(int key) => key is >= 0x25 and <= 0x28 or >= 0x41 and <= 0x5A;

    public static bool IsSupportedHotkey(int key) => key is >= 0x70 and <= 0x87;

    private void NormalizeHotkeys()
    {
        var used = new HashSet<int>();
        int Claim(int key, int fallback)
        {
            if (IsSupportedHotkey(key) && used.Add(key)) return key;
            if (used.Add(fallback)) return fallback;
            return Enumerable.Range(0x70, 24).First(used.Add);
        }
        // Preserve existing start/overlay preferences before assigning the new pause key.
        StartHotkey = Claim(StartHotkey, 0x74);
        OverlayHotkey = Claim(OverlayHotkey, 0x76);
        PauseHotkey = Claim(PauseHotkey, 0x75);
        PreviousHotkey = Claim(PreviousHotkey, 0x77);
        NextHotkey = Claim(NextHotkey, 0x78);
        AdjustOverlayHotkey = Claim(AdjustOverlayHotkey, 0x79);
        if (!new[] { OverlayLeftKey, OverlayUpKey, OverlayRightKey, OverlayDownKey }.All(IsAdjustmentKey)
            || new[] { OverlayLeftKey, OverlayUpKey, OverlayRightKey, OverlayDownKey }.Distinct().Count() != 4)
        {
            OverlayLeftKey = 0x25; OverlayUpKey = 0x26; OverlayRightKey = 0x27; OverlayDownKey = 0x28;
        }
        if (OverlayFineModifier is not (0x10 or 0x11) || OverlayResizeModifier is not (0x10 or 0x11)
            || OverlayFineModifier == OverlayResizeModifier)
        {
            OverlayFineModifier = 0x10; OverlayResizeModifier = 0x11;
        }
    }

    public void SaveTo(string path)
    {
        var directory = System.IO.Path.GetDirectoryName(path)!;
        Directory.CreateDirectory(directory);
        File.WriteAllText(path, JsonSerializer.Serialize(this, JsonOptions));
    }
}
