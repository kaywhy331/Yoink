using System.Diagnostics;
using System.IO.Compression;
using System.Net;
using System.Net.Sockets;
using Microsoft.Win32;
using Yoink.Tray.Core;

namespace Yoink.Tray;

/// <summary>
/// The notification-area app: runs the server, shows whether it is healthy,
/// and holds the settings, logs and update commands. No main window.
/// </summary>
internal sealed partial class TrayApp : ApplicationContext
{
    private readonly YoinkPaths paths;
    private readonly DailyLog trayLog;
    private readonly ServerSupervisor supervisor;
    private readonly ServerPackageInstaller installer;
    private readonly HttpClient http = HealthProbe.CreateClient();
    private readonly HealthProbe probe;
    private readonly SynchronizationContext ui;
    private readonly NotifyIcon icon;
    private readonly System.Windows.Forms.Timer healthTimer = new() { Interval = 5_000 };
    private readonly ToolStripMenuItem statusItem = new() { Enabled = false };
    private readonly ToolStripMenuItem startItem = new("Start");
    private readonly ToolStripMenuItem stopItem = new("Stop");
    private readonly ToolStripMenuItem restartItem = new("Restart");
    private readonly Dictionary<Color, Icon> icons = [];
    private TraySettings settings;
    private ServerManifest? manifest;
    private HealthReading health = new(ServerHealth.Unreachable, "", "");
    private string shownProblem = "";
    private bool busy;
    private bool exiting;

    public TrayApp(YoinkPaths paths, bool startedByWindows)
    {
        this.paths = paths;
        ui = SynchronizationContext.Current ?? new WindowsFormsSynchronizationContext();
        trayLog = new DailyLog(paths.LogsDirectory, "tray");
        supervisor = new ServerSupervisor(new DailyLog(paths.LogsDirectory, "server"), new RestartPolicy());
        installer = new ServerPackageInstaller(paths);
        probe = new HealthProbe(http);
        settings = TraySettings.Load(paths, trayLog.Write);
        trayLog.Write($"[tray] Yoink tray {Application.ProductVersion} started{(startedByWindows ? " at sign-in" : "")}");

        var menu = new ContextMenuStrip();
        menu.Items.Add(statusItem);
        menu.Items.Add(new ToolStripSeparator());
        var open = new ToolStripMenuItem("Open Yoink", null, (_, _) => OpenDashboard(settings.Port)) { Font = new Font(menu.Font, FontStyle.Bold) };
        menu.Items.Add(open);
        menu.Items.Add(new ToolStripSeparator());
        startItem.Click += async (_, _) => await Guard("start Yoink", StartServerAsync);
        stopItem.Click += async (_, _) => await Guard("stop Yoink", supervisor.StopAsync);
        restartItem.Click += async (_, _) => await Guard("restart Yoink", async () => { await supervisor.StopAsync(); await StartServerAsync(); });
        menu.Items.AddRange([startItem, stopItem, restartItem, new ToolStripSeparator()]);
        menu.Items.Add("Settings…", null, async (_, _) => await Guard("save settings", EditSettingsAsync));
        menu.Items.Add("Open logs", null, (_, _) => OpenFolder(paths.LogsDirectory));
        menu.Items.Add(new ToolStripSeparator());
        AddHandsOffMenu(menu, menu.Items.Count);
        menu.Items.Add("Install update from ZIP…", null, async (_, _) => await Guard("install the update", InstallFromZipAsync));
        menu.Items.Add("Import data from ZIP…", null, async (_, _) => await Guard("import the data", () => ImportDataAsync(null)));
        menu.Items.Add(new ToolStripSeparator());
        menu.Items.Add("Exit Yoink", null, async (_, _) => await ExitAsync());

        icon = new NotifyIcon { ContextMenuStrip = menu, Visible = true, Text = "Yoink" };
        icon.DoubleClick += (_, _) => OpenDashboard(settings.Port);
        supervisor.Changed += () => ui.Post(_ => { RefreshStatus(); _ = PollHealthAsync(); }, null);
        healthTimer.Tick += async (_, _) => await PollHealthAsync();
        healthTimer.Start();
        SystemEvents.SessionEnding += OnSessionEnding;
        RefreshStatus();
        _ = Guard("prepare Yoink", () => PrepareAsync(startedByWindows));
    }

    public static void OpenDashboard(int port) =>
        Process.Start(new ProcessStartInfo($"http://127.0.0.1:{port}/") { UseShellExecute = true });

    private static void OpenFolder(string folder)
    {
        Directory.CreateDirectory(folder);
        Process.Start(new ProcessStartInfo(folder) { UseShellExecute = true });
    }

    /// <summary>First run installs the server package shipped next to the tray app; then the server starts if set to.</summary>
    private async Task PrepareAsync(bool startedByWindows)
    {
        var bundled = Directory.GetFiles(AppContext.BaseDirectory, "Yoink-Server-win-x64-*.zip")
            .OrderByDescending(path => path, StringComparer.OrdinalIgnoreCase)
            .FirstOrDefault();
        var installed = installer.InstalledVersions();
        // A bundled package newer than the active server is installed too: that is
        // how extracting a new release over the tray's folder updates Yoink.
        var bundledVersion = bundled is null ? "" : Path.GetFileNameWithoutExtension(bundled)["Yoink-Server-win-x64-".Length..];
        if (bundled is not null && (settings.ActiveServerVersion.Length == 0 || !installed.Contains(settings.ActiveServerVersion)
            || (ServerVersion.IsSafe(bundledVersion) && ServerVersion.Compare(bundledVersion, settings.ActiveServerVersion) > 0)))
        {
            var installedManifest = await Task.Run(() => installer.Install(bundled));
            settings = settings with { ActiveServerVersion = installedManifest.Version };
            settings.Save(paths);
            trayLog.Write($"[tray] installed bundled server {installedManifest.Version}");
        }
        else if (settings.ActiveServerVersion.Length == 0 && installed.Count > 0)
        {
            settings = settings with { ActiveServerVersion = installed[0] };
            settings.Save(paths);
        }
        LoadManifest();
        StartHandsOff();
        // Moving from TrixBot: an export (Yoink-Data.zip or Yoink-Data-<time>.zip) next to Yoink.exe fills an empty data folder once.
        var export = Directory.GetFiles(AppContext.BaseDirectory, "Yoink-Data*.zip")
            .OrderByDescending(path => path, StringComparer.OrdinalIgnoreCase)
            .FirstOrDefault();
        if (export is not null && !DataImporter.HasDatabase(settings.ResolvedDataDirectory(paths)))
        {
            await ImportDataAsync(export);
            return;
        }
        if (settings.StartServerOnLaunch && manifest is not null) await StartServerAsync();
        else if (!startedByWindows && manifest is null)
            Notify("Yoink has no server installed", "Choose Install update from ZIP… and pick a Yoink Windows ZIP.", ToolTipIcon.Warning);
    }

    private void LoadManifest()
    {
        manifest = settings.ActiveServerVersion.Length > 0 && Directory.Exists(paths.ServerDirectory(settings.ActiveServerVersion))
            ? ServerManifest.Load(paths.ServerDirectory(settings.ActiveServerVersion))
            : null;
    }

    private async Task StartServerAsync()
    {
        if (manifest is null) throw new InvalidOperationException("No server is installed. Choose Install update from ZIP… first.");
        if (supervisor.State != ServerProcessState.Stopped) return;
        if (!PortIsFree(settings.Port))
        {
            throw new InvalidOperationException(
                $"Port {settings.Port} is already in use by another program. If an SSH tunnel to TrixBot is still open (ssh -L {settings.Port}:…), close it, then choose Start.");
        }
        var dataDirectory = settings.ResolvedDataDirectory(paths);
        Directory.CreateDirectory(dataDirectory);
        var launch = ServerLaunch.FromPackage(paths.ServerDirectory(manifest.Version), manifest, settings.Port, dataDirectory);
        await Task.Run(() => supervisor.Start(launch));
        installer.Prune(manifest.Version);
    }

    private static bool PortIsFree(int port)
    {
        try
        {
            var listener = new TcpListener(IPAddress.Loopback, port) { ExclusiveAddressUse = true };
            listener.Start();
            listener.Stop();
            return true;
        }
        catch (SocketException)
        {
            return false;
        }
    }

    private async Task EditSettingsAsync()
    {
        using var form = new SettingsForm(settings, paths);
        if (form.ShowDialog() != DialogResult.OK) return;
        var previous = settings;
        settings = form.Result;
        settings.Save(paths);
        StartupRegistration.Apply(settings.StartWithWindows);
        var needsRestart = previous.Port != settings.Port
            || !string.Equals(previous.ResolvedDataDirectory(paths), settings.ResolvedDataDirectory(paths), StringComparison.OrdinalIgnoreCase);
        if (needsRestart && supervisor.State == ServerProcessState.Running)
        {
            await supervisor.StopAsync();
            await StartServerAsync();
        }
    }

    private async Task InstallFromZipAsync()
    {
        using var dialog = new OpenFileDialog { Filter = "Yoink Windows ZIP (*.zip)|*.zip", Title = "Install a Yoink update" };
        if (dialog.ShowDialog() != DialogResult.OK) return;
        var wasRunning = supervisor.State != ServerProcessState.Stopped;
        await supervisor.StopAsync();
        ServerManifest installed;
        try
        {
            installed = await Task.Run(() => installer.Install(dialog.FileName));
        }
        catch
        {
            // A rejected ZIP changed nothing installed; bring the old server back.
            if (wasRunning) await StartServerAsync();
            throw;
        }
        if (manifest is not null && ServerVersion.Compare(installed.Version, manifest.Version) < 0)
        {
            var answer = MessageBox.Show(
                $"This ZIP holds Yoink {installed.Version}, older than the running {manifest.Version}. An older server may refuse a database a newer one already upgraded. Switch to {installed.Version} anyway?",
                "Install an older Yoink?", MessageBoxButtons.YesNo, MessageBoxIcon.Warning, MessageBoxDefaultButton.Button2);
            if (answer != DialogResult.Yes)
            {
                if (wasRunning) await StartServerAsync();
                return;
            }
        }
        settings = settings with { ActiveServerVersion = installed.Version };
        settings.Save(paths);
        LoadManifest();
        trayLog.Write($"[tray] installed server {installed.Version} from {dialog.FileName}");
        Notify("Yoink updated", $"Yoink {installed.Version} is installed{(wasRunning ? " and starting" : "")}.", ToolTipIcon.Info);
        if (wasRunning) await StartServerAsync();
    }

    /// <summary>
    /// Replaces the data folder with an export. With a chosen file the person
    /// confirms first; the old folder is always kept aside, never deleted.
    /// </summary>
    private async Task ImportDataAsync(string? zipPath)
    {
        var automatic = zipPath is not null;
        if (zipPath is null)
        {
            using var dialog = new OpenFileDialog { Filter = "Yoink data export (Yoink-Data-*.zip)|*.zip", Title = "Import Yoink data" };
            if (dialog.ShowDialog() != DialogResult.OK) return;
            zipPath = dialog.FileName;
        }
        DataExportInfo info;
        using (var archive = ZipFile.OpenRead(zipPath)) info = DataImporter.ReadInfo(archive);
        var dataDirectory = settings.ResolvedDataDirectory(paths);
        if (manifest is not null && ServerVersion.Compare(info.YoinkVersion, manifest.Version) > 0)
        {
            throw new InvalidOperationException(
                $"This export is from Yoink {info.YoinkVersion}, newer than the installed {manifest.Version}. Install Yoink {info.YoinkVersion} or newer first (Install update from ZIP…), then import again.");
        }
        if (!automatic)
        {
            var replacing = DataImporter.HasDatabase(dataDirectory)
                ? $"{Environment.NewLine}{Environment.NewLine}The current data in {dataDirectory} is kept as a copy beside it, not deleted."
                : "";
            var answer = MessageBox.Show(
                $"Import the data exported from {info.ExportedFrom} at {info.ExportedAt} (Yoink {info.YoinkVersion})?{replacing}{Environment.NewLine}{Environment.NewLine}Yoink stops during the import and starts again after it.",
                "Import Yoink data", MessageBoxButtons.OKCancel, MessageBoxIcon.Question, MessageBoxDefaultButton.Button2);
            if (answer != DialogResult.OK) return;
        }
        var wasRunning = supervisor.State != ServerProcessState.Stopped;
        await supervisor.StopAsync();
        var result = await Task.Run(() => DataImporter.Import(zipPath, dataDirectory, DateTimeOffset.Now));
        trayLog.Write($"[tray] imported data from {zipPath} ({info.ExportedFrom}, {info.ExportedAt}){(result.PreviousDataSetAside.Length > 0 ? $"; previous data kept at {result.PreviousDataSetAside}" : "")}");
        Notify("Yoink data imported",
            $"Data from {info.ExportedFrom} is in place{(info.ServiceWasRunning ? " (exported while it was still running)" : "")}. Delete the export ZIP now: it holds keys.",
            ToolTipIcon.Info);
        if (manifest is not null && (wasRunning || settings.StartServerOnLaunch)) await StartServerAsync();
    }

    private async Task PollHealthAsync()
    {
        if (exiting) return;
        health = supervisor.State == ServerProcessState.Running
            ? await probe.ReadAsync(settings.Port, manifest?.HealthPath ?? "/api/v1/health")
            : new HealthReading(ServerHealth.Unreachable, "", "");
        RefreshStatus();
        await WatchdogAsync();
    }

    private void RefreshStatus()
    {
        if (exiting) return;
        var (text, colour, problem) = supervisor.State switch
        {
            ServerProcessState.Stopping => ("Stopping…", TrayIcons.Starting, ""),
            ServerProcessState.Stopped when supervisor.LastProblem.Length > 0 => ("Stopped: needs attention", TrayIcons.Problem, supervisor.LastProblem),
            ServerProcessState.Stopped => (manifest is null ? "No server installed" : "Stopped", TrayIcons.Stopped, ""),
            _ when health.Health == ServerHealth.Ready => ($"Running · {health.Version}", TrayIcons.Running, ""),
            _ when health.Health == ServerHealth.Degraded => ("Running, not ready", TrayIcons.Problem, $"Yoink is not ready: {health.Summary}."),
            _ => ("Starting…", TrayIcons.Starting, "")
        };
        statusItem.Text = $"Yoink: {text}";
        var tooltip = $"Yoink: {text}";
        icon.Text = tooltip.Length > 63 ? tooltip[..63] : tooltip;
        if (!icons.TryGetValue(colour, out var image)) icons[colour] = image = TrayIcons.Create(colour);
        icon.Icon = image;
        var stopped = supervisor.State == ServerProcessState.Stopped;
        startItem.Enabled = !busy && stopped && manifest is not null;
        stopItem.Enabled = !busy && supervisor.State == ServerProcessState.Running;
        restartItem.Enabled = !busy && supervisor.State == ServerProcessState.Running;
        if (problem.Length > 0 && problem != shownProblem)
        {
            Notify("Yoink needs attention", problem, ToolTipIcon.Warning);
            _ = SendDiagnosticsAsync("problem", manual: false);
        }
        shownProblem = problem;
    }

    private void Notify(string title, string text, ToolTipIcon kind)
    {
        trayLog.Write($"[tray] {title}: {text}");
        icon.ShowBalloonTip(10_000, title, text.Length > 250 ? text[..250] + "…" : text, kind);
    }

    /// <summary>Runs a menu command with the menu disabled, and turns any failure into a visible message.</summary>
    private async Task Guard(string action, Func<Task> command)
    {
        if (busy) return;
        busy = true;
        RefreshStatus();
        try
        {
            await command();
        }
        catch (Exception error)
        {
            trayLog.Write($"[tray] could not {action}: {error}");
            MessageBox.Show(error.Message, $"Yoink could not {action}", MessageBoxButtons.OK, MessageBoxIcon.Warning);
        }
        finally
        {
            busy = false;
            RefreshStatus();
        }
    }

    private void OnSessionEnding(object? sender, SessionEndingEventArgs e)
    {
        // Sign-out or shutdown: stop cleanly while Windows still waits for us.
        exiting = true;
        supervisor.StopAsync().GetAwaiter().GetResult();
    }

    private async Task ExitAsync()
    {
        exiting = true;
        healthTimer.Stop();
        icon.Text = "Yoink: stopping…";
        await supervisor.StopAsync();
        ExitThread();
    }

    protected override void Dispose(bool disposing)
    {
        if (disposing)
        {
            SystemEvents.SessionEnding -= OnSessionEnding;
            healthTimer.Dispose();
            updateTimer.Dispose();
            diagnosticsTimer.Dispose();
            icon.Visible = false;
            icon.Dispose();
            foreach (var image in icons.Values) image.Dispose();
            supervisor.Dispose();
            http.Dispose();
        }
        base.Dispose(disposing);
    }
}
