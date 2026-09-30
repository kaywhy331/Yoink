using System.Text.Json;

namespace Yoink.Tray.Core;

public enum ServerHealth { Unreachable, Ready, Degraded }

/// <param name="ActionsInFlight">Cart adds between lease and result right now; updates wait while it is above zero.</param>
public readonly record struct HealthReading(ServerHealth Health, string Version, string Summary, int ActionsInFlight = 0);

/// <summary>Reads GET /api/v1/health on loopback. 200 is ready; 503 with a body is degraded (the reasons say why).</summary>
public sealed class HealthProbe(HttpClient http)
{
    public static HttpClient CreateClient() => new() { Timeout = TimeSpan.FromSeconds(3) };

    public async Task<HealthReading> ReadAsync(int port, string healthPath, CancellationToken cancelled = default)
    {
        try
        {
            using var response = await http.GetAsync($"http://127.0.0.1:{port}{healthPath}", cancelled);
            var body = await response.Content.ReadAsStringAsync(cancelled);
            return Interpret((int)response.StatusCode, body);
        }
        catch (Exception error) when (error is HttpRequestException or TaskCanceledException)
        {
            return new(ServerHealth.Unreachable, "", "Not answering.");
        }
    }

    public static HealthReading Interpret(int status, string body)
    {
        var version = "";
        var inFlight = 0;
        var reasons = new List<string>();
        try
        {
            using var document = JsonDocument.Parse(body);
            var root = document.RootElement;
            if (root.TryGetProperty("version", out var v) && v.ValueKind == JsonValueKind.String) version = v.GetString() ?? "";
            if (root.TryGetProperty("actionsInFlight", out var f) && f.ValueKind == JsonValueKind.Number) inFlight = Math.Max(0, f.GetInt32());
            if (root.TryGetProperty("reasons", out var r) && r.ValueKind == JsonValueKind.Array)
                reasons.AddRange(r.EnumerateArray().Select(Reason).Where(text => text.Length > 0));
        }
        catch (JsonException)
        {
            return new(ServerHealth.Unreachable, "", $"Port answered with HTTP {status}, but not as Yoink. Is another program using it?");
        }
        if (status == 200) return new(ServerHealth.Ready, version, "Running.", inFlight);
        return new(ServerHealth.Degraded, version, reasons.Count > 0 ? string.Join("; ", reasons) : $"Not ready (HTTP {status}).", inFlight);
    }

    /// <summary>Plain words for the health reason codes the server reports (apps/api/src/app.ts).</summary>
    private static readonly Dictionary<string, string> ReasonWords = new(StringComparer.Ordinal)
    {
        ["database_unavailable"] = "the database cannot be opened",
        ["schema_mismatch"] = "the database is from a different Yoink version",
        ["background_worker_unhealthy"] = "background work has stopped (restart Yoink)",
        ["disk_low"] = "the disk is too full for the next backup",
        ["evidence_index_unreadable"] = "the evidence index cannot be read"
    };

    private static string Reason(JsonElement reason) => reason.ValueKind switch
    {
        JsonValueKind.String => ReasonWords.GetValueOrDefault(reason.GetString() ?? "", reason.GetString() ?? ""),
        JsonValueKind.Object when reason.TryGetProperty("message", out var message) && message.ValueKind == JsonValueKind.String => message.GetString() ?? "",
        JsonValueKind.Object when reason.TryGetProperty("code", out var code) && code.ValueKind == JsonValueKind.String => code.GetString() ?? "",
        _ => ""
    };
}
