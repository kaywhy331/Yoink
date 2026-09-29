using System.Text.Json;
using System.Text.Json.Serialization;

namespace Yoink.Tray.Core;

/// <summary>
/// The tray app's own settings. The server keeps its settings in its database;
/// these are only what the tray needs to start it.
/// </summary>
public sealed record TraySettings
{
    public const int DefaultPort = 32991;

    public int Port { get; init; } = DefaultPort;
    /// <summary>Empty means the default: &lt;root&gt;\data.</summary>
    public string DataDirectory { get; init; } = "";
    public bool StartWithWindows { get; init; }
    /// <summary>Start the server whenever the tray app starts.</summary>
    public bool StartServerOnLaunch { get; init; } = true;
    /// <summary>The installed server version to run; empty until the first install.</summary>
    public string ActiveServerVersion { get; init; } = "";

    public string ResolvedDataDirectory(YoinkPaths paths) =>
        string.IsNullOrWhiteSpace(DataDirectory) ? paths.DefaultDataDirectory : DataDirectory;

    /// <summary>Problems a person must fix in the settings window, or an empty list.</summary>
    public IReadOnlyList<string> Problems()
    {
        var problems = new List<string>();
        if (Port is < 1024 or > 65535) problems.Add("The port must be a whole number from 1024 through 65535.");
        if (!string.IsNullOrWhiteSpace(DataDirectory) && !Path.IsPathFullyQualified(DataDirectory))
            problems.Add("The data folder must be a full path, such as C:\\Users\\you\\Yoink\\data.");
        if (!string.IsNullOrEmpty(ActiveServerVersion) && !ServerVersion.IsSafe(ActiveServerVersion))
            problems.Add("The active server version is not a usable version.");
        return problems;
    }

    private static readonly JsonSerializerOptions Json = new()
    {
        WriteIndented = true,
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        DefaultIgnoreCondition = JsonIgnoreCondition.Never
    };

    /// <summary>
    /// Missing file → defaults. An unreadable file is kept aside as
    /// tray-settings.json.bad (never silently overwritten) and defaults are used.
    /// </summary>
    public static TraySettings Load(YoinkPaths paths, Action<string>? report = null)
    {
        if (!File.Exists(paths.SettingsFile)) return new TraySettings();
        try
        {
            var loaded = JsonSerializer.Deserialize<TraySettings>(File.ReadAllText(paths.SettingsFile), Json) ?? new TraySettings();
            var problems = loaded.Problems();
            if (problems.Count == 0) return loaded;
            throw new InvalidDataException(string.Join(" ", problems));
        }
        catch (Exception error) when (error is JsonException or InvalidDataException or NotSupportedException)
        {
            var aside = paths.SettingsFile + ".bad";
            File.Copy(paths.SettingsFile, aside, overwrite: true);
            report?.Invoke($"Settings could not be read ({error.Message}); defaults are in use and the old file is saved as {aside}.");
            return new TraySettings();
        }
    }

    /// <summary>Written to a temporary file and moved into place, so a crash never leaves half a file.</summary>
    public void Save(YoinkPaths paths)
    {
        var problems = Problems();
        if (problems.Count > 0) throw new InvalidDataException(string.Join(" ", problems));
        Directory.CreateDirectory(paths.Root);
        var temporary = paths.SettingsFile + ".tmp";
        File.WriteAllText(temporary, JsonSerializer.Serialize(this, Json));
        File.Move(temporary, paths.SettingsFile, overwrite: true);
    }
}
