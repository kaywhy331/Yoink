using System.Text.Json;

namespace Yoink.Tray.Core;

/// <summary>
/// yoink-server.json from a server package (scripts/package-windows-server.mjs).
/// Only the fields the tray app needs are read; every path is checked to stay
/// inside the package folder.
/// </summary>
public sealed record ServerManifest(
    string Version,
    string Commit,
    bool Dirty,
    string NodeVersion,
    string NodePath,
    string WorkingDirectory,
    string Entry,
    string HealthPath,
    int NonRetryableExitCode,
    IReadOnlyDictionary<string, string> Environment)
{
    public const string FileName = "yoink-server.json";
    public const int SupportedSchemaVersion = 1;

    public static ServerManifest Parse(string json)
    {
        using var document = JsonDocument.Parse(json);
        var root = document.RootElement;
        int schema = root.TryGetProperty("schemaVersion", out var schemaValue) && schemaValue.ValueKind == JsonValueKind.Number
            ? schemaValue.GetInt32()
            : 0;
        if (schema != SupportedSchemaVersion)
            throw new InvalidDataException($"This server package uses format {schema}; this Yoink tray app reads format {SupportedSchemaVersion}. Install a newer tray app.");
        if (Text(root, "product") != "yoink-server") throw new InvalidDataException("This ZIP is not a Yoink server package.");
        if (Text(root, "platform") != "win-x64") throw new InvalidDataException($"This server package is for {Text(root, "platform")}, not Windows x64.");
        var build = Child(root, "build");
        var node = Child(root, "node");
        var server = Child(root, "server");
        var environment = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
        if (server.TryGetProperty("environment", out var variables) && variables.ValueKind == JsonValueKind.Object)
        {
            foreach (var variable in variables.EnumerateObject())
                environment[variable.Name] = variable.Value.GetString() ?? "";
        }
        return new ServerManifest(
            ServerVersion.RequireSafe(Text(root, "version")),
            Text(build, "commit"),
            build.TryGetProperty("dirty", out var dirty) && dirty.ValueKind == JsonValueKind.True,
            Text(node, "version"),
            RelativePath(Text(node, "path"), "node.path"),
            RelativePath(Text(server, "workingDirectory"), "server.workingDirectory"),
            RelativePath(Text(server, "entry"), "server.entry"),
            Text(server, "healthPath") is { Length: > 0 } health && health.StartsWith('/') ? health : "/api/v1/health",
            server.TryGetProperty("nonRetryableExitCode", out var code) && code.ValueKind == JsonValueKind.Number ? code.GetInt32() : 78,
            environment);
    }

    public static ServerManifest Load(string packageDirectory) =>
        Parse(File.ReadAllText(Path.Combine(packageDirectory, FileName)));

    private static JsonElement Child(JsonElement parent, string name) =>
        parent.TryGetProperty(name, out var value) && value.ValueKind == JsonValueKind.Object
            ? value
            : throw new InvalidDataException($"The server package manifest has no '{name}' section.");

    private static string Text(JsonElement parent, string name) =>
        parent.TryGetProperty(name, out var value) && value.ValueKind == JsonValueKind.String ? value.GetString() ?? "" : "";

    /// <summary>A forward-slash relative path with no rooting and no '..' segment.</summary>
    public static string RelativePath(string value, string field)
    {
        var parts = value.Replace('\\', '/').Split('/', StringSplitOptions.RemoveEmptyEntries);
        if (value.Length == 0 || parts.Length == 0 || value.StartsWith('/') || value.StartsWith('\\') || value.Contains(':')
            || parts.Any(part => part is "." or ".."))
            throw new InvalidDataException($"The server package manifest's {field} ('{value}') must be a path inside the package.");
        return string.Join('/', parts);
    }
}
