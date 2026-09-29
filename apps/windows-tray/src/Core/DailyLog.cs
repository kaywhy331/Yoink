namespace Yoink.Tray.Core;

/// <summary>
/// Plain-text daily logs (&lt;prefix&gt;-YYYY-MM-DD.log, local date) with a
/// timestamp per line. Thread-safe; files older than the retention are
/// removed when a new day's file is opened.
/// </summary>
public sealed class DailyLog(string directory, string prefix, Func<DateTimeOffset>? clock = null, int retentionDays = 14)
{
    private readonly Func<DateTimeOffset> clock = clock ?? (() => DateTimeOffset.Now);
    private readonly object gate = new();
    private string openedFor = "";

    public string Directory { get; } = directory;

    public string PathFor(DateTimeOffset when) => Path.Combine(Directory, $"{prefix}-{when:yyyy-MM-dd}.log");

    public string CurrentPath => PathFor(clock());

    public void Write(string line)
    {
        var now = clock();
        var path = PathFor(now);
        lock (gate)
        {
            System.IO.Directory.CreateDirectory(Directory);
            if (openedFor != path)
            {
                openedFor = path;
                Prune(now);
            }
            File.AppendAllText(path, $"{now:yyyy-MM-dd HH:mm:ss.fff zzz} {line.TrimEnd('\r', '\n')}{Environment.NewLine}");
        }
    }

    private void Prune(DateTimeOffset now)
    {
        var cutoff = now.Date.AddDays(-retentionDays);
        foreach (var file in System.IO.Directory.GetFiles(Directory, $"{prefix}-*.log"))
        {
            var stamp = Path.GetFileNameWithoutExtension(file)[(prefix.Length + 1)..];
            if (DateTime.TryParseExact(stamp, "yyyy-MM-dd", null, System.Globalization.DateTimeStyles.None, out var day) && day < cutoff)
            {
                try { File.Delete(file); } catch (IOException) { /* open elsewhere; next day retries */ }
            }
        }
    }
}
