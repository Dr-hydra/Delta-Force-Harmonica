using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Security.Principal;
using System.Text;

namespace DFH.Desktop.Services;

public sealed record ForegroundInfo(IntPtr Handle, string Title, string ProcessName);

public sealed record PreflightReport(bool Elevated, bool ImeSafe, string ImeName, ForegroundInfo Foreground)
{
    public string ElevationText => Elevated ? "已提权" : "未提权，游戏为管理员时按键会被系统拦截";
    public string ImeText => ImeSafe ? "英文键盘布局" : $"前台输入法为{ImeName}，请切换到英文";
}

/// <summary>Checks the two things that decide whether a key reaches the game at all: elevation and the foreground IME.</summary>
public static class Preflight
{
    [DllImport("user32.dll")] private static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")] private static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId);
    [DllImport("user32.dll")] private static extern IntPtr GetKeyboardLayout(uint idThread);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] private static extern int GetWindowTextW(IntPtr hWnd, StringBuilder text, int maxCount);

    public static bool IsElevated()
    {
        using var identity = WindowsIdentity.GetCurrent();
        return new WindowsPrincipal(identity).IsInRole(WindowsBuiltInRole.Administrator);
    }

    public static ForegroundInfo ForegroundWindow()
    {
        var handle = GetForegroundWindow();
        if (handle == IntPtr.Zero) return new ForegroundInfo(IntPtr.Zero, "", "");
        var builder = new StringBuilder(512);
        GetWindowTextW(handle, builder, builder.Capacity);
        var processName = "";
        try
        {
            GetWindowThreadProcessId(handle, out var pid);
            if (pid != 0) processName = Process.GetProcessById((int)pid).ProcessName;
        }
        catch
        {
            // Protected processes may refuse the query; the title is enough.
        }
        return new ForegroundInfo(handle, builder.ToString(), processName);
    }

    /// <summary>Low 16 bits of the foreground thread's keyboard layout: 0x0804 简中, 0x0404 繁中, 0x0411 日, 0x0412 韩.</summary>
    public static ushort ForegroundLayoutId()
    {
        var handle = GetForegroundWindow();
        if (handle == IntPtr.Zero) return 0;
        var thread = GetWindowThreadProcessId(handle, out _);
        return (ushort)(GetKeyboardLayout(thread).ToInt64() & 0xFFFF);
    }

    public static PreflightReport Run()
    {
        var layout = ForegroundLayoutId();
        var (imeSafe, imeName) = layout switch
        {
            0x0804 => (false, "简体中文"),
            0x0404 => (false, "繁体中文"),
            0x0411 => (false, "日文"),
            0x0412 => (false, "韩文"),
            _ => (true, "")
        };
        return new PreflightReport(IsElevated(), imeSafe, imeName, ForegroundWindow());
    }
}
