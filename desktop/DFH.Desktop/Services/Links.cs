using System.Diagnostics;

namespace DFH.Desktop.Services;

public static class Links
{
    /// <summary>The web app on Bilibili Toy: converter, editor, cloud library and the MIDI export this player reads.</summary>
    public const string WebApp = "https://www.bilibili.com/toy/deltaforce/index.html";

    /// <summary>
    /// Opens a URL in the default browser. This process runs elevated, so a
    /// direct ShellExecute could spawn an elevated browser; handing the URL to
    /// the already-running, unelevated Explorer avoids that.
    /// </summary>
    public static void Open(string url)
    {
        try
        {
            Process.Start(new ProcessStartInfo("explorer.exe", url) { UseShellExecute = false });
        }
        catch
        {
            Process.Start(new ProcessStartInfo(url) { UseShellExecute = true });
        }
    }
}
