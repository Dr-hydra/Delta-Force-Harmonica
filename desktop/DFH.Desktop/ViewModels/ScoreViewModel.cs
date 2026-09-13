using System.Collections.ObjectModel;
using DFH.Core;
using DFH.Core.Harmonica;
using DFH.Core.Score;
using DFH.Desktop.Infrastructure;

namespace DFH.Desktop.ViewModels;

public sealed class NoteViewModel(GameNote note, int index, double durationBeats) : ObservableObject
{
    private bool _isCurrent;

    public int Index { get; } = index;

    /// <summary>Numbered notation digit; octave dots are separate rows because combining marks render as boxes in some UI fonts.</summary>
    public string Digit { get; } = note.Degree.ToString();
    public string DotsAbove { get; } = Dots(Mapping.DisplayOctave(note.Candidate));
    public string DotsBelow { get; } = Dots(-Mapping.DisplayOctave(note.Candidate));
    public string Degree { get; } = DegreeLabel(note);
    public string Modifier { get; } = Mapping.ModifierLabel(note.Candidate);
    public string Key { get; } = note.Key;
    public string Duration { get; } = Measures.DurationLabel(durationBeats);
    public string Tooltip { get; } =
        $"{DegreeLabel(note)}  ·  {Mapping.MidiName(note.Pitch)}  ·  键 {note.Key}{Mapping.ModifierLabel(note.Candidate)}  ·  {note.Start / 1000:0.00}s  ·  {note.Duration:0} ms";

    public bool IsCurrent
    {
        get => _isCurrent;
        set => Set(ref _isCurrent, value);
    }

    private static string Dots(int count) => count > 0 ? string.Join(" ", Enumerable.Repeat("•", count)) : "";

    private static string DegreeLabel(GameNote note)
    {
        var octave = Mapping.DisplayOctave(note.Candidate);
        var suffix = octave > 0 ? $" 高{octave}" : octave < 0 ? $" 低{-octave}" : "";
        return note.Degree + suffix;
    }
}

public sealed class MeasureViewModel(ScoreMeasure measure, IReadOnlyList<NoteViewModel> notes)
{
    public int Number { get; } = measure.Number;
    public string Signature { get; } = $"{measure.Numerator}/{measure.Denominator}";
    public IReadOnlyList<NoteViewModel> Notes { get; } = notes;
    public bool IsEmpty => Notes.Count == 0;
}

/// <summary>The score viewer: measures of note chips, one of which lights up during playback.</summary>
public sealed class ScoreViewModel : ObservableObject
{
    private readonly List<NoteViewModel> _byIndex = [];
    private int _currentIndex = -1;
    private int _currentMeasure = -1;
    private string _summary = "尚未载入谱面";

    public ObservableCollection<MeasureViewModel> Measures { get; } = [];

    public string Summary
    {
        get => _summary;
        private set => Set(ref _summary, value);
    }

    /// <summary>Measure index (0-based) containing the current note, for auto-scroll.</summary>
    public int CurrentMeasure
    {
        get => _currentMeasure;
        private set => Set(ref _currentMeasure, value);
    }

    public bool HasScore => _byIndex.Count > 0;

    public void Load(ScoreDocument? document)
    {
        Measures.Clear();
        _byIndex.Clear();
        _currentIndex = -1;
        CurrentMeasure = -1;

        if (document == null)
        {
            Summary = "尚未载入谱面";
            Raise(nameof(HasScore));
            return;
        }

        var measureOfNote = new Dictionary<int, int>();
        foreach (var measure in document.Measures)
        {
            var notes = measure.Notes.Select(item => new NoteViewModel(item.Note, item.Index, item.DurationBeats)).ToList();
            foreach (var note in notes) measureOfNote[note.Index] = Measures.Count;
            Measures.Add(new MeasureViewModel(measure, notes));
        }
        _byIndex.AddRange(Measures.SelectMany(measure => measure.Notes).OrderBy(note => note.Index));
        _measureOfNote = measureOfNote;

        var conversion = document.Conversion;
        var minutes = (int)(document.DurationMs / 60000);
        var seconds = (int)(document.DurationMs / 1000) % 60;
        Summary = $"{conversion.Notes.Count} 个音符 · {minutes}:{seconds:00} · {document.Bpm:0.#} BPM"
                  + (document.Snapshot.Transpose != 0 ? $" · 移调 {document.Snapshot.Transpose:+0;-0}" : "")
                  + $" · 修饰键切换 {conversion.ModifierChanges} 次"
                  + (conversion.Unplayable.Count > 0 ? $" · {conversion.Unplayable.Count} 个音超出音域已跳过" : "");
        Raise(nameof(HasScore));
    }

    private Dictionary<int, int> _measureOfNote = [];

    public void SetCurrent(int index)
    {
        if (_currentIndex >= 0 && _currentIndex < _byIndex.Count) _byIndex[_currentIndex].IsCurrent = false;
        _currentIndex = index;
        if (index >= 0 && index < _byIndex.Count)
        {
            _byIndex[index].IsCurrent = true;
            if (_measureOfNote.TryGetValue(index, out var measure)) CurrentMeasure = measure;
        }
        else
        {
            CurrentMeasure = -1;
        }
    }
}
