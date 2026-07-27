import { describe, it, expect } from "vitest";
import path from "node:path";
import { scanConventions } from "./conventions.js";
import { scanStructure } from "./structure.js";

const FIXTURES = path.resolve(__dirname, "../../test-fixtures");

describe("scanConventions", () => {
  it("detects nothing in a package with no config files", async () => {
    const result = await scanConventions(path.join(FIXTURES, "simple-node"));
    expect(result.packagePath).toBe(".");
    expect(result.linters).toEqual([]);
    expect(result.hasContributing).toBe(false);
  });

  describe("per-package detection", () => {
    const root = path.join(FIXTURES, "multi-package-no-workspace");

    it("reports the root package's own eslint/prettier setup", async () => {
      const result = await scanConventions(root, ".");
      expect(result.packagePath).toBe(".");
      expect(result.linters).toContain("eslint");
      expect(result.linters).toContain("prettier");
      expect(result.hasContributing).toBe(true);
    });

    it("reports the nested package's different setup, not the root's", async () => {
      const result = await scanConventions(path.join(root, "backend"), "backend");
      expect(result.packagePath).toBe("backend");
      expect(result.linters).toContain("biome");
      // The root's config must not leak down into the nested package.
      expect(result.linters).not.toContain("eslint");
      expect(result.linters).not.toContain("prettier");
      expect(result.hasContributing).toBe(false);
    });

    it("produces a distinct report per package root", async () => {
      const structure = await scanStructure(root);
      const reports = await Promise.all(
        structure.packages.map((pkg) => scanConventions(path.join(root, pkg), pkg)),
      );
      const byPath = new Map(reports.map((r) => [r.packagePath, r]));

      expect(byPath.size).toBe(structure.packages.length);
      expect(byPath.get(".")?.linters).not.toEqual(byPath.get("backend")?.linters);
    });
  });
});
