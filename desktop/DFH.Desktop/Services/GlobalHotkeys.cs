using System.Runtime.InteropServices;

namespace DFH.Desktop.Services;

/// <summary>
/// Global start/stop keys via a low-level keyboard hook on its own message
/// thread. Unlike RegisterHotKey the hook does not swallow the key, so the game
/// still sees it; injected events (our own SendInput) are ignored so playback
/// cannot trigger itself. KeyDown is raised on the hook thread.
/// </summary>
public sealed class GlobalHotkeys : IDisposable
{
    private const int WH_KEYBOARD_LL = 13;
    private const int WM_KEYDOWN = 0x0100;
    private const int WM_SYSKEYDOWN = 0x0104;
    private const uint WM_QUIT = 0x0012;
    private const uint LLKHF_INJECTED = 0x10;

    private delegate IntPtr HookProc(int nCode, IntPtr wParam, IntPtr lParam);

    [StructLayout(LayoutKind.Sequential)]
    private struct KBDLLHOOKSTRUCT
    {
        public uint vkCode;
        public uint scanCode;
        public uint flags;
        public uint time;
        public IntPtr dwExtraInfo;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct MSG
    {
        public IntPtr hwnd;
        public uint message;
        public IntPtr wParam;
        public IntPtr lParam;
        public uint time;
        public int ptX;
        public int ptY;
    }

    [DllImport("user32.dll", SetLastError = true)] private static extern IntPtr SetWindowsHookExW(int idHook, HookProc lpfn, IntPtr hMod, uint dwThreadId);
    [DllImport("user32.dll")] private static extern bool UnhookWindowsHookEx(IntPtr hhk);
    [DllImport("user32.dll")] private static extern IntPtr CallNextHookEx(IntPtr hhk, int nCode, IntPtr wParam, IntPtr lParam);
    [DllImport("user32.dll")] private static extern int GetMessageW(out MSG msg, IntPtr hWnd, uint min, uint max);
    [DllImport("user32.dll")] private static extern bool PostThreadMessageW(uint threadId, uint msg, IntPtr wParam, IntPtr lParam);
    [DllImport("kernel32.dll")] private static extern uint GetCurrentThreadId();
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode)] private static extern IntPtr GetModuleHandleW(string? name);

    private readonly HookProc _proc; // kept alive for the unmanaged callback
    private Thread? _thread;
    private uint _threadId;
    private IntPtr _hook;
    private volatile bool _running;

    /// <summary>Virtual key code of a non-injected key press.</summary>
    public event Action<int>? KeyDown;
    public event Action<string>? Status;

    public GlobalHotkeys()
    {
        _proc = Callback;
    }

    public void Start()
    {
        if (_running) return;
        _running = true;
        _thread = new Thread(Loop) { IsBackground = true, Name = "DFH hotkeys" };
        _thread.Start();
    }

    private void Loop()
    {
        _threadId = GetCurrentThreadId();
        _hook = SetWindowsHookExW(WH_KEYBOARD_LL, _proc, GetModuleHandleW(null), 0);
        if (_hook == IntPtr.Zero)
        {
            Status?.Invoke($"全局热键注册失败（错误 {Marshal.GetLastWin32Error()}），请用界面按钮控制");
            _running = false;
            return;
        }
        Status?.Invoke("全局热键已就绪");
        while (_running && GetMessageW(out var msg, IntPtr.Zero, 0, 0) > 0)
        {
            if (msg.message == WM_QUIT) break;
        }
        UnhookWindowsHookEx(_hook);
        _hook = IntPtr.Zero;
    }

    private IntPtr Callback(int nCode, IntPtr wParam, IntPtr lParam)
    {
        if (nCode >= 0 && (wParam == WM_KEYDOWN || wParam == WM_SYSKEYDOWN))
        {
            var data = Marshal.PtrToStructure<KBDLLHOOKSTRUCT>(lParam);
            if ((data.flags & LLKHF_INJECTED) == 0)
            {
                var handler = KeyDown;
                if (handler != null) ThreadPool.QueueUserWorkItem(_ => handler((int)data.vkCode));
            }
        }
        return CallNextHookEx(_hook, nCode, wParam, lParam);
    }

    public void Dispose()
    {
        if (!_running) return;
        _running = false;
        if (_threadId != 0) PostThreadMessageW(_threadId, WM_QUIT, IntPtr.Zero, IntPtr.Zero);
        _thread?.Join(1000);
    }

    public static string KeyName(int vk) => vk is >= 0x70 and <= 0x7B ? $"F{vk - 0x70 + 1}" : $"VK 0x{vk:X2}";
}
