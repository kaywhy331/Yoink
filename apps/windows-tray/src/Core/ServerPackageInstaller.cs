using System.IO.Compression;

namespace Yoink.Tray.Core;

/// <summary>
/// Installs a server package ZIP into server\&lt;version&gt;. Accepts either the
/// server package itself (yoink-server.json at its root) or a Yoink Windows
/// release ZIP that carries exactly one Yoink-Server-win-x64-*.zip inside.
///
/// Everything is extracted and checked in a side folder first; the version
/// folder is replaced only once the new copy is complete, so a bad or
/// truncated ZIP never damages the installed server.
/// </summary>
public sealed class ServerPackageInstaller(YoinkPaths paths)
{
    /// <summary>Installed versions kept besides the active one, for going back.</summary>
    public const int KeptPreviousVersions = 2;

    public ServerManifest Install(string zipPath)
    {
        Directory.CreateDirectory(paths.ServersDirectory);
        using var archive = ZipFile.OpenRead(zipPath);
        if (archive.GetEntry(ServerManifest.FileName) is null)
        {
            var nested = archive.Entries
                .Where(entry => entry.FullName.EndsWith(".zip", StringComparison.OrdinalIgnoreCase)
                    && Path.GetFileName(entry.FullName).StartsWith("Yoink-Server-win-x64-", StringComparison.OrdinalIgnoreCase))
                .ToList();
            if (nested.Count != 1)
                throw new InvalidDataException("This ZIP is neither a Yoink server package nor a Yoink Windows release (no yoink-server.json and no single Yoink-Server-win-x64 ZIP inside).");
            var temporary = Path.Combine(paths.ServersDirectory, $".download-{Guid.NewGuid():N}.zip");
            try
            {
                nested[0].ExtractToFile(temporary);
                return Install(temporary);
            }
            finally
            {
                File.Delete(temporary);
            }
        }

        var staging = Path.Combine(paths.ServersDirectory, $".installing-{Guid.NewGuid():N}");
        try
        {
            SafeZip.Extract(archive, staging);
            var manifest = ServerManifest.Load(staging);
            RequireFile(staging, manifest.NodePath, "node.exe");
            RequireFile(staging, $"{manifest.WorkingDirectory}/{manifest.Entry}", "the server entry point");
            var target = paths.ServerDirectory(manifest.Version);
            if (Directory.Exists(target))
            {
                var aside = Path.Combine(paths.ServersDirectory, $".replaced-{Guid.NewGuid():N}");
                Directory.Move(target, aside);
                Directory.Move(staging, target);
                TryDelete(aside);
            }
            else
            {
                Directory.Move(staging, target);
            }
            return manifest;
        }
        finally
        {
            TryDelete(staging);
        }
    }

    /// <summary>Installed versions, newest first; half-finished side folders are skipped.</summary>
    public IReadOnlyList<string> InstalledVersions()
    {
        if (!Directory.Exists(paths.ServersDirectory)) return [];
        return Directory.GetDirectories(paths.ServersDirectory)
            .Select(Path.GetFileName)
            .OfType<string>()
            .Where(name => ServerVersion.IsSafe(name) && File.Exists(Path.Combine(paths.ServersDirectory, name, ServerManifest.FileName)))
            .OrderByDescending(name => name, Comparer<string>.Create(ServerVersion.Compare))
            .ToList();
    }

    /// <summary>Removes old versions and leftovers of interrupted installs; never the active version.</summary>
    public void Prune(string activeVersion)
    {
        foreach (var version in InstalledVersions().Where(version => version != activeVersion).Skip(KeptPreviousVersions))
            TryDelete(paths.ServerDirectory(version));
        if (!Directory.Exists(paths.ServersDirectory)) return;
        foreach (var leftover in Directory.GetDirectories(paths.ServersDirectory, ".*"))
            TryDelete(leftover);
    }

    private static void RequireFile(string root, string relative, string description)
    {
        if (!File.Exists(Path.Combine(root, relative.Replace('/', Path.DirectorySeparatorChar))))
            throw new InvalidDataException($"The server package is missing {description} ({relative}).");
    }

    internal static void TryDelete(string directory)
    {
        try
        {
            if (Directory.Exists(directory)) Directory.Delete(directory, recursive: true);
        }
        catch (Exception error) when (error is IOException or UnauthorizedAccessException)
        {
            // A file still open (antivirus scan, an old server) is removed on the next prune.
        }
    }
}
