using System.Runtime.InteropServices;

namespace DFH.Desktop.Services;

/// <summary>
/// Global start/stop keys via a low-level keyboard hook on its own message
/// thread. Ordinary playback keys pass through; overlay adjustment keys are
/// consumed while adjusting. Injected events (our own SendInput) are ignored so playback
/// cannot trigger itself. KeyDown is raised on the hook thread.
/// </summary>
public sealed class GlobalHotkeys : IDisposable
{
    private const int WH_KEYBOARD_LL = 13;
    private const int WH_MOUSE_LL = 14;
    [StructLayout(LayoutKind.Sequential)]
    private struct MouseHookData
    {
        public int X, Y;
        public uint MouseData, Flags, Time;
        public IntPtr ExtraInfo;
    }
    private const int WM_KEYDOWN = 0x0100;
    private const int WM_SYSKEYDOWN = 0x0104;
    private const int WM_KEYUP = 0x0101;
    private const int WM_SYSKEYUP = 0x0105;
    private readonly HashSet<uint> _heldKeys = [];
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
    [DllImport("user32.dll")] private static extern short GetAsyncKeyState(int key);
    [DllImport("user32.dll")] private static extern IntPtr GetForegroundWindow();

    private readonly HookProc _proc; // kept alive for the unmanaged callback
    private readonly HookProc _mouseProc;
    private IntPtr _mouseHook;
    private bool _left, _right, _middle;
    public bool PracticeInputAvailable => _hook != IntPtr.Zero && _mouseHook != IntPtr.Zero;
    public event Action<PracticeInput>? NotePressed;
    private Thread? _thread;
    private uint _threadId;
    private IntPtr _hook;
    private volatile bool _running;
    private readonly OverlayAdjustmentInput _adjustmentInput = new();
    private volatile OverlayAdjustmentKeys _adjustmentKeys = new();
    private volatile bool _adjustmentActive;
    private volatile bool _adjustmentEnabled = true;

    public bool AdjustmentActive { get => _adjustmentActive; set => _adjustmentActive = value; }
    public bool AdjustmentEnabled { get => _adjustmentEnabled; set => _adjustmentEnabled = value; }
    public void ConfigureAdjustment(AppSettings settings) => _adjustmentKeys = OverlayAdjustmentKeys.From(settings);
    public event Action<bool>? AdjustmentModeChanged;
    public event Action<OverlayAdjustment>? AdjustOverlay;

    /// <summary>Virtual key code of a non-injected key press.</summary>
    public event Action<int>? KeyDown;
    public event Action<string>? Status;

    public GlobalHotkeys()
    {
        _proc = Callback;
        _mouseProc = MouseCallback;
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
        _left = GetAsyncKeyState(1) < 0;
        _right = GetAsyncKeyState(2) < 0;
        _middle = GetAsyncKeyState(4) < 0;
        _mouseHook = SetWindowsHookExW(WH_MOUSE_LL, _mouseProc, GetModuleHandleW(null), 0);
        Status?.Invoke(_mouseHook == IntPtr.Zero ? "鼠标监听未就绪，练习计分不可用；播放热键仍可用" : "全局热键与练习输入监听已就绪");
        while (_running && GetMessageW(out var msg, IntPtr.Zero, 0, 0) > 0)
        {
            if (msg.message == WM_QUIT) break;
        }
        UnhookWindowsHookEx(_hook);
        _hook = IntPtr.Zero;
        if (_mouseHook != IntPtr.Zero) UnhookWindowsHookEx(_mouseHook);
        _mouseHook = IntPtr.Zero;
    }

    private IntPtr Callback(int nCode, IntPtr wParam, IntPtr lParam)
    {
        if (nCode >= 0 && (wParam == WM_KEYDOWN || wParam == WM_SYSKEYDOWN || wParam == WM_KEYUP || wParam == WM_SYSKEYUP))
        {
            var data = Marshal.PtrToStructure<KBDLLHOOKSTRUCT>(lParam);
            if ((data.flags & LLKHF_INJECTED) == 0)
            {
                var down = wParam == WM_KEYDOWN || wParam == WM_SYSKEYDOWN;
                var result = _adjustmentInput.Process((int)data.vkCode, down, _adjustmentActive, _adjustmentEnabled, _adjustmentKeys);
                if (result.Toggle)
                {
                    _adjustmentActive = !_adjustmentActive;
                    AdjustmentModeChanged?.Invoke(_adjustmentActive);
                }
                if (result.Adjustment is { } adjustment) AdjustOverlay?.Invoke(adjustment);
                if (!down) _heldKeys.Remove(data.vkCode);
                else if (_heldKeys.Add(data.vkCode))
                {
                    var handler = KeyDown;
                    // Subscribers only enqueue UI work, preserving hook event order.
                    if (!result.Suppress) handler?.Invoke((int)data.vkCode);
                    if (!result.Suppress && !_adjustmentActive && PracticeInput.IsNoteKey((int)data.vkCode))
                        NotePressed?.Invoke(new PracticeInput((int)data.vkCode, VisualPlayback.NowMs, _left, _right, _middle, GetForegroundWindow()));
                }
                if (result.Suppress) return new IntPtr(1);
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

    private IntPtr MouseCallback(int nCode, IntPtr wParam, IntPtr lParam)
    {
        if (nCode >= 0 && (int)wParam is 0x201 or 0x202 or 0x204 or 0x205 or 0x207 or 0x208)
        {
            var data = Marshal.PtrToStructure<MouseHookData>(lParam);
            if ((data.Flags & 1) == 0) // LLMHF_INJECTED: ignore automatic playback.
            {
                switch ((int)wParam)
                {
                    case 0x201: _left = true; break;
                    case 0x202: _left = false; break;
                    case 0x204: _right = true; break;
                    case 0x205: _right = false; break;
                    case 0x207: _middle = true; break;
                    case 0x208: _middle = false; break;
                }
            }
        }
        return CallNextHookEx(_mouseHook, nCode, wParam, lParam);
    }

    public static string KeyName(int vk) => AppSettings.IsSupportedHotkey(vk) ? $"F{vk - 0x70 + 1}" : vk switch
    {
        0x25 => "←", 0x26 => "↑", 0x27 => "→", 0x28 => "↓", 0x10 => "Shift", 0x11 => "Ctrl",
        >= 0x41 and <= 0x5A => ((char)vk).ToString(), _ => $"VK 0x{vk:X2}"
    };
}
