using System.Collections.ObjectModel;
using System.IO;
using System.Windows.Threading;
using DFH.Core.Midi;
using DFH.Desktop.Infrastructure;
using DFH.Desktop.Services;
using Microsoft.Win32;

namespace DFH.Desktop.ViewModels;

public sealed record LocalMidiEntry(string Path, string Title, string DurationLabel, int NoteCount)
{
    public string FileName => System.IO.Path.GetFileName(Path);
    public override string ToString() => Title;
}

/// <summary>A watched, single-folder collection of compatible MIDI exports.</summary>
public sealed class LocalLibraryViewModel : ObservableObject, IDisposable
{
    private readonly Dispatcher _dispatcher;
    private readonly Action<string> _open;
    private readonly Action<string> _directoryChanged;
    private FileSystemWatcher? _watcher;
    private string _directory;
    private string _status = "";
    private LocalMidiEntry? _selected;
    private int _refreshQueued;

    public LocalLibraryViewModel(Dispatcher dispatcher, string directory, Action<string> open, Action<string> directoryChanged)
    {
        _dispatcher = dispatcher;
        _directory = directory;
        _open = open;
        _directoryChanged = directoryChanged;
        RefreshCommand = new RelayCommand(Refresh);
        OpenSelectedCommand = new RelayCommand(OpenSelected, () => Selected != null);
        OpenFolderCommand = new RelayCommand(OpenFolder);
        ChooseFolderCommand = new RelayCommand(ChooseFolder);
        SetDirectory(directory);
    }

    public ObservableCollection<LocalMidiEntry> Entries { get; } = [];
    public RelayCommand RefreshCommand { get; }
    public RelayCommand OpenSelectedCommand { get; }
    public RelayCommand OpenFolderCommand { get; }
    public RelayCommand ChooseFolderCommand { get; }

    public string DirectoryPath { get => _directory; private set => Set(ref _directory, value); }
    public string Status { get => _status; private set => Set(ref _status, value); }
    public LocalMidiEntry? Selected
    {
        get => _selected;
        set
        {
            if (Set(ref _selected, value)) OpenSelectedCommand.RaiseCanExecuteChanged();
        }
    }

    public void SetDirectory(string directory)
    {
        var target = string.IsNullOrWhiteSpace(directory) ? AppSettings.DefaultLocalLibraryDirectory : Path.GetFullPath(directory.Trim());
        Directory.CreateDirectory(target);
        DirectoryPath = target;
        _watcher?.Dispose();
        _watcher = new FileSystemWatcher(target)
        {
            Filter = "*.*",
            NotifyFilter = NotifyFilters.FileName | NotifyFilters.LastWrite | NotifyFilters.Size,
            EnableRaisingEvents = true
        };
        _watcher.Created += OnFolderChanged;
        _watcher.Changed += OnFolderChanged;
        _watcher.Deleted += OnFolderChanged;
        _watcher.Renamed += OnFolderChanged;
        Refresh();
    }

    private void OnFolderChanged(object sender, FileSystemEventArgs e)
    {
        if (!IsMidi(e.FullPath) || Interlocked.Exchange(ref _refreshQueued, 1) != 0) return;
        _dispatcher.BeginInvoke(DispatcherPriority.Background, () =>
        {
            Interlocked.Exchange(ref _refreshQueued, 0);
            Refresh();
        });
    }

    public void Refresh()
    {
        var items = new List<LocalMidiEntry>();
        var invalid = 0;
        try
        {
            foreach (var path in Directory.EnumerateFiles(DirectoryPath).Where(IsMidi).OrderBy(Path.GetFileName, StringComparer.CurrentCultureIgnoreCase))
            {
                try
                {
                    var score = DfhMidiReader.Read(path);
                    var seconds = Math.Max(0, (int)Math.Round(score.Snapshot.DurationMs / 1000));
                    items.Add(new LocalMidiEntry(path, score.Title, $"{seconds / 60}:{seconds % 60:00}", score.Snapshot.Notes.Count));
                }
                catch (IOException) { invalid++; }
                catch (UnauthorizedAccessException) { invalid++; }
                catch (NotSiteExportException) { invalid++; }
            }
            var selectedPath = Selected?.Path;
            Entries.Clear();
            foreach (var item in items) Entries.Add(item);
            SelectPath(selectedPath);
            Status = invalid > 0 ? $"已读取 {items.Count} 首，忽略 {invalid} 个不兼容或正被写入的文件" : $"本地共 {items.Count} 首";
        }
        catch (Exception reason)
        {
            Status = $"读取本地曲库失败：{reason.Message}";
        }
    }

    private void OpenSelected()
    {
        if (Selected != null) _open(Selected.Path);
    }

    public void SelectPath(string? path) => Selected = Entries.FirstOrDefault(entry =>
        string.Equals(entry.Path, path, StringComparison.OrdinalIgnoreCase));

    /// <summary>Follow the displayed file order; wrap at either end. A score outside
    /// this folder starts at the first (next) or last (previous) local entry.</summary>
    public LocalMidiEntry? Adjacent(string? currentPath, int direction)
    {
        if (direction is not (-1 or 1)) throw new ArgumentOutOfRangeException(nameof(direction));
        if (Entries.Count == 0) return null;
        var current = Entries.ToList().FindIndex(entry => string.Equals(entry.Path, currentPath, StringComparison.OrdinalIgnoreCase));
        var index = current < 0 ? (direction > 0 ? 0 : Entries.Count - 1)
            : (current + direction + Entries.Count) % Entries.Count;
        return Entries[index];
    }

    public void Open(LocalMidiEntry? entry)
    {
        if (entry != null) _open(entry.Path);
    }

    private void OpenFolder()
    {
        try { Links.OpenFolder(DirectoryPath); }
        catch (Exception reason) { Status = $"打开文件夹失败：{reason.Message}"; }
    }

    private void ChooseFolder()
    {
        var dialog = new OpenFolderDialog { Title = "选择本地曲库文件夹", InitialDirectory = DirectoryPath };
        if (dialog.ShowDialog() != true) return;
        try
        {
            SetDirectory(dialog.FolderName);
            _directoryChanged(DirectoryPath);
        }
        catch (Exception reason)
        {
            Status = $"设置曲库文件夹失败：{reason.Message}";
        }
    }

    private static bool IsMidi(string path) => Path.GetExtension(path).Equals(".mid", StringComparison.OrdinalIgnoreCase)
                                                || Path.GetExtension(path).Equals(".midi", StringComparison.OrdinalIgnoreCase);

    public void Dispose() => _watcher?.Dispose();
}
