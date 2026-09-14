using System.Globalization;
using System.Windows;
using System.Windows.Media;
using DFH.Core.Harmonica;

namespace DFH.Desktop.Views;

public sealed class NoteFallView : FrameworkElement
{
    public const double LookAheadMs = 3000;
    private static readonly Brush Normal = Frozen("#79DFC4");
    private static readonly Brush Low = Frozen("#7CB8FF");
    private static readonly Brush High = Frozen("#FFB969");
    private static readonly Brush Sharp = Frozen("#F58AE2");
    private static readonly Brush Ink = Frozen("#102029");
    private static readonly Brush GridBrush = Frozen("#557A8993");
    private static readonly Brush TrackBackground = Frozen("#40101C25");
    private static readonly Typeface Font = new("Microsoft YaHei UI");
    private IReadOnlyList<GameNote> _notes = [];
    private double[] _prefixEnds = [];
    public double TimeMs { get; set; } = -LookAheadMs;
    public bool ShowKeyLabels { get; set; } = true;

    public void Load(IReadOnlyList<GameNote> notes)
    {
        _notes = notes;
        _prefixEnds = new double[notes.Count];
        var end = double.NegativeInfinity;
        for (var i = 0; i < notes.Count; i++) _prefixEnds[i] = end = Math.Max(end, notes[i].Start + notes[i].Duration);
        InvalidateVisual();
    }

    protected override void OnRender(DrawingContext dc)
    {
        base.OnRender(dc);
        var width = ActualWidth;
        var height = ActualHeight;
        if (width < 8 || height < 60) return;
        var lane = width / 8;
        var line = height - (ShowKeyLabels ? 48 : 8);
        var scale = line / LookAheadMs;
        dc.DrawRectangle(TrackBackground, null, new Rect(0, 0, width, height));
        for (var i = 1; i < 8; i++) dc.DrawLine(new Pen(GridBrush, 1), new Point(i * lane, 0), new Point(i * lane, height));
        dc.DrawLine(new Pen(Brushes.White, 2), new Point(0, line), new Point(width, line));

        // Prefix maximum ends allow binary search without dropping long notes at the visible boundary.
        var low = 0;
        var high = _notes.Count;
        while (low < high)
        {
            var mid = (low + high) / 2;
            if (_prefixEnds[mid] < TimeMs) low = mid + 1;
            else high = mid;
        }
        dc.PushClip(new RectangleGeometry(new Rect(0, 0, width, line)));
        for (var i = low; i < _notes.Count && _notes[i].Start <= TimeMs + LookAheadMs; i++)
        {
            var note = _notes[i];
            if (note.Start + note.Duration <= TimeMs) continue;
            var bottom = line - (note.Start - TimeMs) * scale;
            var top = bottom - Math.Max(24, note.Duration * scale);
            var visibleTop = Math.Max(-30, top);
            var visibleBottom = Math.Min(line, bottom);
            if (visibleBottom <= visibleTop) continue;
            var fill = note.OctaveModifier < 0 ? Low : note.OctaveModifier > 0 ? High : Normal;
            var rect = new Rect(note.KeyIndex * lane + 5, visibleTop, lane - 10, visibleBottom - visibleTop);
            dc.DrawRoundedRectangle(fill, note.Sharp ? new Pen(Sharp, 4) : null, rect, 5, 5);
            if (ShowKeyLabels)
            {
                var label = Mapping.ModifierLabel(note.Candidate);
                if (label.Length == 0) label = note.Degree.ToString();
                DrawText(dc, label, note.KeyIndex * lane + lane / 2, Math.Min(line - 24, bottom - 24), Math.Clamp(lane * .24, 12, 20), Ink);
            }
        }
        dc.Pop();
        if (!ShowKeyLabels) return;
        for (var i = 0; i < 8; i++)
        {
            var key = Mapping.BaseKeys[i];
            DrawText(dc, $"{key.Degree}{(i == 7 ? "↑" : "")}  {key.Key}", i * lane + lane / 2, line + 12, Math.Clamp(lane * .21, 11, 18), Brushes.White);
        }
    }

    private void DrawText(DrawingContext dc, string text, double center, double top, double size, Brush brush)
    {
        var formatted = new FormattedText(text, CultureInfo.CurrentUICulture, FlowDirection.LeftToRight, Font, size, brush, VisualTreeHelper.GetDpi(this).PixelsPerDip);
        dc.DrawText(formatted, new Point(center - formatted.Width / 2, top));
    }

    private static Brush Frozen(string color)
    {
        var brush = (SolidColorBrush)new BrushConverter().ConvertFromString(color)!;
        brush.Freeze();
        return brush;
    }
}
