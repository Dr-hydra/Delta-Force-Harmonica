using System.Windows.Controls;
using System.Windows.Input;
using DFH.Desktop.ViewModels;

namespace DFH.Desktop.Views;

public partial class LocalPage : UserControl
{
    public LocalPage()
    {
        InitializeComponent();
    }

    private void OnDoubleClick(object sender, MouseButtonEventArgs e)
    {
        if (DataContext is MainViewModel viewModel) viewModel.LocalLibrary.Open(viewModel.LocalLibrary.Selected);
    }
}
