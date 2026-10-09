namespace Yoink.Tray.Core;

/// <summary>How opening the Yoink page went: through Windows, a named browser, or not at all.</summary>
public sealed record DashboardOpenResult(bool Opened, string Via, string Problem);

/// <summary>
/// Opens the Yoink page. Windows' own app for web links comes first. When
/// Windows has none that works (for example after the default browser was
/// uninstalled: "No application is associated with the specified file for
/// this operation"), the page opens in an installed browser instead, the ones
/// that load the companion first.
/// </summary>
public static class DashboardOpener
{
    /// <summary>Where Windows installs each browser's program, most likely first.</summary>
    public static IReadOnlyList<(string Browser, string Program)> WindowsBrowserPrograms(string programFiles, string programFilesX86, string localAppData) =>
    [
        ("Brave", Path.Combine(programFiles, "BraveSoftware", "Brave-Browser", "Application", "brave.exe")),
        ("Brave", Path.Combine(programFilesX86, "BraveSoftware", "Brave-Browser", "Application", "brave.exe")),
        ("Brave", Path.Combine(localAppData, "BraveSoftware", "Brave-Browser", "Application", "brave.exe")),
        ("Chrome", Path.Combine(programFiles, "Google", "Chrome", "Application", "chrome.exe")),
        ("Chrome", Path.Combine(programFilesX86, "Google", "Chrome", "Application", "chrome.exe")),
        ("Chrome", Path.Combine(localAppData, "Google", "Chrome", "Application", "chrome.exe")),
        ("Edge", Path.Combine(programFilesX86, "Microsoft", "Edge", "Application", "msedge.exe")),
        ("Edge", Path.Combine(programFiles, "Microsoft", "Edge", "Application", "msedge.exe")),
        ("Vivaldi", Path.Combine(localAppData, "Vivaldi", "Application", "vivaldi.exe")),
        ("Firefox", Path.Combine(programFiles, "Mozilla Firefox", "firefox.exe")),
        ("Firefox", Path.Combine(programFilesX86, "Mozilla Firefox", "firefox.exe"))
    ];

    /// <summary>The browsers that load the companion first, then the rest in their usual order.</summary>
    public static IReadOnlyList<(string Browser, string Program)> Ordered(
        IEnumerable<(string Browser, string Program)> programs, IEnumerable<string> companionBrowsers)
    {
        var preferred = companionBrowsers.ToHashSet(StringComparer.OrdinalIgnoreCase);
        return programs.Select((program, index) => (program, index))
            .OrderBy(item => preferred.Contains(item.program.Browser) ? 0 : 1)
            .ThenBy(item => item.index)
            .Select(item => item.program)
            .ToList();
    }

    /// <summary>
    /// Opens <paramref name="url"/> and never throws. <paramref name="fallbacks"/>
    /// is only listed when Windows could not open it.
    /// </summary>
    public static DashboardOpenResult Open(string url, Action<string> shellOpen,
        Func<IEnumerable<(string Browser, string Program)>> fallbacks, Func<string, bool> exists, Action<string, string> start)
    {
        string shellProblem;
        try
        {
            shellOpen(url);
            return new DashboardOpenResult(true, "Windows", "");
        }
        catch (Exception error)
        {
            shellProblem = error.Message;
        }
        IEnumerable<(string Browser, string Program)> candidates;
        try { candidates = fallbacks().ToList(); }
        catch (Exception) { candidates = []; }
        foreach (var (browser, program) in candidates)
        {
            try
            {
                if (!exists(program)) continue;
                start(program, url);
                return new DashboardOpenResult(true, browser, shellProblem);
            }
            catch (Exception)
            {
                // Try the next browser.
            }
        }
        return new DashboardOpenResult(false, "", shellProblem);
    }
}
