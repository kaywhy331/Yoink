using Yoink.Tray.Core;

namespace Yoink.Tray;

internal static class Program
{
    [STAThread]
    private static int Main(string[] args)
    {
        // One tray app per Windows user: a second launch only opens the dashboard.
        using var single = new Mutex(initiallyOwned: true, @"Local\Yoink.Tray", out var first);
        if (!first)
        {
            var settings = TraySettings.Load(YoinkPaths.ForCurrentUser());
            TrayApp.OpenDashboard(settings.Port);
            return 0;
        }
        ApplicationConfiguration.Initialize();
        using var app = new TrayApp(YoinkPaths.ForCurrentUser(), startedByWindows: args.Contains("--background"));
        Application.Run(app);
        return 0;
    }
}
