using System.Net.Http.Headers;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;

namespace Yoink.Tray.Core;

/// <summary>Where the development workstation's depot is, from depot.json (shipped in the release ZIP).</summary>
public sealed record DepotConfig(string Url, string Token, string Device)
{
    public static DepotConfig? Load(YoinkPaths paths)
    {
        if (!File.Exists(paths.DepotConfigFile)) return null;
        try
        {
            using var document = JsonDocument.Parse(File.ReadAllText(paths.DepotConfigFile));
            var root = document.RootElement;
            string Text(string name) => root.TryGetProperty(name, out var value) && value.ValueKind == JsonValueKind.String ? value.GetString() ?? "" : "";
            var url = Text("url").TrimEnd('/');
            var token = Text("token");
            if (!Uri.TryCreate(url, UriKind.Absolute, out var parsed) || parsed.Scheme is not ("http" or "https") || token.Length < 20) return null;
            var device = Text("device");
            return new DepotConfig(url, token, SafeDevice(device.Length > 0 ? device : Environment.MachineName));
        }
        catch (JsonException)
        {
            return null;
        }
    }

    /// <summary>Copies depot.json shipped beside Yoink.exe (or inside a release ZIP) into place.</summary>
    public static bool Adopt(YoinkPaths paths, string sourceFile)
    {
        if (!File.Exists(sourceFile)) return false;
        Directory.CreateDirectory(paths.Root);
        File.Copy(sourceFile, paths.DepotConfigFile, overwrite: true);
        return true;
    }

    public static string SafeDevice(string value)
    {
        var cleaned = new string(value.Where(c => char.IsAsciiLetterOrDigit(c) || c is '.' or '_' or '-').ToArray());
        return cleaned.Length == 0 ? "windows-pc" : cleaned[..Math.Min(64, cleaned.Length)];
    }
}

/// <summary>latest.json from the depot, trusted only after its signature checks out.</summary>
public sealed record ReleaseManifest(string Version, string File, string Sha256, long Size, string Commit, string PublishedAt)
{
    /// <summary>
    /// Verifies the ECDSA P-256 / SHA-256 signature (IEEE P1363, base64) over the
    /// exact manifest text with the pinned release public key, then parses it.
    /// </summary>
    public static ReleaseManifest Verify(string manifestText, string signatureBase64, string pinnedPublicKeyBase64)
    {
        byte[] signature;
        try
        {
            signature = Convert.FromBase64String(signatureBase64.Trim());
        }
        catch (FormatException)
        {
            throw new InvalidDataException("The release signature is not valid base64.");
        }
        using var key = ECDsa.Create();
        key.ImportSubjectPublicKeyInfo(Convert.FromBase64String(pinnedPublicKeyBase64.Trim()), out _);
        if (!key.VerifyData(Encoding.UTF8.GetBytes(manifestText), signature, HashAlgorithmName.SHA256, DSASignatureFormat.IeeeP1363FixedFieldConcatenation))
            throw new InvalidDataException("The release is not signed by the Yoink release key; it was not installed.");
        using var document = JsonDocument.Parse(manifestText);
        var root = document.RootElement;
        string Text(string name) => root.TryGetProperty(name, out var value) && value.ValueKind == JsonValueKind.String ? value.GetString() ?? "" : "";
        if (!root.TryGetProperty("schemaVersion", out var schema) || schema.ValueKind != JsonValueKind.Number || schema.GetInt32() != 1 || Text("product") != "yoink-windows")
            throw new InvalidDataException("The release manifest is not a Yoink Windows release.");
        var file = Text("file");
        if (file.Contains('/') || file.Contains('\\') || !file.StartsWith("Yoink-win-x64-", StringComparison.Ordinal) || !file.EndsWith(".zip", StringComparison.Ordinal))
            throw new InvalidDataException("The release manifest names an unexpected file.");
        var sha = Text("sha256");
        if (sha.Length != 64 || !sha.All(Uri.IsHexDigit)) throw new InvalidDataException("The release manifest has no SHA-256.");
        var size = root.TryGetProperty("size", out var s) && s.ValueKind == JsonValueKind.Number ? s.GetInt64() : 0;
        return new ReleaseManifest(ServerVersion.RequireSafe(Text("version")), file, sha.ToLowerInvariant(), size, Text("commit"), Text("publishedAt"));
    }
}

/// <summary>Talks to the depot: the signed latest release, its ZIP, and diagnostics uploads.</summary>
public sealed class DepotClient(HttpClient http, DepotConfig config, string pinnedPublicKey)
{
    private HttpRequestMessage Request(HttpMethod method, string path)
    {
        var request = new HttpRequestMessage(method, $"{config.Url}{path}");
        request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", config.Token);
        request.Headers.Add("X-Yoink-Device", config.Device);
        return request;
    }

    public async Task<ReleaseManifest?> LatestAsync(CancellationToken cancelled = default)
    {
        using var response = await http.SendAsync(Request(HttpMethod.Get, "/v1/releases/latest"), cancelled);
        if (response.StatusCode == System.Net.HttpStatusCode.NotFound) return null;
        response.EnsureSuccessStatusCode();
        using var document = JsonDocument.Parse(await response.Content.ReadAsStringAsync(cancelled));
        var manifest = document.RootElement.GetProperty("manifest").GetString() ?? "";
        var signature = document.RootElement.GetProperty("signature").GetString() ?? "";
        return ReleaseManifest.Verify(manifest, signature, pinnedPublicKey);
    }

    /// <summary>Downloads the release ZIP and refuses it unless size and SHA-256 match the signed manifest.</summary>
    public async Task<string> DownloadAsync(ReleaseManifest release, string directory, CancellationToken cancelled = default)
    {
        Directory.CreateDirectory(directory);
        var target = Path.Combine(directory, release.File);
        var partial = target + ".part";
        using (var response = await http.SendAsync(Request(HttpMethod.Get, $"/v1/releases/files/{Uri.EscapeDataString(release.File)}"), HttpCompletionOption.ResponseHeadersRead, cancelled))
        {
            response.EnsureSuccessStatusCode();
            await using var output = File.Create(partial);
            await response.Content.CopyToAsync(output, cancelled);
        }
        var bytes = new FileInfo(partial).Length;
        string sha;
        await using (var input = File.OpenRead(partial)) sha = Convert.ToHexString(await SHA256.HashDataAsync(input, cancelled)).ToLowerInvariant();
        if ((release.Size > 0 && bytes != release.Size) || sha != release.Sha256)
        {
            File.Delete(partial);
            throw new InvalidDataException("The downloaded release does not match its signed checksum; it was discarded.");
        }
        File.Move(partial, target, overwrite: true);
        return target;
    }

    public async Task UploadDiagnosticsAsync(byte[] zip, CancellationToken cancelled = default)
    {
        using var request = Request(HttpMethod.Post, "/v1/diagnostics");
        request.Content = new ByteArrayContent(zip);
        request.Content.Headers.ContentType = new MediaTypeHeaderValue("application/zip");
        using var response = await http.SendAsync(request, cancelled);
        response.EnsureSuccessStatusCode();
    }
}
