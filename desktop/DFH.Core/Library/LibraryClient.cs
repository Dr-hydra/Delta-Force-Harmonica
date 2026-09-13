using System.Text.Json;
using System.Text.RegularExpressions;
using DFH.Core.Persistence;

namespace DFH.Core.Library;

public sealed record LibraryEntry(
    string Id,
    string Title,
    string Composer,
    string Uploader,
    string Avatar,
    IReadOnlyList<string> Tags,
    int Difficulty,
    double Bpm,
    double DurationMs,
    int NoteCount,
    long UpdatedAt)
{
    public string DurationLabel
    {
        get
        {
            var total = Math.Max(0, (int)Math.Round(DurationMs / 1000));
            return $"{total / 60}:{total % 60:00}";
        }
    }

    public string TagsLabel => string.Join(" · ", Tags);

    public string UpdatedLabel => UpdatedAt > 0
        ? DateTimeOffset.FromUnixTimeMilliseconds(UpdatedAt).ToLocalTime().ToString("yyyy-MM-dd")
        : "";

    /// <summary>List items expose this as their accessibility name, so screen readers and UI automation see the title.</summary>
    public override string ToString() => Title;
}

public sealed record PublicScore(LibraryEntry Entry, ScoreSnapshot Snapshot);

public sealed record LibraryIndex(int Version, int Count, long UpdatedAt, IReadOnlyDictionary<string, int> Shards);

public sealed class LibraryException(string message, Exception? inner = null) : Exception(message, inner);

/// <summary>
/// The public objects CloudBase serves are JSONP: <c>__dfh("catalog/a", {...});</c>
/// saved as .js so a Toy page can load them with a classic script tag. Here the
/// wrapper is simply stripped.
/// </summary>
public static partial class Jsonp
{
    [GeneratedRegex(@"^\s*__dfh\(\s*""((?:[^""\\]|\\.)*)""\s*,\s*(.*?)\s*\)\s*;?\s*$", RegexOptions.Singleline)]
    private static partial Regex Wrapper();

    public static JsonDocument Unwrap(string text, out string key)
    {
        var match = Wrapper().Match(text);
        if (!match.Success) throw new LibraryException("曲库对象不是预期的 JSONP 格式");
        key = match.Groups[1].Value;
        try
        {
            return JsonDocument.Parse(match.Groups[2].Value);
        }
        catch (JsonException reason)
        {
            throw new LibraryException($"曲库对象 JSON 无法解析：{reason.Message}", reason);
        }
    }
}

/// <summary>
/// Read-only client for the public score library, mirroring src/library/api.ts:
/// index → populated catalog shards → local search → single score payload.
/// </summary>
public sealed partial class LibraryClient(HttpClient http, string storageBase)
{
    private readonly string _base = storageBase.TrimEnd('/');

    public string StorageBase => _base;

    private async Task<JsonDocument?> LoadAsync(string key, int freshnessMs, CancellationToken ct)
    {
        var bucket = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds() / freshnessMs;
        var url = $"{_base}/{key}.js?t={bucket}";
        HttpResponseMessage response;
        try
        {
            response = await http.GetAsync(url, ct).ConfigureAwait(false);
        }
        catch (HttpRequestException reason)
        {
            throw new LibraryException($"无法连接曲库：{reason.Message}", reason);
        }
        if (response.StatusCode == System.Net.HttpStatusCode.NotFound) return null;
        if (!response.IsSuccessStatusCode) throw new LibraryException($"曲库请求失败（{(int)response.StatusCode}）");
        var text = await response.Content.ReadAsStringAsync(ct).ConfigureAwait(false);
        return Jsonp.Unwrap(text, out _);
    }

    private static string Str(JsonElement element) => element.ValueKind == JsonValueKind.String ? element.GetString() ?? "" : "";

    private static double Num(JsonElement element) => element.ValueKind == JsonValueKind.Number ? element.GetDouble() : 0;

    private static List<string> Tags(JsonElement element) =>
        element.ValueKind == JsonValueKind.Array ? element.EnumerateArray().Select(Str).Where(s => s.Length > 0).ToList() : [];

    // [id,title,composer,uploader,avatar,tags,difficulty,bpm,durationMs,noteCount,updatedAt]
    private static LibraryEntry Widen(JsonElement row)
    {
        var cells = row.EnumerateArray().ToList();
        JsonElement At(int index) => index < cells.Count ? cells[index] : default;
        var uploader = Str(At(3));
        var bpm = Num(At(7));
        return new LibraryEntry(
            Str(At(0)),
            Str(At(1)),
            Str(At(2)),
            uploader.Length > 0 ? uploader : "匿名玩家",
            Str(At(4)),
            Tags(At(5)),
            (int)Num(At(6)),
            bpm > 0 ? bpm : 120,
            Num(At(8)),
            (int)Num(At(9)),
            (long)Num(At(10)));
    }

    public async Task<LibraryIndex> GetIndexAsync(CancellationToken ct = default)
    {
        using var document = await LoadAsync("index", 60_000, ct).ConfigureAwait(false)
            ?? throw new LibraryException("曲库索引不存在");
        var root = document.RootElement;
        var shards = new Dictionary<string, int>();
        if (root.TryGetProperty("s", out var shardElement) && shardElement.ValueKind == JsonValueKind.Object)
        {
            foreach (var property in shardElement.EnumerateObject()) shards[property.Name] = (int)Num(property.Value);
        }
        return new LibraryIndex(
            root.TryGetProperty("v", out var v) ? (int)Num(v) : 1,
            root.TryGetProperty("n", out var n) ? (int)Num(n) : 0,
            root.TryGetProperty("t", out var t) ? (long)Num(t) : 0,
            shards);
    }

    public async Task<List<LibraryEntry>> GetCatalogAsync(CancellationToken ct = default)
    {
        var index = await GetIndexAsync(ct).ConfigureAwait(false);
        var shardIds = index.Shards.Where(pair => pair.Value > 0).Select(pair => pair.Key).OrderBy(id => id, StringComparer.Ordinal).ToList();
        var pages = await Task.WhenAll(shardIds.Select(async shard =>
        {
            using var document = await LoadAsync($"catalog/{shard}", 60_000, ct).ConfigureAwait(false);
            if (document == null || !document.RootElement.TryGetProperty("r", out var rows) || rows.ValueKind != JsonValueKind.Array) return new List<LibraryEntry>();
            return rows.EnumerateArray().Where(row => row.ValueKind == JsonValueKind.Array).Select(Widen).ToList();
        })).ConfigureAwait(false);

        return pages.SelectMany(page => page)
            .OrderByDescending(entry => entry.UpdatedAt)
            .ThenBy(entry => entry.Title, StringComparer.CurrentCulture)
            .ToList();
    }

    public static bool IsValidShortId(string shortId) => ShortIdPattern().IsMatch(shortId);

    [GeneratedRegex("^[A-Za-z0-9_-]{6,32}$")]
    private static partial Regex ShortIdPattern();

    public async Task<PublicScore> GetPublicScoreAsync(string shortId, CancellationToken ct = default)
    {
        if (!IsValidShortId(shortId)) throw new LibraryException("曲谱 ID 无效");
        using var document = await LoadAsync($"score/{shortId}", 300_000, ct).ConfigureAwait(false)
            ?? throw new LibraryException("曲谱不存在或已下架");
        var root = document.RootElement;
        JsonElement Prop(string name) => root.TryGetProperty(name, out var value) ? value : default;

        var payload = Str(Prop("p"));
        if (payload.Length == 0) throw new LibraryException("曲谱对象缺少谱面数据");
        ScoreSnapshot snapshot;
        try
        {
            snapshot = ScoreCodec.DecodeBase64Url(payload);
        }
        catch (Exception reason) when (reason is DfhsFormatException or FormatException)
        {
            throw new LibraryException($"谱面数据无法解码：{reason.Message}", reason);
        }

        var uploader = Str(Prop("u"));
        var bpm = Num(Prop("b"));
        var entry = new LibraryEntry(
            Str(Prop("i")).Length > 0 ? Str(Prop("i")) : shortId,
            Str(Prop("t")),
            Str(Prop("c")),
            uploader.Length > 0 ? uploader : "匿名玩家",
            Str(Prop("a")),
            Tags(Prop("g")),
            (int)Num(Prop("d")),
            bpm > 0 ? bpm : 120,
            Num(Prop("l")),
            (int)Num(Prop("n")),
            (long)Num(Prop("m")));
        return new PublicScore(entry, snapshot);
    }

    /// <summary>Same substring search as the web: title, composer, uploader and tags, all lower-cased.</summary>
    public static List<LibraryEntry> Search(IEnumerable<LibraryEntry> entries, string query, IEnumerable<string>? tags = null)
    {
        var needle = query.Trim().ToLowerInvariant();
        var requiredTags = (tags ?? []).Select(tag => tag.Trim().ToLowerInvariant()).Where(tag => tag.Length > 0).ToList();
        return entries.Where(entry =>
        {
            var haystack = string.Join("\n", new[] { entry.Title, entry.Composer, entry.Uploader }.Concat(entry.Tags)).ToLowerInvariant();
            if (needle.Length > 0 && !haystack.Contains(needle)) return false;
            if (requiredTags.Count > 0 && !requiredTags.All(tag => entry.Tags.Any(value => value.ToLowerInvariant() == tag))) return false;
            return true;
        }).ToList();
    }
}

public static partial class LibraryClientDefaults
{
    /// <summary>Public CDN prefix the deployed web app reads; editable in the desktop settings.</summary>
    public const string StorageBase = "https://656e-endfield-d3gdy9wg4afba9d16-1474357318.tcb.qcloud.la/harmonica";
}
