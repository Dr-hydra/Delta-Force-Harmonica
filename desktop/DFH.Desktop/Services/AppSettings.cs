using System.IO;
using System.Text.Json;
using DFH.Core.Export;
using DFH.Core.Library;

namespace DFH.Desktop.Services;

/// <summary>Persisted under %LocalAppData%\DeltaForceHarmonica\settings.json.</summary>
public sealed class AppSettings
{
    public string StorageBase { get; set; } = LibraryClientDefaults.StorageBase;
    public int CountdownSeconds { get; set; } = 3;
    /// <summary>Virtual key codes; F5 / F6 by default.</summary>
    public int StartHotkey { get; set; } = 0x74;
    public int StopHotkey { get; set; } = 0x75;
    public double ModifierLeadMs { get; set; } = 12;
    public double ReleaseGapMs { get; set; } = 18;
    public double MinNoteMs { get; set; } = 30;
    public bool StopWhenForegroundChanges { get; set; } = true;
    public bool MinimizeOnPlay { get; set; } = false;
    public string LastMidiDirectory { get; set; } = "";

    public KeySequenceOptions ToKeySequenceOptions() => new()
    {
        ModifierLeadMs = Math.Clamp(ModifierLeadMs, 0, 500),
        ReleaseGapMs = Math.Clamp(ReleaseGapMs, 0, 500),
        MinNoteMs = Math.Clamp(MinNoteMs, 1, 1000)
    };

    public AppSettings Clone() => (AppSettings)MemberwiseClone();

    private static readonly JsonSerializerOptions JsonOptions = new() { WriteIndented = true };

    public static string Path => System.IO.Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "DeltaForceHarmonica", "settings.json");

    public static AppSettings Load()
    {
        try
        {
            if (File.Exists(Path))
            {
                var loaded = JsonSerializer.Deserialize<AppSettings>(File.ReadAllText(Path), JsonOptions);
                if (loaded != null) return loaded;
            }
        }
        catch
        {
            // A corrupt file must not stop the app from starting; defaults win.
        }
        return new AppSettings();
    }

    public void Save()
    {
        var directory = System.IO.Path.GetDirectoryName(Path)!;
        Directory.CreateDirectory(directory);
        File.WriteAllText(Path, JsonSerializer.Serialize(this, JsonOptions));
    }
}
