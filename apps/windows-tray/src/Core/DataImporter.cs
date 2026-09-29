using System.IO.Compression;
using System.Text.Json;

namespace Yoink.Tray.Core;

/// <summary>What a data export says about itself (yoink-data.json, scripts/export-data.mjs).</summary>
public sealed record DataExportInfo(string ExportedAt, string ExportedFrom, string YoinkVersion, int DatabaseSchema, bool ServiceWasRunning);

public sealed record DataImportResult(DataExportInfo Export, string DataDirectory, string PreviousDataSetAside);

/// <summary>
/// Replaces the data folder with an exported one (moving Yoink from TrixBot).
/// The server must be stopped. The export is unpacked and checked beside the
/// data folder first; the existing folder is then renamed aside, never
/// deleted, so an import can always be undone by renaming it back.
/// </summary>
public static class DataImporter
{
    public const string ManifestFile = "yoink-data.json";
    public const string DatabaseFile = "yoink.sqlite";

    public static bool HasDatabase(string dataDirectory) => File.Exists(Path.Combine(dataDirectory, DatabaseFile));

    public static DataExportInfo ReadInfo(ZipArchive archive)
    {
        var entry = archive.GetEntry(ManifestFile)
            ?? throw new InvalidDataException("This ZIP is not a Yoink data export (it has no yoink-data.json).");
        using var reader = new StreamReader(entry.Open());
        using var document = JsonDocument.Parse(reader.ReadToEnd());
        var root = document.RootElement;
        string Text(string name) => root.TryGetProperty(name, out var value) && value.ValueKind == JsonValueKind.String ? value.GetString() ?? "" : "";
        if (Text("product") != "yoink-data") throw new InvalidDataException("This ZIP is not a Yoink data export.");
        var schema = root.TryGetProperty("schemaVersion", out var s) && s.ValueKind == JsonValueKind.Number ? s.GetInt32() : 0;
        if (schema != 1) throw new InvalidDataException($"This data export uses format {schema}; this tray app reads format 1. Install a newer tray app.");
        if (archive.GetEntry(DatabaseFile) is null) throw new InvalidDataException("The data export has no yoink.sqlite.");
        return new DataExportInfo(
            Text("exportedAt"),
            Text("exportedFrom"),
            Text("yoinkVersion"),
            root.TryGetProperty("databaseSchema", out var d) && d.ValueKind == JsonValueKind.Number ? d.GetInt32() : 0,
            root.TryGetProperty("serviceWasRunning", out var r) && r.ValueKind == JsonValueKind.True);
    }

    public static DataImportResult Import(string zipPath, string dataDirectory, DateTimeOffset now)
    {
        var target = Path.GetFullPath(dataDirectory).TrimEnd(Path.DirectorySeparatorChar);
        var parent = Path.GetDirectoryName(target) ?? throw new InvalidDataException("The data folder cannot be a drive root.");
        Directory.CreateDirectory(parent);
        using var archive = ZipFile.OpenRead(zipPath);
        var info = ReadInfo(archive);
        var staging = $"{target}.importing-{Guid.NewGuid():N}";
        try
        {
            SafeZip.Extract(archive, staging);
            File.Delete(Path.Combine(staging, ManifestFile));
            var aside = "";
            if (Directory.Exists(target))
            {
                if (Directory.EnumerateFileSystemEntries(target).Any())
                {
                    aside = $"{target}.before-import-{now:yyyyMMdd-HHmmss}";
                    // A still-running server keeps files open; Windows then refuses the move and nothing changes.
                    Directory.Move(target, aside);
                }
                else
                {
                    Directory.Delete(target);
                }
            }
            Directory.Move(staging, target);
            return new DataImportResult(info, target, aside);
        }
        finally
        {
            ServerPackageInstaller.TryDelete(staging);
        }
    }
}
