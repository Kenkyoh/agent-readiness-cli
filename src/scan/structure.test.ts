import { describe, it, expect } from "vitest";
import path from "node:path";
import { scanStructure } from "./structure.js";

const FIXTURES = path.resolve(__dirname, "../../test-fixtures");

const entryPaths = (result: { entryPoints: { path: string }[] }) =>
  result.entryPoints.map((entry) => entry.path);

describe("scanStructure", () => {
  it("detects a monorepo with multiple packages", async () => {
    const result = await scanStructure(path.join(FIXTURES, "monorepo"));
    expect(result.hasWorkspacesDeclared).toBe(true);
    expect(result.packages.length).toBeGreaterThanOrEqual(2);
  });

  it("detects a single-package project as not a monorepo", async () => {
    const result = await scanStructure(path.join(FIXTURES, "simple-node"));
    expect(result.hasWorkspacesDeclared).toBe(false);
  });

  describe("multi-package repo with no declared workspace", () => {
    const root = path.join(FIXTURES, "multi-package-no-workspace");

    it("reports multiple packages without claiming a declared workspace", async () => {
      const result = await scanStructure(root);
      expect(result.hasWorkspacesDeclared).toBe(false);
      expect(result.packages).toContain(".");
      expect(result.packages).toContain("backend");
    });

    it("finds the real entry points and not the barrel file", async () => {
      const result = await scanStructure(root);
      // src/main.tsx comes from index.html's module script tag; the backend
      // entry comes from its "dev": "tsx watch src/server.ts" script.
      expect(result.entryPoints).toContainEqual({
        path: "src/main.tsx",
        packagePath: ".",
      });
      expect(result.entryPoints).toContainEqual({
        path: "backend/src/server.ts",
        packagePath: "backend",
      });
      expect(entryPaths(result)).not.toContain("src/types/index.ts");
    });

    it("attributes each entry point to its own package, one apiece", async () => {
      const result = await scanStructure(root);
      const byPackage = result.entryPoints.filter((e) => e.packagePath === "backend");
      expect(byPackage).toEqual([
        { path: "backend/src/server.ts", packagePath: "backend" },
      ]);
    });

    it("does not count manifests inside fixture directories as packages", async () => {
      const result = await scanStructure(root);
      // test-fixtures/fake-package/package.json is a prop, not a package.
      expect(result.packages).not.toContain("test-fixtures/fake-package");
      expect(result.packages).toEqual([".", "backend"]);
      expect(result.ignoredPaths).toContain("test-fixtures");
    });

    it("ignores real files named by tooling scripts", async () => {
      const result = await scanStructure(root);
      // "screenshots": "node scripts/take-screenshots.mjs" points at a file
      // that exists, but it's a dev utility, not a way into the program.
      expect(entryPaths(result)).not.toContain("scripts/take-screenshots.mjs");
    });

    it("ignores build-artifact paths named in scripts but not on disk", async () => {
      const result = await scanStructure(root);
      // "start": "node dist/server.js" references an unbuilt artifact.
      expect(entryPaths(result)).not.toContain("backend/dist/server.js");
    });
  });
});
