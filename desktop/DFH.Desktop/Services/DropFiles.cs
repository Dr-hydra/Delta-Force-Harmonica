using System.Runtime.InteropServices;
using System.Text;
using System.Windows;
using System.Windows.Interop;

namespace DFH.Desktop.Services;

/// <summary>
/// File drag-and-drop for an elevated window. OLE drag-drop from Explorer is
/// blocked by UIPI, but the older WM_DROPFILES path can be let through with a
/// message filter, so that is what we listen to instead of WPF's AllowDrop.
/// </summary>
public static class DropFiles
{
    private const uint WM_DROPFILES = 0x0233;
    private const uint WM_COPYDATA = 0x004A;
    private const uint WM_COPYGLOBALDATA = 0x0049;
    private const uint MSGFLT_ALLOW = 1;

    [DllImport("user32.dll", SetLastError = true)] private static extern bool ChangeWindowMessageFilterEx(IntPtr hWnd, uint message, uint action, IntPtr changeFilterStruct);
    [DllImport("shell32.dll")] private static extern void DragAcceptFiles(IntPtr hWnd, bool accept);
    [DllImport("shell32.dll", CharSet = CharSet.Unicode)] private static extern uint DragQueryFileW(IntPtr hDrop, uint iFile, StringBuilder? lpszFile, uint cch);
    [DllImport("shell32.dll")] private static extern void DragFinish(IntPtr hDrop);

    public static void Enable(Window window, Action<string[]> onDrop)
    {
        var hwnd = new WindowInteropHelper(window).Handle;
        if (hwnd == IntPtr.Zero) return;
        ChangeWindowMessageFilterEx(hwnd, WM_DROPFILES, MSGFLT_ALLOW, IntPtr.Zero);
        ChangeWindowMessageFilterEx(hwnd, WM_COPYDATA, MSGFLT_ALLOW, IntPtr.Zero);
        ChangeWindowMessageFilterEx(hwnd, WM_COPYGLOBALDATA, MSGFLT_ALLOW, IntPtr.Zero);
        DragAcceptFiles(hwnd, true);

        HwndSource.FromHwnd(hwnd)?.AddHook((IntPtr _, int msg, IntPtr wParam, IntPtr _, ref bool handled) =>
        {
            if (msg != WM_DROPFILES) return IntPtr.Zero;
            var count = DragQueryFileW(wParam, 0xFFFFFFFF, null, 0);
            var files = new List<string>();
            for (uint index = 0; index < count; index++)
            {
                var length = DragQueryFileW(wParam, index, null, 0) + 1;
                var buffer = new StringBuilder((int)length);
                DragQueryFileW(wParam, index, buffer, length);
                files.Add(buffer.ToString());
            }
            DragFinish(wParam);
            handled = true;
            if (files.Count > 0) onDrop(files.ToArray());
            return IntPtr.Zero;
        });
    }
}
