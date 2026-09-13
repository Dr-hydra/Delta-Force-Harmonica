using System.Globalization;
using System.Windows;
using System.Windows.Data;

namespace DFH.Desktop.Infrastructure;

/// <summary>Visible when the bound tab index equals the converter parameter.</summary>
public sealed class TabVisibilityConverter : IValueConverter
{
    public object Convert(object? value, Type targetType, object? parameter, CultureInfo culture) =>
        value is int index && int.TryParse(parameter?.ToString(), out var wanted) && index == wanted
            ? Visibility.Visible
            : Visibility.Collapsed;

    public object ConvertBack(object? value, Type targetType, object? parameter, CultureInfo culture) => Binding.DoNothing;
}

/// <summary>
/// Two-way: true when the bound tab index equals the converter parameter, and
/// checking the button writes that parameter back as the selected tab.
/// </summary>
public sealed class TabSelectedConverter : IValueConverter
{
    public object Convert(object? value, Type targetType, object? parameter, CultureInfo culture) =>
        value is int index && int.TryParse(parameter?.ToString(), out var wanted) && index == wanted;

    public object ConvertBack(object? value, Type targetType, object? parameter, CultureInfo culture) =>
        value is true && int.TryParse(parameter?.ToString(), out var wanted) ? wanted : Binding.DoNothing;
}
