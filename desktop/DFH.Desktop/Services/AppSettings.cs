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
    /// <summary>Virtual key codes; F5 / F6 by default.</summary>
    public int StartHotkey { get; set; } = 0x74;
    // Legacy JSON name retained for saved preferences; now toggles overlay visibility.
    public int StopHotkey { get; set; } = 0x75;
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
                var loaded = JsonSerializer.Deserialize<AppSettings>(File.ReadAllText(path), JsonOptions);
                if (loaded != null) return loaded;
            }
        }
        catch
        {
            // A corrupt file must not stop the app from starting; defaults win.
        }
        return new AppSettings();
    }

    public void Save() => SaveTo(Path);

    public void SaveTo(string path)
    {
        var directory = System.IO.Path.GetDirectoryName(path)!;
        Directory.CreateDirectory(directory);
        File.WriteAllText(path, JsonSerializer.Serialize(this, JsonOptions));
    }
}
