using Yoink.Tray.Core;

namespace Yoink.Tray;

internal static class Program
{
    [STAThread]
    private static int Main(string[] args)
    {
        // One tray app per Windows user: a second launch only opens the dashboard.
        using var single = new Mutex(initiallyOwned: true, @"Local\Yoink.Tray", out var first);
        // After a self-update the old tray is still exiting; wait for it to let go.
        if (!first && args.Contains("--after-update"))
        {
            try { first = single.WaitOne(TimeSpan.FromSeconds(60)); } catch (AbandonedMutexException) { first = true; }
        }
        var paths = YoinkPaths.ForCurrentUser();
        var log = new DailyLog(paths.LogsDirectory, "tray");
        if (!first)
        {
            ApplicationConfiguration.Initialize();
            TrayApp.OpenDashboard(TraySettings.Load(paths).Port, log);
            return 0;
        }
        ApplicationConfiguration.Initialize();
        // A failure in a menu or icon handler is logged (so diagnostics carry
        // it) and shown, instead of .NET's crash dialog.
        Application.SetUnhandledExceptionMode(UnhandledExceptionMode.CatchException);
        Application.ThreadException += (_, failure) =>
        {
            log.Write($"[tray] unexpected problem: {failure.Exception}");
            MessageBox.Show(failure.Exception.Message, "Yoink ran into a problem", MessageBoxButtons.OK, MessageBoxIcon.Warning);
        };
        using var app = new TrayApp(paths, startedByWindows: args.Contains("--background"));
        Application.Run(app);
        return 0;
    }
}
