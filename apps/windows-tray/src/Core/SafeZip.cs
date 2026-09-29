using System.IO.Compression;

namespace Yoink.Tray.Core;

/// <summary>Extraction that refuses entries escaping the destination and archives that unpack absurdly large.</summary>
public static class SafeZip
{
    public const long MaxExtractedBytes = 8L << 30;

    public static void Extract(ZipArchive archive, string destination, long maxBytes = MaxExtractedBytes)
    {
        var root = Path.GetFullPath(destination) + Path.DirectorySeparatorChar;
        Directory.CreateDirectory(root);
        long total = 0;
        foreach (var entry in archive.Entries)
        {
            var path = Path.GetFullPath(Path.Combine(root, entry.FullName.Replace('\\', '/')));
            if (!path.StartsWith(root, StringComparison.OrdinalIgnoreCase))
                throw new InvalidDataException($"The ZIP entry '{entry.FullName}' points outside its folder; nothing was installed.");
            if (entry.FullName.EndsWith('/') || entry.FullName.EndsWith('\\'))
            {
                Directory.CreateDirectory(path);
                continue;
            }
            total += entry.Length;
            if (total > maxBytes) throw new InvalidDataException($"The ZIP unpacks to more than {maxBytes >> 30} GB; nothing was installed.");
            Directory.CreateDirectory(Path.GetDirectoryName(path)!);
            entry.ExtractToFile(path, overwrite: false);
        }
    }
}
