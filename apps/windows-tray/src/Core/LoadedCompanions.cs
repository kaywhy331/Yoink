using System.Text.Json;

namespace Yoink.Tray.Core;

/// <summary>A browser profile that loads the Yoink companion unpacked from a folder.</summary>
public sealed record LoadedCompanion(string Browser, string Profile, string ExtensionId, string Folder, string Version);

/// <summary>
/// Finds every folder a Chromium browser loads the Yoink companion from, by
/// reading each profile's Preferences and Secure Preferences (read only; the
/// browser may be running). The extension ID, pairing and store access belong
/// to the folder a browser loads, so updating those folders in place keeps a
/// companion working without loading it again.
/// </summary>
public static class LoadedCompanions
{
    // Chromium's Manifest::Location values for an extension loaded from a folder:
    // UNPACKED (Load unpacked) and COMMAND_LINE (--load-extension).
    private const int Unpacked = 4;
    private const int CommandLine = 8;
    private const long MaxPreferencesBytes = 64L << 20;

    /// <summary>The user data folders of the Chromium browsers a Windows PC may have, under %LOCALAPPDATA%.</summary>
    public static IReadOnlyList<(string Browser, string UserData)> WindowsBrowsers(string localAppData) =>
    [
        ("Chrome", Path.Combine(localAppData, "Google", "Chrome", "User Data")),
        ("Chrome Beta", Path.Combine(localAppData, "Google", "Chrome Beta", "User Data")),
        ("Chrome Dev", Path.Combine(localAppData, "Google", "Chrome Dev", "User Data")),
        ("Chrome Canary", Path.Combine(localAppData, "Google", "Chrome SxS", "User Data")),
        ("Chromium", Path.Combine(localAppData, "Chromium", "User Data")),
        ("Brave", Path.Combine(localAppData, "BraveSoftware", "Brave-Browser", "User Data")),
        ("Brave Beta", Path.Combine(localAppData, "BraveSoftware", "Brave-Browser-Beta", "User Data")),
        ("Brave Nightly", Path.Combine(localAppData, "BraveSoftware", "Brave-Browser-Nightly", "User Data")),
        ("Edge", Path.Combine(localAppData, "Microsoft", "Edge", "User Data")),
        ("Edge Beta", Path.Combine(localAppData, "Microsoft", "Edge Beta", "User Data")),
        ("Edge Dev", Path.Combine(localAppData, "Microsoft", "Edge Dev", "User Data")),
        ("Vivaldi", Path.Combine(localAppData, "Vivaldi", "User Data"))
    ];

    /// <summary>
    /// Every profile that loads a folder holding the Yoink companion. A profile
    /// or file that cannot be read is skipped; this never throws for one.
    /// </summary>
    public static IReadOnlyList<LoadedCompanion> Find(IEnumerable<(string Browser, string UserData)> browsers)
    {
        var found = new List<LoadedCompanion>();
        foreach (var (browser, userData) in browsers)
        {
            string[] profiles;
            try { profiles = Directory.Exists(userData) ? Directory.GetDirectories(userData) : []; }
            catch (Exception error) when (error is IOException or UnauthorizedAccessException) { continue; }
            foreach (var profile in profiles.Order(StringComparer.OrdinalIgnoreCase))
            {
                var profileName = Path.GetFileName(profile);
                var folders = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
                foreach (var file in new[] { "Secure Preferences", "Preferences" })
                {
                    using var document = TryRead(Path.Combine(profile, file));
                    if (document is null) continue;
                    var root = document.RootElement;
                    if (root.TryGetProperty("profile", out var info) && info.ValueKind == JsonValueKind.Object
                        && info.TryGetProperty("name", out var name) && name.ValueKind == JsonValueKind.String
                        && !string.IsNullOrWhiteSpace(name.GetString()))
                        profileName = name.GetString()!;
                    foreach (var (id, folder) in UnpackedExtensions(root)) folders.TryAdd(id, folder);
                }
                foreach (var (id, folder) in folders)
                {
                    if (!CompanionInstaller.HoldsCompanion(folder)) continue;
                    found.Add(new LoadedCompanion(browser, profileName, id, folder, CompanionInstaller.ReadVersion(folder)));
                }
            }
        }
        return found;
    }

    private static IEnumerable<(string Id, string Folder)> UnpackedExtensions(JsonElement root)
    {
        if (!root.TryGetProperty("extensions", out var extensions) || extensions.ValueKind != JsonValueKind.Object
            || !extensions.TryGetProperty("settings", out var settings) || settings.ValueKind != JsonValueKind.Object)
            yield break;
        foreach (var entry in settings.EnumerateObject())
        {
            var value = entry.Value;
            if (value.ValueKind != JsonValueKind.Object
                || !value.TryGetProperty("location", out var location) || !location.TryGetInt32(out var where)
                || where is not (Unpacked or CommandLine)
                || !value.TryGetProperty("path", out var path) || path.ValueKind != JsonValueKind.String)
                continue;
            var folder = FullFolder(path.GetString());
            if (folder is not null) yield return (entry.Name, folder);
        }
    }

    // Store-installed extensions record a path relative to the profile; only a full path is a folder of the shopper's.
    private static string? FullFolder(string? path)
    {
        if (string.IsNullOrEmpty(path) || !Path.IsPathFullyQualified(path)) return null;
        try { return Path.TrimEndingDirectorySeparator(Path.GetFullPath(path)); }
        catch (Exception error) when (error is ArgumentException or NotSupportedException or PathTooLongException) { return null; }
    }

    private static JsonDocument? TryRead(string file)
    {
        try
        {
            using var stream = new FileStream(file, FileMode.Open, FileAccess.Read, FileShare.ReadWrite | FileShare.Delete);
            if (stream.Length > MaxPreferencesBytes) return null;
            return JsonDocument.Parse(stream);
        }
        catch (Exception error) when (error is IOException or UnauthorizedAccessException or JsonException)
        {
            return null;
        }
    }
}
