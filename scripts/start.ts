import * as fs from "node:fs";
import * as path from "node:path";
import { runExtension } from "@ableton-extensions/cli";

// Runs the extension in Live's Extension Host (Developer Mode) under the same
// restrictions as when Live hosts an installed extension: Node's permission
// model, reading only the extension and its storage and temp directories, and
// writing only the latter two. Without this, code that touches other paths
// works in development and fails once installed. The flags mirror the command
// line Live starts its Extension Host with (see it with `ps` while Live runs).

try {
  process.loadEnvFile();
} catch {
  // No .env: EXTENSION_HOST_PATH may still be set in the environment.
}
const live = process.env.EXTENSION_HOST_PATH;
if (!live) {
  console.error("Set EXTENSION_HOST_PATH in .env to Live's ExtensionHostNodeModule.node (see README).");
  process.exit(1);
}

const extensionDirectory = process.cwd();
const storageDirectory = path.resolve(".extension-host/storage");
const tempDirectory = path.resolve(".extension-host/temp");
for (const directory of [storageDirectory, tempDirectory]) fs.mkdirSync(directory, { recursive: true });

// The CLI's Extension Host inherits this environment. Quoted, as Live's paths have spaces.
const flag = (name: string, value: string) => `"--${name}=${value}"`;
process.env.NODE_OPTIONS = [
  process.env.NODE_OPTIONS,
  "--permission",
  "--allow-addons",
  "--allow-child-process",
  flag("allow-fs-read", extensionDirectory),
  flag("allow-fs-read", storageDirectory),
  flag("allow-fs-read", tempDirectory),
  flag("allow-fs-write", storageDirectory),
  flag("allow-fs-write", tempDirectory),
]
  .filter(Boolean)
  .join(" ");

runExtension(extensionDirectory, {
  live,
  storageDirectory,
  tempDirectory,
  verbose: process.argv.includes("--verbose"),
});
