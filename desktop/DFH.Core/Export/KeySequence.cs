using DFH.Core.Harmonica;
using DFH.Core.Music;

namespace DFH.Core.Export;

public enum InputKind { Key, Mouse }

public enum MouseButton { Left, Middle, Right }

/// <summary>A single physical input: a keyboard key (lowercase name) or a mouse button.</summary>
public readonly record struct InputTarget(InputKind Kind, string Name)
{
    public static InputTarget Key(string name) => new(InputKind.Key, name);
    public static InputTarget Mouse(MouseButton button) => new(InputKind.Mouse, button switch
    {
        MouseButton.Left => "left",
        MouseButton.Middle => "middle",
        _ => "right"
    });

    /// <summary>Same identifier the web uses: <c>key:z</c>, <c>mouse:right</c>.</summary>
    public string Id => Kind == InputKind.Key ? $"key:{Name}" : $"mouse:{Name}";

    public MouseButton Button => Name switch
    {
        "left" => MouseButton.Left,
        "middle" => MouseButton.Middle,
        _ => MouseButton.Right
    };

    public string Label => Kind == InputKind.Key
        ? Name
        : Name switch { "left" => "左键", "right" => "右键", _ => "中键" };
}

/// <summary>Physical inputs the game listens on: eight note keys plus three mouse modifiers.</summary>
public sealed class InputBinding
{
    public required IReadOnlyDictionary<string, InputTarget> Notes { get; init; }
    public required InputTarget OctaveUp { get; init; }
    public required InputTarget OctaveDown { get; init; }
    public required InputTarget Semitone { get; init; }

    public static readonly InputBinding Game = new()
    {
        Notes = new Dictionary<string, InputTarget>
        {
            ["Z"] = InputTarget.Key("z"), ["X"] = InputTarget.Key("x"), ["C"] = InputTarget.Key("c"), ["V"] = InputTarget.Key("v"),
            ["B"] = InputTarget.Key("b"), ["N"] = InputTarget.Key("n"), ["M"] = InputTarget.Key("m"), [","] = InputTarget.Key("comma")
        },
        OctaveUp = InputTarget.Mouse(MouseButton.Right),
        OctaveDown = InputTarget.Mouse(MouseButton.Left),
        Semitone = InputTarget.Mouse(MouseButton.Middle)
    };

    public IReadOnlyList<InputTarget> AllTargets()
    {
        var seen = new Dictionary<string, InputTarget>();
        foreach (var target in Notes.Values.Concat([OctaveUp, OctaveDown, Semitone])) seen[target.Id] = target;
        return seen.Values.ToList();
    }
}

/// <param name="Time">Milliseconds from the start of the sequence.</param>
/// <param name="NoteIndex">Index into the game-note list for note key actions, -1 for modifiers. Not part of the web format.</param>
public sealed record InputAction(double Time, InputTarget Target, bool Down, int NoteIndex);

public sealed record KeySequenceOptions
{
    public InputBinding Binding { get; init; } = InputBinding.Game;
    /// <summary>Modifiers go down this early so the game registers them before the note.</summary>
    public double ModifierLeadMs { get; init; } = 12;
    /// <summary>Notes are released early by this much so a repeated pitch retriggers.</summary>
    public double ReleaseGapMs { get; init; } = 18;
    public double MinNoteMs { get; init; } = 30;
}

public sealed class KeySequence
{
    public required IReadOnlyList<InputAction> Actions { get; init; }
    public required double DurationMs { get; init; }
    public required InputBinding Binding { get; init; }
    public required int NoteCount { get; init; }
    public required int DroppedChordNotes { get; init; }
    public required int TruncatedNotes { get; init; }
    public required int ModifierPresses { get; init; }

    /// <summary>Absolute times converted to inter-event delays.</summary>
    public IReadOnlyList<(InputAction Action, double DelayMs)> ToDelays()
    {
        var result = new List<(InputAction, double)>(Actions.Count);
        double previous = 0;
        foreach (var action in Actions)
        {
            var delay = Math.Max(0, JsMath.Round(action.Time - previous));
            previous = action.Time;
            result.Add((action, delay));
        }
        return result;
    }
}

/// <summary>Port of buildKeySequence in src/export/keySequence.ts.</summary>
public static class KeySequenceBuilder
{
    private static List<InputTarget> ModifierTargets(GameNote note, InputBinding binding)
    {
        var targets = new List<InputTarget>();
        if (note.OctaveModifier > 0) targets.Add(binding.OctaveUp);
        else if (note.OctaveModifier < 0) targets.Add(binding.OctaveDown);
        if (note.Sharp) targets.Add(binding.Semitone);
        return targets;
    }

    /// <summary>
    /// Flattens optimized notes into an absolute-time press/release stream.
    /// Modifiers are held across consecutive notes that need the same ones.
    /// </summary>
    public static KeySequence Build(IReadOnlyList<GameNote> notes, KeySequenceOptions? options = null)
    {
        options ??= new KeySequenceOptions();
        var binding = options.Binding;
        var leadMs = options.ModifierLeadMs;
        var releaseGapMs = options.ReleaseGapMs;
        var minNoteMs = options.MinNoteMs;

        var sorted = notes
            .Select((note, index) => (Note: note, Index: index))
            .OrderBy(item => item.Note.Start)
            .ThenByDescending(item => item.Note.Pitch)
            .ToList();

        var actions = new List<InputAction>();
        var held = new List<InputTarget>();
        double lastTime = 0;
        var noteCount = 0;
        var droppedChordNotes = 0;
        var truncatedNotes = 0;
        var modifierPresses = 0;

        for (var i = 0; i < sorted.Count; i++)
        {
            var note = sorted[i].Note;
            if (i > 0 && note.Start <= sorted[i - 1].Note.Start)
            {
                droppedChordNotes++;
                continue;
            }

            var end = note.Start + note.Duration;
            if (i + 1 < sorted.Count && sorted[i + 1].Note.Start < end)
            {
                end = sorted[i + 1].Note.Start;
                truncatedNotes++;
            }

            var wanted = ModifierTargets(note, binding);
            var wantedIds = wanted.Select(target => target.Id).ToHashSet();
            var heldIds = held.Select(target => target.Id).ToHashSet();
            var switchTime = Math.Max(lastTime, note.Start - leadMs);
            foreach (var target in held)
            {
                if (!wantedIds.Contains(target.Id)) actions.Add(new InputAction(switchTime, target, false, -1));
            }
            foreach (var target in wanted)
            {
                if (!heldIds.Contains(target.Id))
                {
                    actions.Add(new InputAction(switchTime, target, true, -1));
                    modifierPresses++;
                }
            }
            held = wanted;

            var noteTarget = binding.Notes[note.Key];
            var down = Math.Max(switchTime, note.Start);
            var up = Math.Max(down + minNoteMs, end - releaseGapMs);
            actions.Add(new InputAction(down, noteTarget, true, sorted[i].Index));
            actions.Add(new InputAction(up, noteTarget, false, sorted[i].Index));
            lastTime = up;
            noteCount++;
        }

        foreach (var target in held) actions.Add(new InputAction(lastTime, target, false, -1));

        // Releases sort before presses at the same instant so an input is never left down.
        var ordered = actions.OrderBy(action => action.Time).ThenBy(action => action.Down ? 1 : 0).ToList();

        return new KeySequence
        {
            Actions = ordered,
            DurationMs = ordered.Count > 0 ? ordered[^1].Time : 0,
            Binding = binding,
            NoteCount = noteCount,
            DroppedChordNotes = droppedChordNotes,
            TruncatedNotes = truncatedNotes,
            ModifierPresses = modifierPresses
        };
    }
}
