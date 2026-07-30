import { describe, it, expect } from "vitest";
import path from "node:path";
import { scanFingerprint } from "./fingerprint.js";
import { scanStructure } from "./structure.js";
import { scanExistingDocs } from "./existingDocs.js";

const FIXTURES = path.resolve(__dirname, "../../test-fixtures");

describe("scanExistingDocs", () => {
  it("flags a CLAUDE.md claim that doesn't match the real scripts", async () => {
    const root = path.join(FIXTURES, "stale-docs");
    const structure = await scanStructure(root);
    const fingerprints = await Promise.all(
      structure.packages.map((pkg) => scanFingerprint(path.join(root, pkg), pkg)),
    );
    const diff = await scanExistingDocs(root, fingerprints, structure);

    // The fixture's CLAUDE.md claims `npm test` works, but package.json
    // has no "test" script — this claim must be caught.
    expect(diff.docPath).toContain("CLAUDE.md");
    expect(diff.staleClaims.length).toBeGreaterThan(0);
  });

  it("checks `npm run <name>` even when the name is an npm subcommand", async () => {
    const root = path.join(FIXTURES, "builtin-named-script");
    const structure = await scanStructure(root);
    const fingerprints = await Promise.all(
      structure.packages.map((pkg) => scanFingerprint(path.join(root, pkg), pkg)),
    );
    const diff = await scanExistingDocs(root, fingerprints, structure);

    // The explicit `run` form can only mean a script, so a missing one is stale.
    expect(diff.staleClaims).toContain("npm run publish");
    // The bare form is npm's own command — nothing we can verify.
    expect(diff.staleClaims).not.toContain("npm publish");
    // And a declared script by the same name is not stale.
    expect(diff.staleClaims).not.toContain("npm run version");
  });

  it("does not flag a claim that a nested package declares", async () => {
    const root = path.join(FIXTURES, "multi-package-no-workspace");
    const structure = await scanStructure(root);
    const fingerprints = await Promise.all(
      structure.packages.map((pkg) => scanFingerprint(path.join(root, pkg), pkg)),
    );
    const diff = await scanExistingDocs(root, fingerprints, structure);

    // "start" is declared by backend/ only — the root manifest has no such
    // script, so checking fingerprints[0] alone would wrongly flag this.
    expect(diff.staleClaims).not.toContain("npm run start");
    // "dev" is declared by both packages.
    expect(diff.staleClaims).not.toContain("npm run dev");
    // "lint" is declared by neither, so it is genuinely stale.
    expect(diff.staleClaims).toContain("npm run lint");
  });
});
