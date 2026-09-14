using System.Diagnostics;
using System.IO;

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

    /// <summary>
    /// Ask the existing Windows shell to open a directory. Explorer brokers the
    /// request back to the normal desktop shell even though this app is elevated.
    /// </summary>
    public static void OpenFolder(string directory)
    {
        Directory.CreateDirectory(directory);
        var start = new ProcessStartInfo("explorer.exe") { UseShellExecute = false };
        start.ArgumentList.Add(directory);
        Process.Start(start);
    }
}
