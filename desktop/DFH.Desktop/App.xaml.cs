using System.Windows;
using System.Windows.Threading;

namespace DFH.Desktop;

public partial class App : Application
{
    protected override void OnStartup(StartupEventArgs e)
    {
        DispatcherUnhandledException += OnDispatcherUnhandledException;
        base.OnStartup(e);
    }

    private static void OnDispatcherUnhandledException(object sender, DispatcherUnhandledExceptionEventArgs e)
    {
        MessageBox.Show($"程序遇到未处理的错误：\n\n{e.Exception}", "三角洲口琴自动演奏器", MessageBoxButton.OK, MessageBoxImage.Error);
        e.Handled = true;
    }
}
