import { describe, it, expect } from "vitest";
import path from "node:path";
import { scanFingerprint } from "./fingerprint.js";
import { scanStructure } from "./structure.js";

const FIXTURES = path.resolve(__dirname, "../../test-fixtures");

describe("scanFingerprint", () => {
  it("detects a simple node project and its scripts", async () => {
    const result = await scanFingerprint(path.join(FIXTURES, "simple-node"));
    expect(result.language).toBe("node");
    expect(result.scripts.test).toBeDefined();
    expect(result.hasLockfile).toBe(true);
  });

  it("returns hasLockfile: false when no lockfile is present", async () => {
    const result = await scanFingerprint(path.join(FIXTURES, "stale-docs"));
    expect(result.hasLockfile).toBe(false);
  });

  it("fingerprints each package of a multi-package repo separately", async () => {
    const root = path.join(FIXTURES, "multi-package-no-workspace");
    const structure = await scanStructure(root);

    const fingerprints = await Promise.all(
      structure.packages.map((pkg) => scanFingerprint(path.join(root, pkg), pkg)),
    );
    const byPath = new Map(fingerprints.map((f) => [f.packagePath, f]));

    expect(byPath.get(".")?.scripts).toMatchObject({
      dev: "vite",
      build: "vite build",
    });
    // The nested package's own scripts, invisible when only the root
    // manifest is read.
    expect(byPath.get("backend")?.scripts).toMatchObject({
      dev: "tsx watch src/server.ts",
      build: "tsc",
      start: "node dist/server.js",
    });
  });
});
