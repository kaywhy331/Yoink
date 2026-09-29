using System.Text.Json;
using Yoink.NotificationCapture;

var now = DateTimeOffset.Parse("2026-09-06T23:59:59Z");
var root = Path.Combine(Path.GetTempPath(), "yoink-capture-tests-" + Guid.NewGuid().ToString("N"));
var assertions = 0;
void Check(bool condition, string message) { assertions++; if (!condition) throw new Exception(message); }
NotificationSnapshot Sample(uint id = 1, string text = "Item €29.99\nhttps://example.com/p/123 😀") =>
    new(id, "com.squirrel.Discord.Discord", "Discord", now,
        [new("ToastGeneric", "en-US", ["channel • sender", text])]);

try
{
    var log = new DailyJsonLog(root);
    var session = new CaptureSession(log.Write);
    var original = Sample();
    var unrelated = original with { AppId = "browser", AppName = "Chrome" };
    session.Observe([original, unrelated], now);
    session.Observe([original, unrelated], now.AddMilliseconds(500));
    Check(session.Written == 1, "Repeated polling must not duplicate a sample or record Chrome text mentioning Discord.");
    Check(session.CurrentDiscordNotifications == 1, "Only matching app notifications should be counted.");
    session.Observe([Sample(text: "Changed price $25"), Sample(2)], now.AddMilliseconds(750));
    var dayOne = File.ReadAllLines(Path.Combine(root, "capture-2026-09-06.jsonl"));
    Check(dayOne.Length == 3, "Changed content and distinct notifications must each be recorded.");
    using var first = JsonDocument.Parse(dayOne[0]);
    using var changed = JsonDocument.Parse(dayOne[1]);
    using var added = JsonDocument.Parse(dayOne[2]);
    Check(first.RootElement.GetProperty("details").GetProperty("observation").GetString() == "existing", "Initial snapshot is existing.");
    Check(changed.RootElement.GetProperty("details").GetProperty("observation").GetString() == "updated", "Changes are updates.");
    Check(added.RootElement.GetProperty("details").GetProperty("observation").GetString() == "added", "Later notifications are added.");
    Check(first.RootElement.GetProperty("details").GetProperty("bindings")[0].GetProperty("textElements")[1].GetString()
        == original.Bindings[0].TextElements[1], "Unicode and multiline text must survive JSONL without splitting records.");
    session.Observe([original with { CreatedAt = now.AddSeconds(2) }], now.AddSeconds(2));
    Check(File.ReadAllLines(Path.Combine(root, "capture-2026-09-07.jsonl")).Length == 1, "Log must rotate at UTC midnight and handle reused Windows IDs.");
    session.Observe([], now.AddSeconds(3));
    session.Observe([Sample(3) with { Bindings = [] }], now.AddSeconds(4));
    Check(session.Written == 5, "Notifications with no readable text are still useful samples.");
    var restart = new CaptureSession(log.Write);
    restart.Observe([original], now.AddSeconds(5));
    Check(restart.Written == 1, "A new session records a baseline even for older notifications.");
    Check(!DiscordApps.Matches("browser", "Discord alerts in Chrome"), "App-name substring matches must not capture unrelated apps.");
    Check(DiscordApps.Matches("com.squirrel.DiscordCanary.DiscordCanary", "Localized name"), "Known app ID supports localized labels.");

    var failOnce = true;
    var recovered = new List<string>();
    var unreliable = new CaptureSession((kind, timestamp, details) => {
        if (failOnce) { failOnce = false; throw new IOException("test disk failure"); }
        recovered.Add(JsonSerializer.Serialize(details, DailyJsonLog.JsonOptions));
    });
    try { unreliable.Observe([original], now); throw new Exception("Expected disk failure."); }
    catch (IOException) { }
    Check(unreliable.Written == 0, "A failed append cannot count as a saved sample.");
    unreliable.Observe([original], now);
    Check(recovered.Count == 1 && unreliable.Written == 1, "The failed sample must remain eligible for retry.");
    var nextDay = Path.Combine(root, "capture-2026-09-07.jsonl");
    File.AppendAllText(nextDay, "{\"interrupted\":");
    log.Write("session_started", now.AddSeconds(6), new { captureVersion = "test" });
    var repairedLines = File.ReadAllLines(nextDay);
    using var recoveredLine = JsonDocument.Parse(repairedLines[^1]);
    Check(repairedLines[^2] == "{\"interrupted\":" && recoveredLine.RootElement.GetProperty("eventType").GetString() == "session_started",
        "A partial previous append must not corrupt the next session's first record.");
    Console.WriteLine($"PASS: {assertions} capture checks (filtering, deduplication, updates, identity reuse, rotation, JSONL, I/O recovery).");
}
finally { if (Directory.Exists(root)) Directory.Delete(root, recursive: true); }
