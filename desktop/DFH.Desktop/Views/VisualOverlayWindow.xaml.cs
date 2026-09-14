using System.Runtime.InteropServices;
using System.Windows;
using System.Windows.Controls.Primitives;
using System.Windows.Input;
using System.Windows.Interop;
using System.Windows.Media;
using System.Windows.Threading;
using DFH.Desktop.Services;
using DFH.Core.Harmonica;

namespace DFH.Desktop.Views;

public partial class VisualOverlayWindow : Window
{
    private readonly Func<bool> _isBusy;
    private readonly Func<double> _elapsed;
    private readonly Func<IReadOnlyList<GameNote>> _notes;
    private readonly Func<bool> _manualMode;
    private readonly OverlaySettings _settings;
    private readonly Action _save;
    private readonly Func<string> _hotkeyHint;
    private readonly DispatcherTimer _saveTimer;
    private bool _locked;
    private string _lastHint = "";
    private const int GwlExStyle = -20;
    private const int Transparent = 0x20;
    private const int NoActivate = 0x08000000;

    [DllImport("user32.dll")] private static extern int GetWindowLongW(IntPtr hwnd, int index);
    [DllImport("user32.dll")] private static extern int SetWindowLongW(IntPtr hwnd, int index, int value);
    [StructLayout(LayoutKind.Sequential)] private struct NativeRect { public int Left, Top, Right, Bottom; }
    [StructLayout(LayoutKind.Sequential)] private struct MonitorInfo { public int Size; public NativeRect Monitor, Work; public uint Flags; }
    [DllImport("user32.dll")] private static extern IntPtr MonitorFromWindow(IntPtr hwnd, uint flags);
    [DllImport("user32.dll")] private static extern bool GetMonitorInfoW(IntPtr monitor, ref MonitorInfo info);
    [DllImport("user32.dll")] private static extern bool GetWindowRect(IntPtr hwnd, out NativeRect rect);
    [DllImport("user32.dll")] private static extern bool SetWindowPos(IntPtr hwnd, IntPtr after, int x, int y, int width, int height, uint flags);

    public VisualOverlayWindow(Func<bool> isBusy, Func<double> elapsed, Func<IReadOnlyList<GameNote>> notes,
        Func<bool> manualMode, OverlaySettings settings, Action save, Func<string> hotkeyHint)
    {
        InitializeComponent();
        _isBusy = isBusy;
        _elapsed = elapsed;
        _notes = notes;
        _manualMode = manualMode;
        _settings = settings;
        _save = save;
        _hotkeyHint = hotkeyHint;
        KeyLabelsToggle.IsChecked = settings.ShowKeyLabels;
        NotesView.ShowKeyLabels = settings.ShowKeyLabels;
        Width = FiniteClamp(settings.Width, 440, Math.Max(440, SystemParameters.VirtualScreenWidth), 640);
        Height = FiniteClamp(settings.Height, 260, Math.Max(260, SystemParameters.VirtualScreenHeight), 460);
        Left = FiniteClamp(settings.Left, SystemParameters.VirtualScreenLeft, SystemParameters.VirtualScreenLeft + SystemParameters.VirtualScreenWidth - Width, SystemParameters.WorkArea.Left);
        Top = FiniteClamp(settings.Top, SystemParameters.VirtualScreenTop, SystemParameters.VirtualScreenTop + SystemParameters.VirtualScreenHeight - Height, SystemParameters.WorkArea.Top);
        _saveTimer = new DispatcherTimer { Interval = TimeSpan.FromMilliseconds(400) };
        _saveTimer.Tick += (_, _) => { _saveTimer.Stop(); SaveBounds(); };
        LocationChanged += ScheduleSave;
        SizeChanged += ScheduleSave;
        SourceInitialized += (_, _) => { RestoreToVisibleMonitor(); SetInputMode(_isBusy()); };
        Loaded += (_, _) => { Reload(); CompositionTarget.Rendering += RenderFrame; };
        Closed += (_, _) => { CompositionTarget.Rendering -= RenderFrame; _saveTimer.Stop(); SaveBounds(); };
    }

    private static double FiniteClamp(double value, double min, double max, double fallback) =>
        Math.Clamp(double.IsFinite(value) ? value : fallback, min, Math.Max(min, max));

    private void RestoreToVisibleMonitor()
    {
        // Native pixels avoid mixing WPF DIPs with monitor coordinates at different DPI scales.
        var hwnd = new WindowInteropHelper(this).Handle;
        var info = new MonitorInfo { Size = Marshal.SizeOf<MonitorInfo>() };
        if (!GetWindowRect(hwnd, out var bounds) || !GetMonitorInfoW(MonitorFromWindow(hwnd, 2), ref info)) return;
        var width = Math.Min(bounds.Right - bounds.Left, info.Work.Right - info.Work.Left);
        var height = Math.Min(bounds.Bottom - bounds.Top, info.Work.Bottom - info.Work.Top);
        var left = Math.Clamp(bounds.Left, info.Work.Left, info.Work.Right - width);
        var top = Math.Clamp(bounds.Top, info.Work.Top, info.Work.Bottom - height);
        SetWindowPos(hwnd, IntPtr.Zero, left, top, width, height, 0x14); // NOZORDER | NOACTIVATE
    }

    public void Reload() { NotesView.Load(_notes()); UpdateHeading(); }

    private void UpdateHeading() => Heading.Text = (_manualMode() ? "手动可视化" : "自动演奏 · 可视化")
        + (_locked ? " · 已锁定" : " · 拖动这里移动");

    private void RenderFrame(object? sender, EventArgs e)
    {
        if (_locked != _isBusy()) SetInputMode(_isBusy());
        var elapsed = _elapsed();
        NotesView.TimeMs = elapsed;
        NotesView.InvalidateVisual();
        var hint = _isBusy()
            ? (elapsed < 0 ? $"{Math.Ceiling(-elapsed / 1000):0} 秒后开始 · " : _manualMode() ? "到线按下，长条结束松开 · " : "跟随自动演奏 · ") + _hotkeyHint() + " · 鼠标已穿透"
            : _hotkeyHint() + " · 可拖动标题、右下角缩放 · 自动记忆";
        if (_lastHint != hint) Hint.Text = _lastHint = hint;
    }

    private void SetInputMode(bool locked)
    {
        _locked = locked;
        var hwnd = new WindowInteropHelper(this).Handle;
        var style = GetWindowLongW(hwnd, GwlExStyle) | NoActivate;
        SetWindowLongW(hwnd, GwlExStyle, locked ? style | Transparent : style & ~Transparent);
        UpdateHeading();
        ResizeThumb.Visibility = locked ? Visibility.Collapsed : Visibility.Visible;
    }

    private void DragHeader(object sender, MouseButtonEventArgs e)
    {
        if (!_locked && e.OriginalSource is not System.Windows.Controls.Button && e.LeftButton == MouseButtonState.Pressed) DragMove();
    }
    private void ResizeOverlay(object sender, DragDeltaEventArgs e)
    {
        if (_locked) return;
        Width = Math.Max(MinWidth, ActualWidth + e.HorizontalChange);
        Height = Math.Max(MinHeight, ActualHeight + e.VerticalChange);
    }
    private void CloseOverlay(object sender, RoutedEventArgs e) => Close();
    private void ToggleKeyLabels(object sender, RoutedEventArgs e)
    {
        NotesView.ShowKeyLabels = _settings.ShowKeyLabels = KeyLabelsToggle.IsChecked == true;
        NotesView.InvalidateVisual();
        _save();
    }
    private void ScheduleSave(object? sender, EventArgs e) { _saveTimer.Stop(); _saveTimer.Start(); }
    private void SaveBounds()
    {
        _settings.Left = Left; _settings.Top = Top;
        _settings.Width = ActualWidth; _settings.Height = ActualHeight;
        _save();
    }
}
