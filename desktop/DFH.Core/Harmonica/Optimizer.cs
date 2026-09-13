using DFH.Core.Music;

namespace DFH.Core.Harmonica;

public sealed class ConversionResult
{
    public required IReadOnlyList<GameNote> Notes { get; init; }
    public required IReadOnlyList<NoteEvent> Unplayable { get; init; }
    public required double Cost { get; init; }
    public required int ModifierChanges { get; init; }
}

/// <summary>
/// Port of src/harmonica/optimizer.ts: dynamic programming over the candidate
/// fingerings of each note, minimising modifier switches and key travel. Costs,
/// loop order and strict-less-than tie breaking must match the web exactly so a
/// score looks the same here as in the browser preview.
/// </summary>
public static class Optimizer
{
    private readonly struct State(HarmonicaCandidate candidate, double cost, int previousIndex)
    {
        public readonly HarmonicaCandidate Candidate = candidate;
        public readonly double Cost = cost;
        public readonly int PreviousIndex = previousIndex;
    }

    private static double LocalCost(HarmonicaCandidate candidate) =>
        (candidate.Sharp ? 0.45 : 0) + (candidate.OctaveModifier == 0 ? 0 : 0.22);

    private static double TransitionCost(HarmonicaCandidate a, HarmonicaCandidate b)
    {
        var cost = Math.Abs(a.KeyIndex - b.KeyIndex) * 0.16;
        if (a.Sharp != b.Sharp) cost += 1.9;
        if (a.OctaveModifier != b.OctaveModifier) cost += 2.5 * Math.Abs(a.OctaveModifier - b.OctaveModifier);
        return cost;
    }

    public static ConversionResult OptimizeHarmonica(IReadOnlyList<NoteEvent> notes, int transpose = 0)
    {
        var playable = new List<(NoteEvent Note, List<HarmonicaCandidate> Candidates, int SourceIndex)>();
        var unplayable = new List<NoteEvent>();

        for (var sourceIndex = 0; sourceIndex < notes.Count; sourceIndex += 1)
        {
            var shifted = notes[sourceIndex] with { Pitch = notes[sourceIndex].Pitch + transpose };
            var candidates = Mapping.CandidatesForPitch(shifted.Pitch);
            if (candidates.Count == 0) unplayable.Add(shifted);
            else playable.Add((shifted, candidates, sourceIndex));
        }

        if (playable.Count == 0)
        {
            return new ConversionResult { Notes = [], Unplayable = unplayable, Cost = 0, ModifierChanges = 0 };
        }

        var layers = new List<State[]>(playable.Count);
        for (var layerIndex = 0; layerIndex < playable.Count; layerIndex += 1)
        {
            var entry = playable[layerIndex];
            if (layerIndex == 0)
            {
                layers.Add(entry.Candidates.Select(candidate => new State(candidate, LocalCost(candidate), -1)).ToArray());
                continue;
            }

            var previousLayer = layers[layerIndex - 1];
            var layer = new State[entry.Candidates.Count];
            for (var c = 0; c < entry.Candidates.Count; c += 1)
            {
                var candidate = entry.Candidates[c];
                var bestCost = double.PositiveInfinity;
                var bestIndex = 0;
                for (var previousIndex = 0; previousIndex < previousLayer.Length; previousIndex += 1)
                {
                    var previous = previousLayer[previousIndex];
                    var cost = previous.Cost + TransitionCost(previous.Candidate, candidate) + LocalCost(candidate);
                    if (cost < bestCost)
                    {
                        bestCost = cost;
                        bestIndex = previousIndex;
                    }
                }
                layer[c] = new State(candidate, bestCost, bestIndex);
            }
            layers.Add(layer);
        }

        var lastLayer = layers[^1];
        var index = 0;
        for (var i = 0; i < lastLayer.Length; i += 1)
        {
            if (lastLayer[i].Cost < lastLayer[index].Cost) index = i;
        }

        var chosen = new HarmonicaCandidate[layers.Count];
        for (var layer = layers.Count - 1; layer >= 0; layer -= 1)
        {
            var state = layers[layer][index];
            chosen[layer] = state.Candidate;
            index = state.PreviousIndex;
        }

        var gameNotes = new List<GameNote>(playable.Count);
        for (var i = 0; i < playable.Count; i += 1)
        {
            gameNotes.Add(new GameNote { Note = playable[i].Note, Candidate = chosen[i], SourceIndex = playable[i].SourceIndex });
        }

        var modifierChanges = 0;
        for (var i = 1; i < gameNotes.Count; i += 1)
        {
            if (gameNotes[i - 1].Sharp != gameNotes[i].Sharp) modifierChanges += 1;
            if (gameNotes[i - 1].OctaveModifier != gameNotes[i].OctaveModifier) modifierChanges += 1;
        }

        var minCost = double.PositiveInfinity;
        foreach (var state in lastLayer) minCost = Math.Min(minCost, state.Cost);

        return new ConversionResult { Notes = gameNotes, Unplayable = unplayable, Cost = minCost, ModifierChanges = modifierChanges };
    }

    public static (int Transpose, ConversionResult Result) FindBestTranspose(IReadOnlyList<NoteEvent> notes)
    {
        var bestTranspose = 0;
        var bestResult = OptimizeHarmonica(notes, 0);
        var bestScore = double.PositiveInfinity;

        for (var transpose = -12; transpose <= 12; transpose += 1)
        {
            var result = OptimizeHarmonica(notes, transpose);
            var score = result.Unplayable.Count * 10000 + result.Cost + Math.Abs(transpose) * 0.08;
            if (score < bestScore)
            {
                bestTranspose = transpose;
                bestResult = result;
                bestScore = score;
            }
        }

        return (bestTranspose, bestResult);
    }
}
