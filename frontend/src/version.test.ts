import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

test("footer version matches package.json and Cargo.toml", () => {
  const frontend = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
  const pkg = JSON.parse(
    fs.readFileSync(path.join(frontend, "package.json"), "utf8"),
  ) as { version: string };
  const cargo = fs.readFileSync(path.join(frontend, "..", "Cargo.toml"), "utf8");
  const cargoVersion = cargo.match(/^version = "([^"]+)"/m)?.[1];
  assert.match(pkg.version, /^\d+\.\d+\.\d+$/);
  assert.equal(cargoVersion, pkg.version);
});
