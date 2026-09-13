using System.Runtime.InteropServices;
using DFH.Core.Export;

namespace DFH.Desktop.Services;

/// <summary>
/// Sends keyboard and mouse input with Win32 SendInput. Keys go out as scan
/// codes with an empty virtual key, which is what Unreal's raw input path
/// expects; virtual-key-only events are ignored by many games. Mouse buttons use
/// the plain MOUSEEVENTF flags. No driver, no hardware: this is exactly what the
/// game already accepts from other harmonica players, provided this process is
/// elevated like the game.
/// </summary>
public static class InputSender
{
    private const int INPUT_MOUSE = 0;
    private const int INPUT_KEYBOARD = 1;
    private const uint KEYEVENTF_KEYUP = 0x0002;
    private const uint KEYEVENTF_SCANCODE = 0x0008;
    private const uint MOUSEEVENTF_LEFTDOWN = 0x0002;
    private const uint MOUSEEVENTF_LEFTUP = 0x0004;
    private const uint MOUSEEVENTF_RIGHTDOWN = 0x0008;
    private const uint MOUSEEVENTF_RIGHTUP = 0x0010;
    private const uint MOUSEEVENTF_MIDDLEDOWN = 0x0020;
    private const uint MOUSEEVENTF_MIDDLEUP = 0x0040;
    private const uint MAPVK_VK_TO_VSC = 0;
    private const ushort VK_OEM_COMMA = 0xBC;

    [StructLayout(LayoutKind.Sequential)]
    private struct INPUT
    {
        public uint type;
        public InputUnion U;
    }

    [StructLayout(LayoutKind.Explicit)]
    private struct InputUnion
    {
        [FieldOffset(0)] public MOUSEINPUT mi;
        [FieldOffset(0)] public KEYBDINPUT ki;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct MOUSEINPUT
    {
        public int dx;
        public int dy;
        public uint mouseData;
        public uint dwFlags;
        public uint time;
        public IntPtr dwExtraInfo;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct KEYBDINPUT
    {
        public ushort wVk;
        public ushort wScan;
        public uint dwFlags;
        public uint time;
        public IntPtr dwExtraInfo;
    }

    [DllImport("user32.dll", SetLastError = true)]
    private static extern uint SendInput(uint nInputs, INPUT[] pInputs, int cbSize);

    [DllImport("user32.dll")]
    private static extern uint MapVirtualKeyW(uint uCode, uint uMapType);

    /// <summary>Marker in dwExtraInfo so our own low-level hook can ignore what we send.</summary>
    public static readonly IntPtr ExtraInfoTag = new(0x0DF4);

    private static ushort VirtualKeyOf(string name)
    {
        if (name == "comma") return VK_OEM_COMMA;
        if (name.Length == 1 && char.IsAsciiLetter(name[0])) return (ushort)char.ToUpperInvariant(name[0]);
        return 0;
    }

    /// <summary>The scan code the game will see for a binding, for the settings page.</summary>
    public static ushort ScanCodeOf(string name) => (ushort)MapVirtualKeyW(VirtualKeyOf(name), MAPVK_VK_TO_VSC);

    private static void SendKey(string name, bool down)
    {
        var vk = VirtualKeyOf(name);
        if (vk == 0) return;
        var input = new INPUT
        {
            type = INPUT_KEYBOARD,
            U = new InputUnion
            {
                ki = new KEYBDINPUT
                {
                    wVk = 0,
                    wScan = (ushort)MapVirtualKeyW(vk, MAPVK_VK_TO_VSC),
                    dwFlags = (down ? 0u : KEYEVENTF_KEYUP) | KEYEVENTF_SCANCODE,
                    time = 0,
                    dwExtraInfo = ExtraInfoTag
                }
            }
        };
        SendInput(1, [input], Marshal.SizeOf<INPUT>());
    }

    private static void SendMouse(MouseButton button, bool down)
    {
        var flag = button switch
        {
            MouseButton.Left => down ? MOUSEEVENTF_LEFTDOWN : MOUSEEVENTF_LEFTUP,
            MouseButton.Right => down ? MOUSEEVENTF_RIGHTDOWN : MOUSEEVENTF_RIGHTUP,
            _ => down ? MOUSEEVENTF_MIDDLEDOWN : MOUSEEVENTF_MIDDLEUP
        };
        var input = new INPUT
        {
            type = INPUT_MOUSE,
            U = new InputUnion { mi = new MOUSEINPUT { dwFlags = flag, dwExtraInfo = ExtraInfoTag } }
        };
        SendInput(1, [input], Marshal.SizeOf<INPUT>());
    }

    public static void Send(InputTarget target, bool down)
    {
        if (target.Kind == InputKind.Key) SendKey(target.Name, down);
        else SendMouse(target.Button, down);
    }

    /// <summary>Lifts every input the binding can hold down. Used before, after and on abort.</summary>
    public static void ReleaseAll(InputBinding binding)
    {
        foreach (var target in binding.AllTargets()) Send(target, false);
    }
}
