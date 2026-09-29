import { access, mkdir } from "node:fs/promises";
import { dirname, resolve, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const directory = dirname(fileURLToPath(import.meta.url));
const repository = resolve(directory, "../..");
const output = join(repository, "release/yoink-windows-capture-x64.zip");
await access(join(directory, "package/Yoink.NotificationCapture.exe"));
await mkdir(dirname(output), { recursive: true });
// Python's standard library avoids adding an archiver dependency to the Yoink application.
const script = `
import pathlib, sys, zipfile
source = pathlib.Path(sys.argv[1])
output = pathlib.Path(sys.argv[2])
with zipfile.ZipFile(output, 'w', compression=zipfile.ZIP_DEFLATED, compresslevel=6) as archive:
    for name in ['Install.ps1', 'AppxManifest.xml', 'README.md', 'analyze.mjs']:
        archive.write(source / name, name)
    for folder in ['Assets', 'package']:
        for path in sorted((source / folder).rglob('*')):
            if path.is_file() and path.suffix != '.pdb':
                archive.write(path, path.relative_to(source).as_posix())
with zipfile.ZipFile(output) as archive:
    bad = archive.testzip()
    if bad:
        raise RuntimeError('ZIP verification failed: ' + bad)
print(output)
`;
const child = spawnSync("python3", ["-c", script, directory, output], { stdio: "inherit" });
if (child.error) throw child.error;
if (child.status !== 0) process.exitCode = child.status ?? 1;
