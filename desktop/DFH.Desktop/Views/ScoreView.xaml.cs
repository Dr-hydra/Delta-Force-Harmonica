using System.ComponentModel;
using System.Windows;
using System.Windows.Controls;
using DFH.Desktop.ViewModels;

namespace DFH.Desktop.Views;

public partial class ScoreView : UserControl
{
    private ScoreViewModel? _viewModel;

    public ScoreView()
    {
        InitializeComponent();
        DataContextChanged += OnDataContextChanged;
    }

    private void OnDataContextChanged(object sender, DependencyPropertyChangedEventArgs e)
    {
        if (_viewModel != null) _viewModel.PropertyChanged -= OnViewModelChanged;
        _viewModel = e.NewValue as ScoreViewModel;
        if (_viewModel != null) _viewModel.PropertyChanged += OnViewModelChanged;
    }

    /// <summary>Keeps the measure with the sounding note in view during playback.</summary>
    private void OnViewModelChanged(object? sender, PropertyChangedEventArgs e)
    {
        if (e.PropertyName != nameof(ScoreViewModel.CurrentMeasure) || _viewModel == null) return;
        var index = _viewModel.CurrentMeasure;
        if (index < 0) return;
        if (MeasureList.ItemContainerGenerator.ContainerFromIndex(index) is FrameworkElement container)
        {
            container.BringIntoView();
        }
    }
}
