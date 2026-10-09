using System.Diagnostics;

namespace Yoink.Tray.Core;

public enum ServerProcessState { Stopped, Running, Stopping }

/// <summary>What to run: resolved from the active package's manifest and the tray settings.</summary>
public sealed record ServerLaunch(
    string Executable,
    IReadOnlyList<string> Arguments,
    string WorkingDirectory,
    IReadOnlyDictionary<string, string> Environment)
{
    public static ServerLaunch FromPackage(string packageDirectory, ServerManifest manifest, int port, string dataDirectory)
    {
        static string Local(string root, string relative) => Path.Combine(root, relative.Replace('/', Path.DirectorySeparatorChar));
        var environment = new Dictionary<string, string>(manifest.Environment, StringComparer.OrdinalIgnoreCase)
        {
            ["YOINK_PORT"] = port.ToString(System.Globalization.CultureInfo.InvariantCulture),
            ["YOINK_DATA_DIR"] = dataDirectory,
            // The stop protocol is the tray app's, whatever an older manifest says.
            ["YOINK_CONTROL_STDIN"] = "1"
        };
        return new ServerLaunch(
            Local(packageDirectory, manifest.NodePath),
            [manifest.Entry],
            Local(packageDirectory, manifest.WorkingDirectory),
            environment);
    }
}

/// <summary>
/// Runs the server as a child process with no console window, copies its
/// output to the server log, and stops it the clean way: the line `stop` on
/// stdin (the server closes the database and releases its lock), then a kill
/// only if it has not exited in time. If the tray app itself dies, the pipe
/// closes and the server stops on its own.
/// </summary>
public sealed class ServerSupervisor(DailyLog log, RestartPolicy policy) : IDisposable
{
    private readonly object gate = new();
    private readonly Queue<string> recentErrors = new();
    private Process? process;
    private ServerLaunch? lastLaunch;
    private bool stopRequested;
    private CancellationTokenSource? pendingRestart;

    public ServerProcessState State { get; private set; } = ServerProcessState.Stopped;
    /// <summary>When the current process started; the watchdog gives a fresh start time to become healthy.</summary>
    public DateTimeOffset StartedAt { get; private set; }
    public int? LastExitCode { get; private set; }
    /// <summary>Why the server is not running, when it stopped on its own; empty otherwise.</summary>
    public string LastProblem { get; private set; } = "";
    public TimeSpan StopTimeout { get; init; } = TimeSpan.FromSeconds(15);

    /// <summary>Raised on a thread-pool thread whenever State, LastExitCode or LastProblem changes.</summary>
    public event Action? Changed;

    /// <summary>The newest "Yoink could not start …" style lines from stderr, oldest first.</summary>
    public IReadOnlyList<string> RecentErrors
    {
        get { lock (gate) return recentErrors.ToList(); }
    }

    public void Start(ServerLaunch launch)
    {
        lock (gate)
        {
            if (process is not null) throw new InvalidOperationException("Yoink is already running.");
            pendingRestart?.Cancel();
            pendingRestart = null;
            policy.Reset();
            StartLocked(launch);
        }
        Changed?.Invoke();
    }

    private void StartLocked(ServerLaunch launch)
    {
        if (!File.Exists(launch.Executable)) throw new FileNotFoundException($"The server's Node runtime is missing: {launch.Executable}. Reinstall the server package.");
        var info = new ProcessStartInfo(launch.Executable)
        {
            WorkingDirectory = launch.WorkingDirectory,
            UseShellExecute = false,
            CreateNoWindow = true,
            RedirectStandardInput = true,
            RedirectStandardOutput = true,
            RedirectStandardError = true,
            StandardOutputEncoding = System.Text.Encoding.UTF8,
            StandardErrorEncoding = System.Text.Encoding.UTF8
        };
        foreach (var argument in launch.Arguments) info.ArgumentList.Add(argument);
        foreach (var (name, value) in launch.Environment) info.Environment[name] = value;
        var child = new Process { StartInfo = info, EnableRaisingEvents = true };
        child.OutputDataReceived += (_, line) => { if (line.Data is not null) log.Write(line.Data); };
        child.ErrorDataReceived += (_, line) =>
        {
            if (line.Data is null) return;
            log.Write($"[stderr] {line.Data}");
            lock (gate)
            {
                recentErrors.Enqueue(line.Data);
                while (recentErrors.Count > 20) recentErrors.Dequeue();
            }
        };
        child.Exited += (_, _) => OnExited(child);
        lock (gate) recentErrors.Clear();
        log.Write($"[tray] starting {launch.Executable} {string.Join(' ', launch.Arguments)} in {launch.WorkingDirectory}");
        child.Start();
        child.BeginOutputReadLine();
        child.BeginErrorReadLine();
        process = child;
        lastLaunch = launch;
        stopRequested = false;
        State = ServerProcessState.Running;
        StartedAt = DateTimeOffset.Now;
        LastExitCode = null;
        LastProblem = "";
    }

    /// <summary>Stops the server and waits for it; safe to call when it is not running.</summary>
    public async Task StopAsync()
    {
        Process? child;
        lock (gate)
        {
            pendingRestart?.Cancel();
            pendingRestart = null;
            child = process;
            if (child is null) return;
            stopRequested = true;
            State = ServerProcessState.Stopping;
        }
        Changed?.Invoke();
        log.Write("[tray] asking Yoink to stop");
        try
        {
            await child.StandardInput.WriteLineAsync("stop");
            await child.StandardInput.FlushAsync();
        }
        catch (Exception error) when (error is IOException or ObjectDisposedException or InvalidOperationException)
        {
            // Already exiting; the wait below settles it.
        }
        using var timeout = new CancellationTokenSource(StopTimeout);
        try
        {
            await child.WaitForExitAsync(timeout.Token);
        }
        catch (OperationCanceledException)
        {
            log.Write($"[tray] Yoink did not stop within {StopTimeout.TotalSeconds:0} s; ending the process");
            try { child.Kill(entireProcessTree: true); } catch (InvalidOperationException) { /* exited meanwhile */ }
            try { await child.WaitForExitAsync(); } catch (InvalidOperationException) { /* released by OnExited */ }
        }
        catch (InvalidOperationException)
        {
            // "No process is associated with this object": the server exited
            // before this wait began and OnExited already released it.
        }
        // Exited may run on another thread just after WaitForExit returns.
        for (var i = 0; i < 50 && State != ServerProcessState.Stopped; i++) await Task.Delay(20);
    }

    private void OnExited(Process child)
    {
        RestartDecision decision;
        ServerLaunch? relaunch = null;
        CancellationTokenSource? restartToken = null;
        // Let the output readers drain the last lines before reporting. Not
        // under the lock: the stderr handler takes it for every line, so
        // waiting inside it could wait forever.
        try { child.WaitForExit(); } catch (InvalidOperationException) { /* reported below as far as known */ }
        lock (gate)
        {
            if (!ReferenceEquals(child, process)) return;
            int exitCode;
            try { exitCode = child.ExitCode; } catch (InvalidOperationException) { exitCode = -1; }
            child.Dispose();
            process = null;
            LastExitCode = exitCode;
            State = ServerProcessState.Stopped;
            if (stopRequested)
            {
                decision = new(false, "");
                LastProblem = exitCode == 0 ? "" : $"Yoink stopped with exit code {exitCode}.";
            }
            else
            {
                decision = policy.Decide(exitCode, DateTimeOffset.Now);
                var detail = recentErrors.LastOrDefault(line => line.StartsWith("Yoink could not start", StringComparison.Ordinal))
                    ?? recentErrors.LastOrDefault() ?? "";
                LastProblem = decision.Restart ? "" : string.IsNullOrEmpty(detail) ? decision.Message : $"{decision.Message} {detail}";
                if (decision.Restart && lastLaunch is not null)
                {
                    relaunch = lastLaunch;
                    restartToken = pendingRestart = new CancellationTokenSource();
                }
            }
            log.Write($"[tray] Yoink exited with code {exitCode}{(decision.Message.Length > 0 ? $": {decision.Message}" : "")}");
        }
        Changed?.Invoke();
        if (relaunch is not null && restartToken is not null) _ = RestartLater(relaunch, restartToken.Token);
    }

    private async Task RestartLater(ServerLaunch launch, CancellationToken cancelled)
    {
        try
        {
            await Task.Delay(policy.Delay, cancelled);
            lock (gate)
            {
                if (cancelled.IsCancellationRequested || process is not null) return;
                pendingRestart = null;
                StartLocked(launch);
            }
        }
        catch (OperationCanceledException)
        {
            return;
        }
        catch (Exception error)
        {
            lock (gate) LastProblem = $"Yoink could not be restarted: {error.Message}";
            log.Write($"[tray] restart failed: {error.Message}");
        }
        Changed?.Invoke();
    }

    public void Dispose()
    {
        pendingRestart?.Cancel();
        StopAsync().GetAwaiter().GetResult();
    }
}
