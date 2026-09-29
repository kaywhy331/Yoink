using System.Security.Cryptography;
using System.Text;
using System.Text.Json;

namespace Yoink.NotificationCapture;

public sealed record TextBinding(string Template, string Language, string[] TextElements);
public sealed record NotificationSnapshot(
    uint NotificationId, string AppId, string AppName, DateTimeOffset CreatedAt, TextBinding[] Bindings);

public static class DiscordApps
{
    private static readonly HashSet<string> Names = new(StringComparer.OrdinalIgnoreCase)
        { "Discord", "Discord PTB", "Discord Canary", "DiscordPTB", "DiscordCanary" };
    private static readonly HashSet<string> Ids = new(StringComparer.OrdinalIgnoreCase)
        { "com.squirrel.Discord.Discord", "com.squirrel.DiscordPTB.DiscordPTB",
          "com.squirrel.DiscordCanary.DiscordCanary", "com.hammerandchisel.discord" };

    // Never infer the source from message text: a browser or another app may mention Discord.
    public static bool Matches(string appId, string appName) => Ids.Contains(appId) || Names.Contains(appName);
}

public sealed class DailyJsonLog(string directory)
{
    public static readonly JsonSerializerOptions JsonOptions = new() { PropertyNamingPolicy = JsonNamingPolicy.CamelCase };
    public string SessionId { get; } = Guid.NewGuid().ToString("N");
    public string DirectoryPath { get; } = Path.GetFullPath(directory);

    public void Write(string eventType, DateTimeOffset now, object details)
    {
        Directory.CreateDirectory(DirectoryPath);
        var path = Path.Combine(DirectoryPath, $"capture-{now.UtcDateTime:yyyy-MM-dd}.jsonl");
        var line = JsonSerializer.Serialize(new { schemaVersion = 1, eventType, sessionId = SessionId,
            capturedAt = now.ToUniversalTime(), details }, JsonOptions) + "\n";
        var bytes = Encoding.UTF8.GetBytes(line);
        using var stream = new FileStream(path, FileMode.OpenOrCreate, FileAccess.ReadWrite, FileShare.Read);
        var needsNewline = false;
        if (stream.Length > 0)
        {
            stream.Seek(-1, SeekOrigin.End);
            needsNewline = stream.ReadByte() != '\n';
        }
        if (stream.Length + bytes.Length + (needsNewline ? 1 : 0) > 50 * 1024 * 1024)
            throw new IOException("Today's log reached 50 MB. Move it to an archive folder before restarting capture.");
        stream.Seek(0, SeekOrigin.End);
        // Preserve an interrupted append as a separate invalid line for analysis.
        if (needsNewline) stream.WriteByte((byte)'\n');
        stream.Write(bytes);
        stream.Flush(flushToDisk: true);
    }
}

public sealed class CaptureSession(Action<string, DateTimeOffset, object> write)
{
    private readonly Dictionary<string, string> fingerprints = new();
    private bool hasSnapshot;
    public int Written { get; private set; }
    public int Polls { get; private set; }
    public int CurrentDiscordNotifications { get; private set; }

    public void Observe(IReadOnlyList<NotificationSnapshot> snapshots, DateTimeOffset now)
    {
        var currentKeys = new HashSet<string>();
        var count = 0;
        foreach (var snapshot in snapshots)
        {
            if (!DiscordApps.Matches(snapshot.AppId, snapshot.AppName)) continue;
            count++;
            // Windows IDs can be reused. Creation time is part of the identity.
            var key = JsonSerializer.Serialize(new { snapshot.AppId, snapshot.NotificationId,
                CreatedAt = snapshot.CreatedAt.ToUniversalTime() });
            currentKeys.Add(key);
            var fingerprint = Convert.ToHexString(SHA256.HashData(JsonSerializer.SerializeToUtf8Bytes(
                new { snapshot.AppName, snapshot.Bindings }, DailyJsonLog.JsonOptions))).ToLowerInvariant();
            if (fingerprints.TryGetValue(key, out var previous) && previous == fingerprint) continue;
            var observation = previous is not null ? "updated" : hasSnapshot ? "added" : "existing";
            write("notification", now, new {
                source = "windows_notification", observation, snapshot.NotificationId, snapshot.AppId,
                snapshot.AppName, createdAt = snapshot.CreatedAt.ToUniversalTime(), contentHash = fingerprint,
                snapshot.Bindings
            });
            // Advance state only after the append succeeds, so an I/O failure cannot silently lose the sample.
            fingerprints[key] = fingerprint;
            Written++;
        }
        foreach (var key in fingerprints.Keys.Where(key => !currentKeys.Contains(key)).ToArray()) fingerprints.Remove(key);
        hasSnapshot = true;
        CurrentDiscordNotifications = count;
        Polls++;
    }
}
