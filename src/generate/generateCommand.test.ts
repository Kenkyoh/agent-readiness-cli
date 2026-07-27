import { describe, it, expect, vi } from "vitest";
import path from "node:path";
import { runGenerate, type GenerateDeps } from "./generateCommand.js";
import type { ScanResult } from "../types.js";

const REPO = path.resolve("/repo");

function scanResult(docPath: string | null): ScanResult {
  return {
    fingerprints: [
      {
        packagePath: ".",
        language: "node",
        packageManager: "npm",
        scripts: { test: "vitest run" },
        hasLockfile: true,
      },
    ],
    structure: {
      hasWorkspacesDeclared: false,
      packages: ["."],
      entryPoints: [{ path: "src/index.ts", packagePath: "." }],
      ignoredPaths: ["node_modules"],
    },
    conventions: [{ packagePath: ".", linters: [], hasContributing: false }],
    existingDocs: { docPath, staleClaims: [] },
    flags: [],
  };
}

/** Deps that record what was called; `draft` returns a fixed markdown string. */
function deps(docPath: string | null): GenerateDeps & {
  draft: ReturnType<typeof vi.fn>;
  write: ReturnType<typeof vi.fn>;
} {
  return {
    scan: vi.fn(async () => scanResult(docPath)),
    draft: vi.fn(async () => "# CLAUDE.md\n\nDrafted."),
    write: vi.fn(async () => {}),
  };
}

describe("runGenerate", () => {
  describe("when a doc already exists", () => {
    it("refuses to write with no flags", async () => {
      const d = deps("CLAUDE.md");
      const outcome = await runGenerate(REPO, {}, d);

      expect(outcome.action).toBe("refused");
      expect(d.write).not.toHaveBeenCalled();
      expect(outcome.message).toContain("--diff");
      expect(outcome.message).toContain("--force");
    });

    it("does not spend an API call on a refusal", async () => {
      const d = deps("CLAUDE.md");
      await runGenerate(REPO, {}, d);
      // The refusal is decided from the scan alone.
      expect(d.draft).not.toHaveBeenCalled();
    });

    it("writes when --force is passed", async () => {
      const d = deps("CLAUDE.md");
      const outcome = await runGenerate(REPO, { force: true }, d);

      expect(outcome.action).toBe("written");
      expect(d.write).toHaveBeenCalledTimes(1);
      expect(d.write.mock.calls[0][0]).toBe(path.join(REPO, "CLAUDE.md"));
      expect(d.write.mock.calls[0][1]).toContain("Drafted.");
    });

    it("prints and does not write when --diff is passed", async () => {
      const d = deps("CLAUDE.md");
      const outcome = await runGenerate(REPO, { diff: true }, d);

      expect(outcome.action).toBe("printed");
      expect(outcome.draft).toContain("Drafted.");
      expect(d.write).not.toHaveBeenCalled();
    });

    it("overwrites the doc that was found, not a fresh CLAUDE.md", async () => {
      const d = deps("AGENTS.md");
      await runGenerate(REPO, { force: true }, d);
      expect(d.write.mock.calls[0][0]).toBe(path.join(REPO, "AGENTS.md"));
    });
  });

  describe("when no doc exists", () => {
    it("writes CLAUDE.md with no flags — there is nothing to clobber", async () => {
      const d = deps(null);
      const outcome = await runGenerate(REPO, {}, d);

      expect(outcome.action).toBe("written");
      expect(outcome.docPath).toBe("CLAUDE.md");
      expect(d.write).toHaveBeenCalledTimes(1);
      expect(d.write.mock.calls[0][0]).toBe(path.join(REPO, "CLAUDE.md"));
    });

    it("still only prints under --diff", async () => {
      const d = deps(null);
      const outcome = await runGenerate(REPO, { diff: true }, d);

      expect(outcome.action).toBe("printed");
      expect(d.write).not.toHaveBeenCalled();
    });
  });
});
