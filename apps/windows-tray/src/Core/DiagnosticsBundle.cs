using System.IO.Compression;
using System.Text;
using System.Text.Json;

namespace Yoink.Tray.Core;

/// <summary>
/// One ZIP of what is needed to troubleshoot Yoink from the development
/// workstation: logs, the local server's own status reports, and the store
/// pages it saved when a store check failed. The database, keys, pairing
/// tokens and settings files with secrets are never included.
/// </summary>
public static class DiagnosticsBundle
{
    public const long MaxLogBytes = 4L << 20;
    public const long MaxApiBytes = 5L << 20;
    public const long MaxEvidenceBytes = 24L << 20;

    /// <summary>Read-only local API reports (GET only).</summary>
    public static readonly string[] ApiReports =
    [
        "/api/v1/health",
        "/api/v1/admin/snapshot",
        "/api/v1/user/delivery-health",
        "/api/v1/user/readiness",
        // What Yoink did with each recent call and why, the plans calls are
        // matched against, and the open cart handoff: the call-to-cart path.
        "/api/v1/user/calls",
        "/api/v1/user/purchase-intents",
        "/api/v1/user/action-handoff",
        "/api/v1/qualifications/readiness",
        "/api/v1/operations/telemetry?window=1h",
        "/api/v1/operations/telemetry?window=24h"
    ];

    public sealed record Result(byte[] Zip, IReadOnlyList<string> EvidenceIncluded);

    public static async Task<Result> BuildAsync(
        YoinkPaths paths,
        TraySettings settings,
        HttpClient http,
        IReadOnlyDictionary<string, object?> info,
        ISet<string> evidenceAlreadySent,
        DateTimeOffset now,
        CancellationToken cancelled = default)
    {
        using var buffer = new MemoryStream();
        var evidence = new List<string>();
        using (var zip = new ZipArchive(buffer, ZipArchiveMode.Create, leaveOpen: true))
        {
            Write(zip, "info.json", JsonSerializer.Serialize(info, new JsonSerializerOptions { WriteIndented = true }));
            if (File.Exists(paths.SettingsFile)) Write(zip, "tray-settings.json", File.ReadAllText(paths.SettingsFile));

            foreach (var day in new[] { now, now.AddDays(-1) })
            {
                foreach (var prefix in new[] { "tray", "server" })
                {
                    var log = Path.Combine(paths.LogsDirectory, $"{prefix}-{day:yyyy-MM-dd}.log");
                    if (File.Exists(log)) WriteTail(zip, $"logs/{Path.GetFileName(log)}", log, MaxLogBytes);
                }
            }

            foreach (var report in ApiReports)
            {
                var name = "api/" + report.TrimStart('/').Replace("api/v1/", "").Replace('/', '-').Replace("?window=", "-") + ".json";
                try
                {
                    using var response = await http.GetAsync($"http://127.0.0.1:{settings.Port}{report}", cancelled);
                    var body = await response.Content.ReadAsStringAsync(cancelled);
                    Write(zip, name, body.Length > MaxApiBytes ? body[..(int)MaxApiBytes] : body);
                }
                catch (Exception error) when (error is HttpRequestException or TaskCanceledException)
                {
                    Write(zip, name, JsonSerializer.Serialize(new { unreachable = error.Message }));
                }
            }

            var evidenceRoot = Path.Combine(settings.ResolvedDataDirectory(paths), "evidence");
            if (Directory.Exists(evidenceRoot))
            {
                var index = Path.Combine(evidenceRoot, "index.json");
                if (File.Exists(index)) zip.CreateEntryFromFile(index, "evidence/index.json");
                long used = 0;
                foreach (var file in Directory.GetFiles(evidenceRoot, "*.json.gz", SearchOption.AllDirectories)
                             .OrderByDescending(File.GetLastWriteTimeUtc))
                {
                    var relative = Path.GetRelativePath(evidenceRoot, file).Replace('\\', '/');
                    if (evidenceAlreadySent.Contains(relative)) continue;
                    var length = new FileInfo(file).Length;
                    if (used + length > MaxEvidenceBytes) continue;
                    zip.CreateEntryFromFile(file, $"evidence/{relative}", CompressionLevel.NoCompression);
                    used += length;
                    evidence.Add(relative);
                }
            }
        }
        return new Result(buffer.ToArray(), evidence);
    }

    private static void Write(ZipArchive zip, string name, string text)
    {
        using var writer = new StreamWriter(zip.CreateEntry(name).Open(), new UTF8Encoding(false));
        writer.Write(text);
    }

    /// <summary>The last <paramref name="maxBytes"/> of a log that may still be open for writing.</summary>
    private static void WriteTail(ZipArchive zip, string name, string path, long maxBytes)
    {
        using var input = new FileStream(path, FileMode.Open, FileAccess.Read, FileShare.ReadWrite | FileShare.Delete);
        if (input.Length > maxBytes) input.Seek(-maxBytes, SeekOrigin.End);
        using var output = zip.CreateEntry(name).Open();
        input.CopyTo(output);
    }

    /// <summary>Evidence files already uploaded, so each store page is sent once.</summary>
    public static HashSet<string> LoadSent(YoinkPaths paths)
    {
        try
        {
            return File.Exists(paths.DiagnosticsStateFile)
                ? JsonSerializer.Deserialize<HashSet<string>>(File.ReadAllText(paths.DiagnosticsStateFile)) ?? []
                : [];
        }
        catch (JsonException)
        {
            return [];
        }
    }

    public static void SaveSent(YoinkPaths paths, ISet<string> sent)
    {
        Directory.CreateDirectory(paths.Root);
        var temporary = paths.DiagnosticsStateFile + ".tmp";
        File.WriteAllText(temporary, JsonSerializer.Serialize(sent.OrderBy(value => value, StringComparer.Ordinal)));
        File.Move(temporary, paths.DiagnosticsStateFile, overwrite: true);
    }
}
