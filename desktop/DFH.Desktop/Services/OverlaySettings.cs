using System.IO;
using System.Text.Json;

namespace DFH.Desktop.Services;

// Separate from the settings form's draft so saving that form cannot overwrite window geometry.
public sealed class OverlaySettings
{
    public double Left { get; set; } = 120;
    public double Top { get; set; } = 120;
    public double Width { get; set; } = 640;
    public double Height { get; set; } = 460;
    public bool ManualMode { get; set; } = true;
    public bool ShowKeyLabels { get; set; } = true;
    public static string Path => System.IO.Path.Combine(System.IO.Path.GetDirectoryName(AppSettings.Path)!, "overlay.json");

    public static OverlaySettings Load()
    {
        try { return JsonSerializer.Deserialize<OverlaySettings>(File.ReadAllText(Path)) ?? new(); }
        catch { return new(); }
    }

    public void Save()
    {
        Directory.CreateDirectory(System.IO.Path.GetDirectoryName(Path)!);
        File.WriteAllText(Path, JsonSerializer.Serialize(this));
    }
}
