using System.IO.Compression;
using System.Net;
using System.Net.Sockets;
using Yoink.Tray.Core;

// Usage: dotnet run -c Release --project apps/windows-tray/tests -- <repository root>
// Needs release/Yoink-Server-win-x64-<version>.zip (npm run package:windows-server)
// and a Linux node on PATH: the supervisor tests run the packaged app with it.
var repository = Path.GetFullPath(args.Length > 0 ? args[0] : "../../..");
var serverZip = Directory.GetFiles(Path.Combine(repository, "release"), "Yoink-Server-win-x64-*.zip").OrderDescending().FirstOrDefault()
    ?? throw new Exception("No release/Yoink-Server-win-x64-*.zip; run npm run package:windows-server first.");
var scratch = Path.Combine(Path.GetTempPath(), "yoink-tray-tests-" + Guid.NewGuid().ToString("N"));
var assertions = 0;
void Check(bool condition, string message) { assertions++; if (!condition) throw new Exception(message); }
async Task ThrowsAsync<T>(Func<Task> action, string message) where T : Exception
{
    try { await action(); } catch (T) { assertions++; return; }
    throw new Exception(message);
}
T Throws<T>(Action action, string message) where T : Exception
{
    try { action(); } catch (T error) { assertions++; return error; }
    throw new Exception(message);
}
string NodeOnPath() => Environment.GetEnvironmentVariable("PATH")!.Split(Path.PathSeparator)
    .Select(folder => Path.Combine(folder, "node")).FirstOrDefault(File.Exists) ?? throw new Exception("node is not on PATH.");
int FreePort() { var l = new TcpListener(IPAddress.Loopback, 0); l.Start(); var p = ((IPEndPoint)l.LocalEndpoint).Port; l.Stop(); return p; }
async Task<bool> Eventually(Func<Task<bool>> condition, TimeSpan within)
{
    var until = DateTime.UtcNow + within;
    while (DateTime.UtcNow < until) { if (await condition()) return true; await Task.Delay(200); }
    return false;
}

try
{
    // Settings: defaults, round trip, validation, and a damaged file kept aside.
    var paths = new YoinkPaths(Path.Combine(scratch, "home"));
    var defaults = TraySettings.Load(paths);
    Check(defaults.Port == 32991 && defaults.StartServerOnLaunch && defaults.ActiveServerVersion == "", "Missing settings mean the defaults.");
    Check(defaults.ResolvedDataDirectory(paths) == Path.Combine(paths.Root, "data"), "The default data folder sits under the Yoink root.");
    var edited = defaults with { Port = 40001, StartWithWindows = true, ActiveServerVersion = "1.28.4" };
    edited.Save(paths);
    Check(TraySettings.Load(paths) == edited, "Saved settings load back unchanged.");
    Check((defaults with { Port = 80 }).Problems().Count == 1, "Ports below 1024 are refused.");
    Check((defaults with { DataDirectory = "relative/data" }).Problems().Count == 1, "A relative data folder is refused.");
    Throws<InvalidDataException>(() => (defaults with { ActiveServerVersion = "../x" }).Save(paths), "An unsafe version is never saved.");
    File.WriteAllText(paths.SettingsFile, "{ not json");
    var reported = "";
    Check(TraySettings.Load(paths, message => reported = message) == new TraySettings(), "A damaged settings file falls back to defaults.");
    Check(File.Exists(paths.SettingsFile + ".bad") && reported.Contains(".bad"), "A damaged settings file is kept aside and reported.");

    // Versions become folder names and sort numerically.
    Check(ServerVersion.Compare("1.28.10", "1.28.9") > 0 && ServerVersion.Compare("1.28.4", "1.28.4") == 0, "Versions sort by number.");
    Check(!ServerVersion.IsSafe("..") && !ServerVersion.IsSafe("1.2/3") && !ServerVersion.IsSafe("") && ServerVersion.IsSafe("1.28.4-rc.1"), "Only plain versions are folder names.");

    // Manifest: the real package's manifest parses; unsafe or foreign manifests do not.
    string realManifest;
    using (var archive = ZipFile.OpenRead(serverZip))
    using (var reader = new StreamReader(archive.GetEntry(ServerManifest.FileName)!.Open()))
        realManifest = reader.ReadToEnd();
    var manifest = ServerManifest.Parse(realManifest);
    Check(manifest.NodePath == "node/node.exe" && manifest.WorkingDirectory == "app" && manifest.Entry == "dist/apps/api/src/server.js", "The package manifest names node, app and entry.");
    Check(manifest.Environment["YOINK_CONTROL_STDIN"] == "1" && manifest.NonRetryableExitCode == 78 && manifest.HealthPath == "/api/v1/health", "The manifest carries the stop protocol, exit code and health path.");
    Throws<InvalidDataException>(() => ServerManifest.Parse(realManifest.Replace("\"dist/apps/api/src/server.js\"", "\"../../evil.js\"")), "A path out of the package is refused.");
    Throws<InvalidDataException>(() => ServerManifest.Parse(realManifest.Replace("\"win-x64\"", "\"linux-x64\"")), "A package for another platform is refused.");
    Throws<InvalidDataException>(() => ServerManifest.Parse(realManifest.Replace("\"schemaVersion\": 1", "\"schemaVersion\": 2")), "A newer package format asks for a newer tray app.");

    // Installer: the real package, a release ZIP wrapping it, reinstall, hostile and incomplete ZIPs, pruning.
    var installer = new ServerPackageInstaller(paths);
    var installed = installer.Install(serverZip);
    var serverDirectory = paths.ServerDirectory(installed.Version);
    Check(File.Exists(Path.Combine(serverDirectory, "node", "node.exe")) && File.Exists(Path.Combine(serverDirectory, "app", "dist", "apps", "api", "src", "server.js")), "The package is installed under server\\<version>.");
    Check(installer.InstalledVersions().SequenceEqual([installed.Version]), "The installed version is listed.");
    var releaseZip = Path.Combine(scratch, "Yoink-win-x64.zip");
    using (var release = ZipFile.Open(releaseZip, ZipArchiveMode.Create))
    {
        release.CreateEntry("Yoink.exe").Open().Dispose();
        release.CreateEntryFromFile(serverZip, Path.GetFileName(serverZip));
    }
    var marker = Path.Combine(serverDirectory, "stale-file");
    File.WriteAllText(marker, "from the previous copy");
    Check(installer.Install(releaseZip).Version == installed.Version, "A release ZIP installs the server package inside it.");
    Check(!File.Exists(marker), "Reinstalling a version replaces its folder rather than merging into it.");
    var hostile = Path.Combine(scratch, "hostile.zip");
    using (var zip = ZipFile.Open(hostile, ZipArchiveMode.Create))
    {
        using (var writer = new StreamWriter(zip.CreateEntry(ServerManifest.FileName).Open())) writer.Write(realManifest.Replace("1.28.4", "9.9.9"));
        zip.CreateEntry("../../escaped.txt").Open().Dispose();
    }
    Throws<InvalidDataException>(() => installer.Install(hostile), "A ZIP entry pointing outside the package is refused.");
    Check(!File.Exists(Path.Combine(paths.Root, "escaped.txt")) && !File.Exists(Path.Combine(scratch, "escaped.txt")), "Nothing escapes the staging folder.");
    var incomplete = Path.Combine(scratch, "incomplete.zip");
    using (var zip = ZipFile.Open(incomplete, ZipArchiveMode.Create))
    using (var writer = new StreamWriter(zip.CreateEntry(ServerManifest.FileName).Open())) writer.Write(realManifest.Replace("1.28.4", "9.9.8"));
    Throws<InvalidDataException>(() => installer.Install(incomplete), "A package without node.exe is refused.");
    Check(installer.InstalledVersions().SequenceEqual([installed.Version]), "Refused ZIPs leave no version behind.");
    foreach (var version in new[] { "1.0.0", "1.1.0", "1.2.0" })
    {
        Directory.CreateDirectory(paths.ServerDirectory(version));
        File.WriteAllText(Path.Combine(paths.ServerDirectory(version), ServerManifest.FileName), "{}");
    }
    Directory.CreateDirectory(Path.Combine(paths.ServersDirectory, ".installing-leftover"));
    installer.Prune("1.0.0");
    Check(installer.InstalledVersions().SequenceEqual([installed.Version, "1.2.0", "1.0.0"]), "Pruning keeps the active version and the two newest others.");
    Check(!Directory.Exists(Path.Combine(paths.ServersDirectory, ".installing-leftover")), "Pruning removes interrupted installs.");

    // Restart policy: clean exits and exit 78 are final; a crash burst stops retrying; the window slides.
    var policy = new RestartPolicy(burst: 2, window: TimeSpan.FromMinutes(10));
    var t0 = DateTimeOffset.Parse("2026-09-29T12:00:00Z");
    Check(!policy.Decide(0, t0).Restart && !policy.Decide(78, t0).Restart, "Exit 0 and exit 78 are never retried.");
    Check(policy.Decide(1, t0).Restart && policy.Decide(1, t0.AddMinutes(1)).Restart, "Crashes are retried.");
    Check(!policy.Decide(1, t0.AddMinutes(2)).Restart, "A third crash inside the window is not retried.");
    Check(policy.Decide(1, t0.AddMinutes(12)).Restart, "Crashes outside the window no longer count.");

    // Logs rotate by local date and old days are removed.
    var now = DateTimeOffset.Parse("2026-09-29T08:00:00-07:00");
    var log = new DailyLog(Path.Combine(scratch, "logs"), "server", () => now, retentionDays: 14);
    Directory.CreateDirectory(log.Directory);
    File.WriteAllText(Path.Combine(log.Directory, "server-2026-09-01.log"), "old");
    File.WriteAllText(Path.Combine(log.Directory, "tray-2026-09-01.log"), "other prefix");
    log.Write("first line\n");
    Check(File.ReadAllText(log.PathFor(now)).EndsWith("first line" + Environment.NewLine), "Lines are written with one newline.");
    Check(!File.Exists(Path.Combine(log.Directory, "server-2026-09-01.log")) && File.Exists(Path.Combine(log.Directory, "tray-2026-09-01.log")), "Only this log's old days are removed.");

    // Health readings.
    Check(HealthProbe.Interpret(200, "{\"status\":\"ready\",\"version\":\"1.28.4\",\"reasons\":[]}") == new HealthReading(ServerHealth.Ready, "1.28.4", "Running."), "200 is ready.");
    var degraded = HealthProbe.Interpret(503, "{\"version\":\"1.28.4\",\"reasons\":[\"disk_low\",\"something_new\"]}");
    Check(degraded.Health == ServerHealth.Degraded && degraded.Summary == "the disk is too full for the next backup; something_new", "503 reasons are put in words, unknown codes kept.");
    Check(HealthProbe.Interpret(200, "<html>").Health == ServerHealth.Unreachable, "A non-Yoink answer on the port is not Yoink.");

    // Supervisor: the packaged server (run with this machine's node) starts, reports ready, and stops cleanly over stdin.
    var node = NodeOnPath();
    var appDirectory = Path.Combine(serverDirectory, "app");
    var dataDirectory = Path.Combine(scratch, "data");
    var port = FreePort();
    var linuxLaunch = ServerLaunch.FromPackage(serverDirectory, installed, port, dataDirectory) with { Executable = node };
    Check(linuxLaunch.WorkingDirectory == appDirectory && linuxLaunch.Environment["YOINK_DATA_DIR"] == dataDirectory && linuxLaunch.Environment["YOINK_PORT"] == port.ToString(), "The launch carries the port and data folder.");
    var serverLog = new DailyLog(Path.Combine(scratch, "server-logs"), "server");
    using var http = HealthProbe.CreateClient();
    var probe = new HealthProbe(http);
    using (var supervisor = new ServerSupervisor(serverLog, new RestartPolicy()))
    {
        supervisor.Start(linuxLaunch);
        Check(await Eventually(async () => (await probe.ReadAsync(port, installed.HealthPath)).Health == ServerHealth.Ready, TimeSpan.FromSeconds(90)), "The packaged server becomes ready.");
        Check(File.Exists(Path.Combine(dataDirectory, "yoink.lock")), "The running server holds its data-folder lock.");
        await supervisor.StopAsync();
        Check(supervisor.State == ServerProcessState.Stopped && supervisor.LastExitCode == 0 && supervisor.LastProblem == "", "A requested stop exits 0 with no problem.");
        Check(!File.Exists(Path.Combine(dataDirectory, "yoink.lock")), "A clean stop releases the lock.");
        Check(File.ReadAllText(serverLog.CurrentPath).Contains("Yoink stopped (CONTROL_STOP)."), "The server log shows the stdin stop.");
    }

    // A port already taken ends with exit 78, no restart, and the server's own explanation.
    var blocker = new TcpListener(IPAddress.Loopback, port);
    blocker.Start();
    try
    {
        using var supervisor = new ServerSupervisor(serverLog, new RestartPolicy(delay: TimeSpan.FromMilliseconds(100)));
        supervisor.Start(linuxLaunch);
        Check(await Eventually(() => Task.FromResult(supervisor.State == ServerProcessState.Stopped), TimeSpan.FromSeconds(30)), "A blocked port stops the server.");
        await Task.Delay(500);
        Check(supervisor.State == ServerProcessState.Stopped && supervisor.LastExitCode == 78, "Exit 78 is not restarted.");
        Check(supervisor.LastProblem.Contains("Yoink could not start (port)"), $"The problem quotes the server: {supervisor.LastProblem}");
    }
    finally
    {
        blocker.Stop();
    }

    // Data move: export the server's data with scripts/export-data.mjs, import it over an existing folder, and run on it.
    var exportZip = Path.Combine(scratch, "Yoink-Data-test.zip");
    var exporter = System.Diagnostics.Process.Start(new System.Diagnostics.ProcessStartInfo(node)
    {
        ArgumentList = { Path.Combine(repository, "scripts", "export-data.mjs"), $"--data-dir={dataDirectory}", $"--out={exportZip}" },
        Environment = { ["NODE_OPTIONS"] = "--disable-warning=ExperimentalWarning" },
        RedirectStandardOutput = true
    })!;
    exporter.WaitForExit();
    Check(exporter.ExitCode == 0 && File.Exists(exportZip), "The export script writes a data ZIP.");
    using (var archive = ZipFile.OpenRead(exportZip))
    {
        var info = DataImporter.ReadInfo(archive);
        Check(info.YoinkVersion == installed.Version && info.DatabaseSchema > 0 && !info.ServiceWasRunning, "The export describes its version and schema.");
        Check(archive.GetEntry("yoink.lock") is null && archive.GetEntry("yoink.sqlite-wal") is null, "Locks and WAL files do not travel.");
    }
    Throws<InvalidDataException>(() => DataImporter.Import(serverZip, Path.Combine(scratch, "wrong"), DateTimeOffset.Now), "A server package is not a data export.");
    Check(!Directory.Exists(Path.Combine(scratch, "wrong")), "A refused import creates no data folder.");
    var importedData = Path.Combine(scratch, "pc-data");
    Directory.CreateDirectory(importedData);
    File.WriteAllText(Path.Combine(importedData, "yoink.sqlite"), "the PC's own earlier database");
    var imported = DataImporter.Import(exportZip, importedData, DateTimeOffset.Parse("2026-09-29T10:00:00-07:00"));
    Check(imported.PreviousDataSetAside.EndsWith("pc-data.before-import-20260929-100000") && File.ReadAllText(Path.Combine(imported.PreviousDataSetAside, "yoink.sqlite")) == "the PC's own earlier database", "The existing data folder is kept aside, not deleted.");
    Check(DataImporter.HasDatabase(importedData) && !File.Exists(Path.Combine(importedData, DataImporter.ManifestFile)), "The export is in place without its manifest.");
    Check(Directory.GetDirectories(scratch, "pc-data.importing-*").Length == 0, "No staging folder is left behind.");
    using (var supervisor = new ServerSupervisor(serverLog, new RestartPolicy()))
    {
        supervisor.Start(linuxLaunch with { Environment = new Dictionary<string, string>(linuxLaunch.Environment) { ["YOINK_DATA_DIR"] = importedData } });
        Check(await Eventually(async () => (await probe.ReadAsync(port, installed.HealthPath)).Health == ServerHealth.Ready, TimeSpan.FromSeconds(90)), "The server runs on the imported data.");
        await supervisor.StopAsync();
        Check(supervisor.LastExitCode == 0, "It stops cleanly after the import.");
    }

    // Crashes are restarted until the burst is spent.
    var crashes = 0;
    using (var supervisor = new ServerSupervisor(serverLog, new RestartPolicy(burst: 2, delay: TimeSpan.FromMilliseconds(100))))
    {
        supervisor.Changed += () => { if (supervisor.LastExitCode == 3) Interlocked.Increment(ref crashes); };
        supervisor.Start(new ServerLaunch(node, ["-e", "console.error('boom'); process.exit(3)"], scratch, new Dictionary<string, string>()));
        Check(await Eventually(() => Task.FromResult(supervisor.LastProblem.Length > 0), TimeSpan.FromSeconds(30)), "A crash loop ends in a problem.");
        Check(supervisor.LastProblem.Contains("2 times") && supervisor.LastProblem.Contains("boom"), $"The problem names the loop and the last error: {supervisor.LastProblem}");
        Check(crashes >= 3, $"Two restarts followed the first crash ({crashes} exits seen).");
    }

    // Depot: a release signed by scripts/publish-release.mjs, served by scripts/depot-server.mjs,
    // is verified, downloaded and checksummed by the tray; tampering and foreign keys are refused.
    var depotRoot = Path.Combine(scratch, "depot");
    var depotPort = FreePort();
    var releaseZip2 = Path.Combine(depotRoot, "releases", "Yoink-win-x64-9.9.9.zip");
    Directory.CreateDirectory(Path.GetDirectoryName(releaseZip2)!);
    File.Copy(releaseZip, releaseZip2);
    string RunNode(string script, IDictionary<string, string>? env = null)
    {
        var info = new System.Diagnostics.ProcessStartInfo(node) { RedirectStandardOutput = true, RedirectStandardError = true, WorkingDirectory = repository };
        info.ArgumentList.Add("--input-type=module");
        info.ArgumentList.Add("-e");
        info.ArgumentList.Add(script);
        foreach (var (k, v) in env ?? new Dictionary<string, string>()) info.Environment[k] = v;
        using var p = System.Diagnostics.Process.Start(info)!;
        var output = p.StandardOutput.ReadToEnd();
        var error = p.StandardError.ReadToEnd();
        p.WaitForExit();
        if (p.ExitCode != 0) throw new Exception($"node failed: {error}");
        return output.Trim();
    }
    var keyFile = Path.Combine(scratch, "release-key.pem");
    var publicKey = RunNode($$"""
        import { createHash } from "node:crypto";
        import { readFileSync, writeFileSync } from "node:fs";
        import { releaseSigningKey, publicKeyText, renderManifest, signManifest } from "./scripts/publish-release.mjs";
        const key = releaseSigningKey({{System.Text.Json.JsonSerializer.Serialize(keyFile)}});
        const zip = {{System.Text.Json.JsonSerializer.Serialize(releaseZip2)}};
        const bytes = readFileSync(zip);
        const manifest = renderManifest({ version: "9.9.9", file: "Yoink-win-x64-9.9.9.zip", sha256: createHash("sha256").update(bytes).digest("hex"), size: bytes.length, commit: "test" });
        writeFileSync({{System.Text.Json.JsonSerializer.Serialize(Path.Combine(depotRoot, "releases", "latest.json"))}}, manifest);
        writeFileSync({{System.Text.Json.JsonSerializer.Serialize(Path.Combine(depotRoot, "releases", "latest.sig"))}}, signManifest(manifest, key) + "\n");
        console.log(publicKeyText(key));
        """);
    var depotProcess = System.Diagnostics.Process.Start(new System.Diagnostics.ProcessStartInfo(node)
    {
        ArgumentList = { Path.Combine(repository, "scripts", "depot-server.mjs") },
        Environment = { ["YOINK_DEPOT_ROOT"] = depotRoot, ["YOINK_DEPOT_HOST"] = "127.0.0.1", ["YOINK_DEPOT_PORT"] = depotPort.ToString() },
        RedirectStandardOutput = true
    })!;
    try
    {
        var depotUrl = $"http://127.0.0.1:{depotPort}";
        Check(await Eventually(async () => { try { return (await http.GetAsync($"{depotUrl}/v1/health")).IsSuccessStatusCode; } catch (HttpRequestException) { return false; } }, TimeSpan.FromSeconds(20)), "The depot starts.");
        var token = File.ReadAllText(Path.Combine(depotRoot, "depot-token")).Trim();
        var trayPaths = new YoinkPaths(Path.Combine(scratch, "tray-home"));
        Directory.CreateDirectory(trayPaths.Root);
        File.WriteAllText(trayPaths.DepotConfigFile, System.Text.Json.JsonSerializer.Serialize(new { url = depotUrl + "/", token, device = "Red PC!" }));
        var config = DepotConfig.Load(trayPaths)!;
        Check(config.Url == depotUrl && config.Device == "RedPC", "depot.json loads with a trimmed URL and a header-safe device name.");
        using var depotHttp = new HttpClient();
        var client = new DepotClient(depotHttp, config, publicKey);
        var latest = await client.LatestAsync();
        Check(latest is not null && latest.Version == "9.9.9" && latest.File == "Yoink-win-x64-9.9.9.zip", "The signed manifest verifies with the pinned key.");
        var downloaded = await client.DownloadAsync(latest!, trayPaths.UpdatesDirectory);
        Check(new FileInfo(downloaded).Length == new FileInfo(releaseZip2).Length, "The release downloads whole.");
        Check(new ServerPackageInstaller(trayPaths).Install(downloaded).Version == installed.Version, "The downloaded release installs its server package.");

        var otherKey = RunNode($$"""
            import { releaseSigningKey, publicKeyText } from "./scripts/publish-release.mjs";
            console.log(publicKeyText(releaseSigningKey({{System.Text.Json.JsonSerializer.Serialize(Path.Combine(scratch, "other-key.pem"))}})));
            """);
        await ThrowsAsync<InvalidDataException>(() => new DepotClient(depotHttp, config, otherKey).LatestAsync(), "A release signed by another key is refused.");
        var manifestPath = Path.Combine(depotRoot, "releases", "latest.json");
        var original = File.ReadAllText(manifestPath);
        File.WriteAllText(manifestPath, original.Replace("9.9.9", "9.9.10"));
        await ThrowsAsync<InvalidDataException>(() => client.LatestAsync(), "An edited manifest no longer matches its signature.");
        File.WriteAllText(manifestPath, original);
        File.AppendAllText(releaseZip2, "tampered");
        await ThrowsAsync<InvalidDataException>(() => client.DownloadAsync(latest!, Path.Combine(scratch, "dl2")), "A changed ZIP fails its signed checksum.");
        Check(!Directory.GetFiles(Path.Combine(scratch, "dl2")).Any(), "A refused download leaves nothing behind.");
        var unauthorized = new DepotClient(depotHttp, config with { Token = new string('x', 43) }, publicKey);
        await ThrowsAsync<HttpRequestException>(() => unauthorized.LatestAsync(), "A wrong token is refused.");

        // Companion: installed from the server package into one folder, updated in place.
        var companionInstaller = new CompanionInstaller(trayPaths);
        var companionZip = CompanionInstaller.PackagedZip(trayPaths.ServerDirectory(installed.Version), installed.Version);
        Check(companionZip is not null, "The server package carries its companion.");
        Check(companionInstaller.Install(companionZip!), "The first companion install asks for Load unpacked.");
        Check(companionInstaller.InstalledVersion() == installed.Version, "The folder holds the server's companion version.");
        File.WriteAllText(Path.Combine(companionInstaller.Directory, "obsolete.js"), "old");
        Directory.CreateDirectory(Path.Combine(companionInstaller.Directory, "_metadata"));
        File.WriteAllText(Path.Combine(companionInstaller.Directory, "_metadata", "verified_contents.json"), "{}");
        Check(!companionInstaller.Install(companionZip!), "A later install is an in-place update.");
        Check(!File.Exists(Path.Combine(companionInstaller.Directory, "obsolete.js")), "Files the new companion lacks are removed.");
        Check(File.Exists(Path.Combine(companionInstaller.Directory, "_metadata", "verified_contents.json")), "Chrome's _metadata is left alone.");

        // Diagnostics: logs, API reports and unsent store pages go up once; secrets never do.
        var diagData = Path.Combine(scratch, "diag-data");
        Directory.CreateDirectory(Path.Combine(diagData, "evidence", "target"));
        File.WriteAllText(Path.Combine(diagData, "evidence", "index.json"), "{\"items\":[]}");
        File.WriteAllText(Path.Combine(diagData, "evidence", "target", "cap_one.json.gz"), "page");
        File.WriteAllText(Path.Combine(diagData, "yoink.sqlite"), "database");
        File.WriteAllText(Path.Combine(diagData, "observer-recipe-ed25519-private.pem"), "secret");
        new DailyLog(trayPaths.LogsDirectory, "server").Write("server says hello");
        var diagSettings = new TraySettings { Port = FreePort(), DataDirectory = diagData };
        var sentBefore = DiagnosticsBundle.LoadSent(trayPaths);
        var bundle = await DiagnosticsBundle.BuildAsync(trayPaths, diagSettings, http, new Dictionary<string, object?> { ["reason"] = "test" }, sentBefore, DateTimeOffset.Now);
        using (var zip = new ZipArchive(new MemoryStream(bundle.Zip)))
        {
            var names = zip.Entries.Select(entry => entry.FullName).ToList();
            Check(names.Contains("info.json") && names.Any(n => n.StartsWith("logs/server-")) && names.Contains("api/health.json") && names.Contains("evidence/target/cap_one.json.gz"), $"The bundle has info, logs, API reports and store pages: {string.Join(", ", names)}");
            Check(!names.Any(n => n.Contains("sqlite") || n.EndsWith(".pem")), "The database and keys are never included.");
            using var reader = new StreamReader(zip.GetEntry("api/health.json")!.Open());
            Check(reader.ReadToEnd().Contains("unreachable"), "An unreachable server is recorded, not fatal.");
        }
        await client.UploadDiagnosticsAsync(bundle.Zip);
        var stored = Directory.GetFiles(Path.Combine(depotRoot, "diagnostics", "RedPC"), "*.zip");
        Check(stored.Length == 1 && new FileInfo(stored[0]).Length == bundle.Zip.Length, "The depot stores the upload under the device name.");
        foreach (var file in bundle.EvidenceIncluded) sentBefore.Add(file);
        DiagnosticsBundle.SaveSent(trayPaths, sentBefore);
        var again = await DiagnosticsBundle.BuildAsync(trayPaths, diagSettings, http, new Dictionary<string, object?>(), DiagnosticsBundle.LoadSent(trayPaths), DateTimeOffset.Now);
        Check(again.EvidenceIncluded.Count == 0, "A store page is sent only once.");
    }
    finally
    {
        depotProcess.Kill();
        depotProcess.WaitForExit();
    }

    Console.WriteLine($"Yoink tray tests passed: {assertions} assertions.");
    return 0;
}
catch (Exception error)
{
    Console.Error.WriteLine($"Yoink tray tests FAILED after {assertions} assertions: {error.Message}");
    Console.Error.WriteLine(error.StackTrace);
    return 1;
}
finally
{
    try { Directory.Delete(scratch, recursive: true); } catch (IOException) { }
}
