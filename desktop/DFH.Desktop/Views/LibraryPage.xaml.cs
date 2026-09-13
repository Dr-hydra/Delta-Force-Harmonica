using System.Windows.Controls;
using System.Windows.Input;
using DFH.Desktop.ViewModels;

namespace DFH.Desktop.Views;

public partial class LibraryPage : UserControl
{
    public LibraryPage()
    {
        InitializeComponent();
    }

    private void OnDoubleClick(object sender, MouseButtonEventArgs e)
    {
        if (DataContext is LibraryViewModel viewModel && viewModel.Selected != null)
        {
            _ = viewModel.OpenAsync(viewModel.Selected);
        }
    }
}
