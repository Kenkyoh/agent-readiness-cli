import { describe, it, expect } from "vitest";
import path from "node:path";
import { computeAmbiguityFlags } from "./ambiguity.js";
import { scanConventions } from "./conventions.js";
import { scanExistingDocs } from "./existingDocs.js";
import { scanFingerprint } from "./fingerprint.js";
import { scanStructure } from "./structure.js";
import type { AmbiguityFlag } from "../types.js";

const FIXTURES = path.resolve(__dirname, "../../test-fixtures");

/** Run every pass over a fixture, the way the `scan` command does. */
async function flagsFor(fixture: string): Promise<AmbiguityFlag[]> {
  const root = path.join(FIXTURES, fixture);
  const structure = await scanStructure(root);
  const fingerprints = await Promise.all(
    structure.packages.map((pkg) => scanFingerprint(path.join(root, pkg), pkg)),
  );
  const conventions = await Promise.all(
    structure.packages.map((pkg) => scanConventions(path.join(root, pkg), pkg)),
  );
  const existingDocs = await scanExistingDocs(root, fingerprints, structure);
  return computeAmbiguityFlags(fingerprints, structure, conventions, existingDocs);
}

const matching = (flags: AmbiguityFlag[], pattern: RegExp) =>
  flags.filter((flag) => pattern.test(flag.message));

describe("computeAmbiguityFlags", () => {
  describe("stale-docs fixture", () => {
    it("warns about the missing lockfile", async () => {
      const flags = await flagsFor("stale-docs");
      const lockfile = matching(flags, /lockfile/i);
      expect(lockfile).toHaveLength(1);
      expect(lockfile[0].severity).toBe("warn");
    });

    it("warns about the missing test script", async () => {
      const flags = await flagsFor("stale-docs");
      const tests = matching(flags, /test script/i);
      expect(tests).toHaveLength(1);
      expect(tests[0].severity).toBe("warn");
    });

    it("raises one error per stale doc claim", async () => {
      const flags = await flagsFor("stale-docs");
      // The fixture's CLAUDE.md claims `npm test`, which no package declares.
      const stale = matching(flags, /stale/i);
      expect(stale).toHaveLength(1);
      expect(stale[0].severity).toBe("error");
      expect(stale[0].message).toContain("npm test");
    });
  });

  describe("multi-package-no-workspace fixture", () => {
    it("does not flag ambiguous entry points when each package has one", async () => {
      const flags = await flagsFor("multi-package-no-workspace");
      // Root has src/main.tsx, backend/ has src/server.ts. Two entry points
      // in the repo, but one apiece — that is not ambiguity.
      expect(matching(flags, /multiple/i)).toHaveLength(0);
    });

    it("reports the package with no linter config and not the one with", async () => {
      const flags = await flagsFor("multi-package-no-workspace");
      const linters = matching(flags, /linter/i);
      // Root has eslint + prettier; backend/ has biome; the nested fixture
      // package is excluded from the scan entirely.
      expect(linters).toHaveLength(0);
    });

    it("finds a CLAUDE.md, so raises no missing-doc flag", async () => {
      const flags = await flagsFor("multi-package-no-workspace");
      expect(matching(flags, /no CLAUDE\.md/i)).toHaveLength(0);
    });
  });

  describe("simple-node fixture", () => {
    it("flags the absent linter config as info, not a warning", async () => {
      const flags = await flagsFor("simple-node");
      const linters = matching(flags, /linter/i);
      expect(linters).toHaveLength(1);
      expect(linters[0].severity).toBe("info");
    });

    it("flags the absence of any context doc as info", async () => {
      const flags = await flagsFor("simple-node");
      const missingDoc = matching(flags, /no CLAUDE\.md/i);
      expect(missingDoc).toHaveLength(1);
      expect(missingDoc[0].severity).toBe("info");
    });

    it("warns that the package has no detectable entry point", async () => {
      const flags = await flagsFor("simple-node");
      // The fixture has a package.json but no source files at all.
      const entries = matching(flags, /no entry point/i);
      expect(entries).toHaveLength(1);
      expect(entries[0].severity).toBe("warn");
    });
  });

  describe("declared workspace", () => {
    it("does not flag members for tooling that lives at the workspace root", async () => {
      // Root holds the lockfile and the test script; the members hold
      // neither. That is the correct layout for a workspace, so neither rule
      // should fire anywhere.
      const flags = await flagsFor("workspace-root-tooling");

      expect(matching(flags, /lockfile/i)).toHaveLength(0);
      expect(matching(flags, /test script/i)).toHaveLength(0);
    });

    it("reports a missing lockfile once, against the workspace root", async () => {
      // The monorepo fixture declares workspaces but has no lockfile at all.
      const flags = await flagsFor("monorepo");
      const lockfile = matching(flags, /lockfile/i);

      expect(lockfile).toHaveLength(1);
      expect(lockfile[0].message).toContain("workspace root");
      expect(lockfile[0].message).not.toContain("packages/a");
    });

    it("stays quiet on tests when any package in the workspace has them", async () => {
      // Root declares no test script, but packages/a and packages/b both do,
      // so there is a way to verify a change.
      const flags = await flagsFor("monorepo");
      expect(matching(flags, /test script/i)).toHaveLength(0);
    });
  });

  describe("incidental multi-package repo", () => {
    it("still evaluates both rules per package", async () => {
      // No workspaces field: each package is installed and tested on its own,
      // so a member missing a lockfile or tests is a real gap.
      const flags = await flagsFor("multi-package-no-workspace");

      expect(
        matching(flags, /lockfile/i).some((f) => f.message.includes('"backend"')),
      ).toBe(true);
      expect(
        matching(flags, /test script/i).some((f) => f.message.includes('"backend"')),
      ).toBe(true);
    });
  });
});
