namespace DFH.Desktop.Services;

public enum OverlayDirection { Left, Up, Right, Down }
public readonly record struct OverlayAdjustment(OverlayDirection Direction, bool Resize, bool Fine);
public readonly record struct OverlayBounds(int Left, int Top, int Width, int Height)
{
    // Coordinates and steps are physical pixels, including on scaled displays.
    public OverlayBounds Adjust(OverlayAdjustment adjustment, OverlayBounds desktop, int minWidth, int minHeight)
    {
        var step = adjustment.Fine ? 1 : 10;
        var dx = adjustment.Direction == OverlayDirection.Left ? -step : adjustment.Direction == OverlayDirection.Right ? step : 0;
        var dy = adjustment.Direction == OverlayDirection.Up ? -step : adjustment.Direction == OverlayDirection.Down ? step : 0;
        var width = Math.Clamp(Width + (adjustment.Resize ? dx : 0), Math.Min(minWidth, desktop.Width), desktop.Width);
        var height = Math.Clamp(Height + (adjustment.Resize ? dy : 0), Math.Min(minHeight, desktop.Height), desktop.Height);
        var left = Math.Clamp(Left + (adjustment.Resize ? 0 : dx), desktop.Left, desktop.Left + desktop.Width - width);
        var top = Math.Clamp(Top + (adjustment.Resize ? 0 : dy), desktop.Top, desktop.Top + desktop.Height - height);
        return new(left, top, width, height);
    }
}

public sealed record OverlayAdjustmentKeys(int Toggle = 0x79, int Left = 0x25, int Up = 0x26,
    int Right = 0x27, int Down = 0x28, int FineModifier = 0x10, int ResizeModifier = 0x11)
{
    public static OverlayAdjustmentKeys From(AppSettings settings) => new(settings.AdjustOverlayHotkey,
        settings.OverlayLeftKey, settings.OverlayUpKey, settings.OverlayRightKey, settings.OverlayDownKey,
        settings.OverlayFineModifier, settings.OverlayResizeModifier);
}

public readonly record struct OverlayKeyResult(bool Suppress, bool Toggle = false, OverlayAdjustment? Adjustment = null);

/// <summary>Runs synchronously on the keyboard hook. Keeps swallowed key-up events
/// paired with key-down even after exiting adjustment or changing bindings.</summary>
public sealed class OverlayAdjustmentInput
{
    private readonly HashSet<int> _held = [];
    private readonly HashSet<int> _suppressed = [];
    public static int Modifier(int key) => key switch
    {
        0xA0 or 0xA1 => 0x10,
        0xA2 or 0xA3 => 0x11,
        _ => key
    };

    public OverlayKeyResult Process(int key, bool down, bool active, bool enabled, OverlayAdjustmentKeys keys)
    {
        if (!down)
        {
            _held.Remove(key);
            return new(_suppressed.Remove(key));
        }
        var first = _held.Add(key);
        // A press that already reached the game must also deliver its release.
        if (!first && !_suppressed.Contains(key)) return new(false);
        if (enabled && key == keys.Toggle)
        {
            _suppressed.Add(key);
            return new(true, Toggle: first);
        }
        if (active && enabled)
        {
            var modifier = Modifier(key);
            if (modifier == keys.FineModifier || modifier == keys.ResizeModifier)
            {
                _suppressed.Add(key);
                return new(true);
            }
            OverlayDirection? direction = key == keys.Left ? OverlayDirection.Left : key == keys.Up ? OverlayDirection.Up
                : key == keys.Right ? OverlayDirection.Right : key == keys.Down ? OverlayDirection.Down : null;
            if (direction != null)
            {
                _suppressed.Add(key);
                return new(true, Adjustment: new OverlayAdjustment(direction.Value,
                    _held.Any(held => Modifier(held) == keys.ResizeModifier),
                    _held.Any(held => Modifier(held) == keys.FineModifier)));
            }
        }
        return new(_suppressed.Contains(key));
    }
}
