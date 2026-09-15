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
    private readonly Func<bool> _isPaused;
    private readonly Func<string> _practiceSummary;
    private readonly Func<int> _stepIndex;
    private readonly Func<double> _elapsed;
    private readonly Func<IReadOnlyList<GameNote>> _notes;
    private readonly Func<bool> _manualMode;
    private readonly OverlaySettings _settings;
    private readonly Action _save;
    private readonly Func<string> _hotkeyHint;
    private readonly DispatcherTimer _saveTimer;
    private bool _locked;
    private bool _keyboardAdjustment;
    private string _adjustmentHint = "";
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
    [DllImport("user32.dll")] private static extern int GetSystemMetrics(int index);

    public VisualOverlayWindow(Func<bool> isBusy, Func<double> elapsed, Func<IReadOnlyList<GameNote>> notes,
        Func<bool> manualMode, OverlaySettings settings, Action save, Func<string> hotkeyHint, Func<bool>? isPaused = null,
        Func<string>? practiceSummary = null, Func<int>? stepIndex = null)
    {
        InitializeComponent();
        _isBusy = isBusy;
        _isPaused = isPaused ?? (() => false);
        _practiceSummary = practiceSummary ?? (() => "");
        _stepIndex = stepIndex ?? (() => -1);
        _elapsed = elapsed;
        _notes = notes;
        _manualMode = manualMode;
        _settings = settings;
        _save = save;
        _hotkeyHint = hotkeyHint;
        KeyLabelsToggle.IsChecked = settings.ShowKeyLabels;
        NotesView.ShowKeyLabels = settings.ShowKeyLabels;
        ApplyAppearance();
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

    public void SetKeyboardAdjustment(bool active, string hint)
    {
        _keyboardAdjustment = active;
        _adjustmentHint = hint;
        SetInputMode(_isBusy() || active);
        OverlayBackground.BorderBrush = new SolidColorBrush(active ? Color.FromRgb(200, 217, 58) : Color.FromArgb(130, 149, 169, 182));
        if (!active) { _saveTimer.Stop(); SaveBounds(); }
    }

    public void AdjustWithKeyboard(OverlayAdjustment adjustment)
    {
        if (!_keyboardAdjustment || !IsVisible) return;
        var hwnd = new WindowInteropHelper(this).Handle;
        if (!GetWindowRect(hwnd, out var rect)) return;
        var bounds = new OverlayBounds(rect.Left, rect.Top, rect.Right - rect.Left, rect.Bottom - rect.Top);
        var desktop = new OverlayBounds(GetSystemMetrics(76), GetSystemMetrics(77), GetSystemMetrics(78), GetSystemMetrics(79));
        if (desktop.Width <= 0 || desktop.Height <= 0) return;
        var dpi = VisualTreeHelper.GetDpi(this);
        var next = bounds.Adjust(adjustment, desktop, (int)Math.Ceiling(MinWidth * dpi.DpiScaleX), (int)Math.Ceiling(MinHeight * dpi.DpiScaleY));
        // Keep the game focused and its mouse capture intact.
        SetWindowPos(hwnd, IntPtr.Zero, next.Left, next.Top, next.Width, next.Height, 0x14);
    }

    public void ApplyAppearance()
    {
        var opacity = 1 - _settings.BackgroundTransparency / 100;
        OverlayBackground.Background = new SolidColorBrush(Color.FromArgb((byte)Math.Round(255 * opacity), 24, 37, 46));
        NotesView.BackgroundOpacity = opacity;
        NotesView.FlowSpeed = _settings.FlowSpeed;
        NotesView.InvalidateVisual();
    }

    private void UpdateHeading() => Heading.Text = (_manualMode() ? "手动可视化" : "自动演奏 · 可视化")
        + (_keyboardAdjustment ? " · 键盘调整中" : _locked ? " · 已锁定" : " · 拖动这里移动");

    private void RenderFrame(object? sender, EventArgs e)
    {
        if (!IsVisible) return;
        if (_locked != (_isBusy() || _keyboardAdjustment)) SetInputMode(_isBusy() || _keyboardAdjustment);
        var elapsed = _elapsed();
        NotesView.TimeMs = elapsed;
        NotesView.OnlyNoteIndex = _stepIndex();
        NotesView.InvalidateVisual();
        var hint = _keyboardAdjustment ? _adjustmentHint
            : (_isPaused() ? "已暂停 · " : _isBusy() && elapsed < 0 ? $"{Math.Ceiling(-elapsed / 1000):0} 秒后开始 · " : "") + _hotkeyHint();
        if (_lastHint != hint) Hint.Text = _lastHint = hint;
        var practice = _practiceSummary();
        if (PracticeText.Text != practice) PracticeText.Text = practice;
        PracticeText.Visibility = practice.Length > 0 ? Visibility.Visible : Visibility.Collapsed;
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
