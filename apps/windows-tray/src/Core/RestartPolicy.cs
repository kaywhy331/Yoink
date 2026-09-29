namespace Yoink.Tray.Core;

/// <summary>
/// Whether an unexpected server exit is retried. Mirrors the Linux unit
/// (install-local-service.mjs): exit 78 means configuration, lock, disk or
/// migration trouble only a person can fix, so it is never retried, and five
/// failed starts within ten minutes stop retrying instead of looping.
/// </summary>
public sealed class RestartPolicy(int nonRetryableExitCode = 78, int burst = 5, TimeSpan? window = null, TimeSpan? delay = null)
{
    private readonly TimeSpan window = window ?? TimeSpan.FromMinutes(10);
    private readonly Queue<DateTimeOffset> restarts = new();

    public TimeSpan Delay { get; } = delay ?? TimeSpan.FromSeconds(2);

    public RestartDecision Decide(int exitCode, DateTimeOffset now)
    {
        if (exitCode == 0) return new(false, "Yoink stopped.");
        if (exitCode == nonRetryableExitCode)
            return new(false, "Yoink could not start and needs a fix before it can run; the last log lines say what.");
        while (restarts.Count > 0 && now - restarts.Peek() > window) restarts.Dequeue();
        if (restarts.Count >= burst)
            return new(false, $"Yoink stopped unexpectedly {burst} times in {window.TotalMinutes:0} minutes, so it was not started again. Check the logs, then start it from the tray.");
        restarts.Enqueue(now);
        return new(true, $"Yoink stopped unexpectedly (exit {exitCode}); restarting.");
    }

    /// <summary>A start the person asked for clears the count.</summary>
    public void Reset() => restarts.Clear();
}

public readonly record struct RestartDecision(bool Restart, string Message);
