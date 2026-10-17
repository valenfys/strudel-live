import * as fs from "node:fs";
import { expect, it } from "vitest";

// Live reads the version from manifest.json, releases from package.json (release.ts).
it("gives manifest.json the version in package.json", () => {
  const readJson = (file: string) => JSON.parse(fs.readFileSync(file, "utf8"));
  expect(readJson("manifest.json").version).toBe(readJson("package.json").version);
});
