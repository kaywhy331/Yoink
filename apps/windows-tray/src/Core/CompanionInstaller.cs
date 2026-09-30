using System.IO.Compression;
using System.Text.Json;

namespace Yoink.Tray.Core;

/// <summary>
/// Keeps the Chrome companion in one folder the shopper loads unpacked once.
/// Updates replace the files in place (Chrome does not lock them); the running
/// companion sees the server's new version and reloads itself from the folder.
/// The folder never moves, so the extension ID and its pairing stay the same.
/// </summary>
public sealed class CompanionInstaller(YoinkPaths paths)
{
    public string Directory => paths.CompanionDirectory;

    public bool Installed => File.Exists(Path.Combine(Directory, "manifest.json"));

    /// <summary>The version in the folder's manifest.json, or "" when there is none.</summary>
    public string InstalledVersion()
    {
        try
        {
            using var document = JsonDocument.Parse(File.ReadAllText(Path.Combine(Directory, "manifest.json")));
            return document.RootElement.TryGetProperty("version", out var version) ? version.GetString() ?? "" : "";
        }
        catch (Exception error) when (error is IOException or JsonException or UnauthorizedAccessException)
        {
            return "";
        }
    }

    /// <summary>The companion ZIP a server package carries for its own version.</summary>
    public static string? PackagedZip(string serverDirectory, string version)
    {
        var path = Path.Combine(serverDirectory, "app", "release", $"Yoink-Companion-{version}.zip");
        return File.Exists(path) ? path : null;
    }

    /// <summary>
    /// Installs a companion ZIP into the folder: unpack and check beside it, then
    /// copy every file over and remove files the new version no longer has.
    /// Returns true when this was the first install (Chrome still needs Load unpacked).
    /// </summary>
    public bool Install(string companionZip)
    {
        var first = !Installed;
        var staging = Directory + $".installing-{Guid.NewGuid():N}";
        try
        {
            using (var archive = ZipFile.OpenRead(companionZip)) SafeZip.Extract(archive, staging, 256L << 20);
            if (!File.Exists(Path.Combine(staging, "manifest.json")))
                throw new InvalidDataException("The companion package has no manifest.json.");
            System.IO.Directory.CreateDirectory(Directory);
            var incoming = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
            foreach (var file in System.IO.Directory.GetFiles(staging, "*", SearchOption.AllDirectories))
            {
                var relative = Path.GetRelativePath(staging, file);
                incoming.Add(relative);
                var target = Path.Combine(Directory, relative);
                System.IO.Directory.CreateDirectory(Path.GetDirectoryName(target)!);
                File.Copy(file, target, overwrite: true);
            }
            foreach (var existing in System.IO.Directory.GetFiles(Directory, "*", SearchOption.AllDirectories))
            {
                var relative = Path.GetRelativePath(Directory, existing);
                // Chrome keeps its own verification data in _metadata; leave it alone.
                if (relative.StartsWith("_metadata", StringComparison.OrdinalIgnoreCase)) continue;
                if (!incoming.Contains(relative)) File.Delete(existing);
            }
            return first;
        }
        finally
        {
            ServerPackageInstaller.TryDelete(staging);
        }
    }
}
