using System.Net.Http;
using System.Collections.ObjectModel;
using DFH.Core.Library;
using DFH.Desktop.Infrastructure;

namespace DFH.Desktop.ViewModels;

/// <summary>Browse and search the public score library; opening an entry hands the snapshot to the main view model.</summary>
public sealed class LibraryViewModel : ObservableObject
{
    private readonly Func<string> _storageBase;
    private readonly Func<PublicScore, Task> _open;
    private readonly HttpClient _http = new() { Timeout = TimeSpan.FromSeconds(15) };
    private List<LibraryEntry> _all = [];
    private string _query = "";
    private string _shortId = "";
    private string _status = "尚未加载曲库";
    private bool _busy;
    private LibraryEntry? _selected;

    public LibraryViewModel(Func<string> storageBase, Func<PublicScore, Task> open)
    {
        _storageBase = storageBase;
        _open = open;
        RefreshCommand = new RelayCommand(() => _ = RefreshAsync(), () => !Busy);
        OpenSelectedCommand = new RelayCommand(() => _ = OpenAsync(Selected), () => Selected != null && !Busy);
        OpenShortIdCommand = new RelayCommand(() => _ = OpenShortIdAsync(), () => !Busy && ShortId.Trim().Length > 0);
    }

    public ObservableCollection<LibraryEntry> Entries { get; } = [];

    public RelayCommand RefreshCommand { get; }
    public RelayCommand OpenSelectedCommand { get; }
    public RelayCommand OpenShortIdCommand { get; }

    public string Query
    {
        get => _query;
        set
        {
            if (Set(ref _query, value)) ApplyFilter();
        }
    }

    public string ShortId
    {
        get => _shortId;
        set
        {
            if (Set(ref _shortId, value)) OpenShortIdCommand.RaiseCanExecuteChanged();
        }
    }

    public string Status
    {
        get => _status;
        private set => Set(ref _status, value);
    }

    public bool Busy
    {
        get => _busy;
        private set
        {
            if (!Set(ref _busy, value)) return;
            RefreshCommand.RaiseCanExecuteChanged();
            OpenSelectedCommand.RaiseCanExecuteChanged();
            OpenShortIdCommand.RaiseCanExecuteChanged();
        }
    }

    public LibraryEntry? Selected
    {
        get => _selected;
        set
        {
            if (Set(ref _selected, value)) OpenSelectedCommand.RaiseCanExecuteChanged();
        }
    }

    public bool Loaded => _all.Count > 0;

    private LibraryClient Client() => new(_http, _storageBase());

    public async Task EnsureLoadedAsync()
    {
        if (!Loaded && !Busy) await RefreshAsync();
    }

    public async Task RefreshAsync()
    {
        if (Busy) return;
        Busy = true;
        Status = "正在加载曲库…";
        try
        {
            _all = await Client().GetCatalogAsync();
            ApplyFilter();
            Status = _all.Count == 0 ? "曲库为空" : $"共 {_all.Count} 首公开曲谱";
        }
        catch (Exception reason)
        {
            Status = reason.Message;
        }
        finally
        {
            Busy = false;
            Raise(nameof(Loaded));
        }
    }

    private void ApplyFilter()
    {
        var visible = LibraryClient.Search(_all, Query);
        Entries.Clear();
        foreach (var entry in visible) Entries.Add(entry);
        if (_all.Count > 0) Status = Query.Trim().Length > 0 ? $"匹配 {visible.Count} / {_all.Count} 首" : $"共 {_all.Count} 首公开曲谱";
    }

    public async Task OpenAsync(LibraryEntry? entry)
    {
        if (entry == null || Busy) return;
        await OpenIdAsync(entry.Id, entry.Title);
    }

    private async Task OpenShortIdAsync()
    {
        // Accept a pasted share link as well as the bare id.
        var raw = ShortId.Trim();
        var marker = raw.IndexOf("s=", StringComparison.Ordinal);
        if (marker >= 0)
        {
            raw = raw[(marker + 2)..];
            var end = raw.IndexOfAny(['&', '#', '/']);
            if (end >= 0) raw = raw[..end];
        }
        await OpenIdAsync(raw, raw);
    }

    private async Task OpenIdAsync(string shortId, string title)
    {
        Busy = true;
        Status = $"正在读取「{title}」…";
        try
        {
            var score = await Client().GetPublicScoreAsync(shortId);
            await _open(score);
            Status = $"已打开「{score.Entry.Title}」";
        }
        catch (Exception reason)
        {
            Status = reason.Message;
        }
        finally
        {
            Busy = false;
        }
    }
}
