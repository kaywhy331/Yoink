namespace Yoink.Tray.Core;

/// <summary>
/// Where the tray app keeps everything on the PC. One root (by default
/// %LOCALAPPDATA%\Yoink) so removing Yoink is removing one folder:
///   tray-settings.json   port, data folder, start-with-Windows, active server
///   data\                the server's YOINK_DATA_DIR (database, keys, backups)
///   server\&lt;version&gt;\   installed server packages (node.exe + app)
///   logs\                tray-YYYY-MM-DD.log and server-YYYY-MM-DD.log
/// </summary>
public sealed class YoinkPaths(string root)
{
    public string Root { get; } = Path.GetFullPath(root);
    public string SettingsFile => Path.Combine(Root, "tray-settings.json");
    public string DefaultDataDirectory => Path.Combine(Root, "data");
    public string ServersDirectory => Path.Combine(Root, "server");
    public string LogsDirectory => Path.Combine(Root, "logs");

    public string ServerDirectory(string version) => Path.Combine(ServersDirectory, ServerVersion.RequireSafe(version));

    public static YoinkPaths ForCurrentUser() =>
        new(Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Yoink"));
}

/// <summary>Version strings become folder names, so only plain semver-like text is accepted.</summary>
public static class ServerVersion
{
    public static bool IsSafe(string? version) =>
        !string.IsNullOrWhiteSpace(version)
        && version.Length <= 64
        && version.All(c => char.IsAsciiLetterOrDigit(c) || c is '.' or '-' or '+')
        && !version.StartsWith('.')
        && !version.Contains("..", StringComparison.Ordinal);

    public static string RequireSafe(string? version) =>
        IsSafe(version) ? version! : throw new InvalidDataException($"'{version}' is not a usable server version.");

    /// <summary>Orders "1.28.10" after "1.28.9"; anything unparsable sorts first.</summary>
    public static int Compare(string left, string right)
    {
        static int[] Parts(string value) => value.Split('-', '+')[0].Split('.')
            .Select(part => int.TryParse(part, out var number) ? number : -1).ToArray();
        var a = Parts(left);
        var b = Parts(right);
        for (var i = 0; i < Math.Max(a.Length, b.Length); i++)
        {
            var x = i < a.Length ? a[i] : 0;
            var y = i < b.Length ? b[i] : 0;
            if (x != y) return x.CompareTo(y);
        }
        return string.CompareOrdinal(left, right);
    }
}
