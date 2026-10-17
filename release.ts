import { execFileSync, spawnSync } from "node:child_process";
import * as fs from "node:fs";

// Publishes a GitHub release of the version in package.json, with the .ablx
// attached. It runs here rather than in CI because the .ablx bundles Live's
// themes and fonts from the Live installed on this machine (see build.ts).
//
//   npm version <version>   bump package.json and manifest.json, commit and tag
//   git push --follow-tags  and wait for CI to pass on main
//   npm run release         package the .ablx and publish the release
//
// Pass --draft to publish a draft release, --prerelease to mark it as one.
// With --sync-manifest (run by `npm version`), it only copies package.json's
// version into manifest.json.

const FLAGS = ["--draft", "--prerelease"];

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

/** Runs a command, showing its output. */
function run(command: string, args: string[]) {
  execFileSync(command, args, { stdio: "inherit" });
}

/** Runs a command and returns its output, or undefined if it fails. */
function read(command: string, args: string[]): string | undefined {
  const result = spawnSync(command, args, { encoding: "utf8" });
  return result.status === 0 ? result.stdout.trim() : undefined;
}

const readJson = (file: string) => JSON.parse(fs.readFileSync(file, "utf8"));
const { version } = readJson("package.json");
const manifest = readJson("manifest.json");

const args = process.argv.slice(2);
if (args.includes("--sync-manifest")) {
  fs.writeFileSync("manifest.json", JSON.stringify({ ...manifest, version }, null, 2) + "\n");
  process.exit(0);
}
const unknown = args.filter((arg) => !FLAGS.includes(arg));
if (unknown.length) fail(`Unknown options: ${unknown.join(" ")}. Use ${FLAGS.join(" or ")}.`);

const tag = `v${version}`;
const ablx = `${manifest.name.replaceAll(" ", "-")}-${version}.ablx`;

if (manifest.version !== version) {
  fail(`manifest.json has version ${manifest.version}, package.json ${version}. Bump both with npm version.`);
}
if (read("gh", ["auth", "status"]) === undefined) fail("Log in to GitHub first: gh auth login.");
if (read("gh", ["release", "view", tag]) !== undefined) fail(`${tag} is already released.`);

if (read("git", ["status", "--porcelain"])) fail("Commit or stash your changes first.");
if (read("git", ["branch", "--show-current"]) !== "main") fail("Release from main.");
run("git", ["fetch", "origin", "main"]);
const head = read("git", ["rev-parse", "HEAD"]);
if (head !== read("git", ["rev-parse", "origin/main"])) fail("main isn't the same as origin/main: push or pull first.");

const tagged = read("git", ["rev-parse", "--verify", "--quiet", `refs/tags/${tag}^{commit}`]);
if (tagged && tagged !== head) fail(`${tag} is on ${tagged}, not on main's ${head}.`);

// CI runs the unit and browser tests on every push to main.
const [ci] = JSON.parse(
  read("gh", ["run", "list", "--commit", head!, "--workflow", "ci.yml", "--json", "status,conclusion"]) ?? "[]",
);
if (ci?.conclusion !== "success") {
  fail(ci ? `CI on ${head} is ${ci.conclusion || ci.status}: wait for it to pass.` : `CI hasn't run on ${head}.`);
}

// --require-live (in npm run package) fails the build without Live's themes.
fs.rmSync(ablx, { force: true });
run("npm", ["run", "package", "--", "-o", ablx]);
if (!fs.existsSync(ablx)) fail(`Packaging didn't produce ${ablx}.`);

if (!tagged) run("git", ["tag", "--annotate", tag, "--message", tag]);
run("git", ["push", "origin", tag]);

const notes = `Install it by dropping \`${ablx}\` into the Extensions page in Live's settings (with Developer Mode off).`;
run("gh", [
  "release",
  "create",
  tag,
  ablx,
  "--verify-tag",
  "--title",
  `${manifest.name} ${version}`,
  "--notes",
  notes,
  "--generate-notes",
  ...args,
]);
