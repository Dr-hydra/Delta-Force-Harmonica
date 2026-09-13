using System.IO;
using System.Windows;
using DFH.Desktop.Services;
using DFH.Desktop.ViewModels;

namespace DFH.Desktop.Views;

public partial class MainWindow : Window
{
    private readonly MainViewModel _viewModel;

    public MainWindow()
    {
        InitializeComponent();
        _viewModel = new MainViewModel(Dispatcher);
        DataContext = _viewModel;
        SourceInitialized += (_, _) => DropFiles.Enable(this, files => _viewModel.LoadFile(files[0]));
        Closed += (_, _) => _viewModel.Dispose();

        // A file passed on the command line (double-click association, "open with") loads immediately.
        var args = Environment.GetCommandLineArgs();
        if (args.Length > 1 && File.Exists(args[1])) Loaded += (_, _) => _viewModel.LoadFile(args[1]);
    }
}
