using System.IO.Compression;
using System.Text.Json;

namespace Yoink.Tray.Core;

/// <summary>
/// Keeps the Chrome companion in one folder the shopper loads unpacked once.
/// Updates replace the files in place (Chrome does not lock them); the running
/// companion sees the server's new version and reloads itself from the folder.
/// The folder never moves, so the extension ID and its pairing stay the same.
/// A companion a browser already loads from another folder is updated there
/// too (see <see cref="LoadedCompanions"/>), so it never has to be loaded again.
/// </summary>
public sealed class CompanionInstaller(YoinkPaths paths)
{
    /// <summary>The name in the companion's manifest.json; a folder without it is never written to.</summary>
    public const string CompanionName = "Yoink Companion";

    public string Directory => paths.CompanionDirectory;

    public bool Installed => File.Exists(Path.Combine(Directory, "manifest.json"));

    /// <summary>The version in the folder's manifest.json, or "" when there is none.</summary>
    public string InstalledVersion() => ReadVersion(Directory);

    /// <summary>The version in a folder's manifest.json, or "" when there is none.</summary>
    public static string ReadVersion(string folder)
    {
        using var document = ReadManifest(folder);
        return document is not null && document.RootElement.TryGetProperty("version", out var version)
            && version.ValueKind == JsonValueKind.String ? version.GetString() ?? "" : "";
    }

    /// <summary>True when a folder holds the Yoink companion: its manifest names it and its service worker is there.</summary>
    public static bool HoldsCompanion(string folder)
    {
        using var document = ReadManifest(folder);
        if (document is null) return false;
        var root = document.RootElement;
        return root.TryGetProperty("name", out var name) && name.ValueKind == JsonValueKind.String && name.GetString() == CompanionName
            && root.TryGetProperty("background", out var background) && background.ValueKind == JsonValueKind.Object
            && background.TryGetProperty("service_worker", out var worker) && worker.ValueKind == JsonValueKind.String
            && worker.GetString() == "background.js" && File.Exists(Path.Combine(folder, "background.js"));
    }

    private static JsonDocument? ReadManifest(string folder)
    {
        try
        {
            if (!System.IO.Directory.Exists(folder)) return null;
            var document = JsonDocument.Parse(File.ReadAllText(Path.Combine(folder, "manifest.json")));
            if (document.RootElement.ValueKind == JsonValueKind.Object) return document;
            document.Dispose();
            return null;
        }
        catch (Exception error) when (error is IOException or JsonException or UnauthorizedAccessException)
        {
            return null;
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
        Unpacked(companionZip, staging =>
        {
            System.IO.Directory.CreateDirectory(Directory);
            var incoming = CopyOver(staging, Directory);
            foreach (var existing in System.IO.Directory.GetFiles(Directory, "*", SearchOption.AllDirectories))
            {
                var relative = Path.GetRelativePath(Directory, existing);
                // Chrome keeps its own verification data in _metadata; leave it alone.
                if (relative.StartsWith("_metadata", StringComparison.OrdinalIgnoreCase)) continue;
                if (!incoming.Contains(relative)) File.Delete(existing);
            }
        });
        return first;
    }

    /// <summary>
    /// Updates a folder a browser already loads the companion from, so that
    /// companion keeps its extension ID, pairing and store access. Only a folder
    /// that already holds the Yoink companion is written to, and nothing in it is
    /// removed: the folder is the shopper's, and files the new version no longer
    /// uses do no harm.
    /// </summary>
    public void Refresh(string companionZip, string folder)
    {
        if (!HoldsCompanion(folder))
            throw new InvalidDataException($"{folder} does not hold the Yoink companion, so it was left alone.");
        Unpacked(companionZip, staging => CopyOver(staging, folder));
    }

    private void Unpacked(string companionZip, Action<string> use)
    {
        var staging = Directory + $".installing-{Guid.NewGuid():N}";
        try
        {
            using (var archive = ZipFile.OpenRead(companionZip)) SafeZip.Extract(archive, staging, 256L << 20);
            if (!HoldsCompanion(staging))
                throw new InvalidDataException("The companion package does not hold the Yoink companion.");
            use(staging);
        }
        finally
        {
            ServerPackageInstaller.TryDelete(staging);
        }
    }

    /// <summary>
    /// Copies every staged file over the target. manifest.json goes last, so a
    /// reload in the middle of the copy still reports the old version and the
    /// companion tries again. Returns the relative paths copied.
    /// </summary>
    private static HashSet<string> CopyOver(string staging, string target)
    {
        var incoming = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        var files = System.IO.Directory.GetFiles(staging, "*", SearchOption.AllDirectories)
            .OrderBy(file => Path.GetRelativePath(staging, file).Equals("manifest.json", StringComparison.OrdinalIgnoreCase));
        foreach (var file in files)
        {
            var relative = Path.GetRelativePath(staging, file);
            incoming.Add(relative);
            var destination = Path.Combine(target, relative);
            System.IO.Directory.CreateDirectory(Path.GetDirectoryName(destination)!);
            File.Copy(file, destination, overwrite: true);
        }
        return incoming;
    }
}
