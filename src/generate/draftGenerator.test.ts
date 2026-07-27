import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { AmbiguityFlag, ScanResult } from "../types.js";

/** Whatever the model "returns" for a given test. */
let modelDraft = "";

vi.mock("@anthropic-ai/sdk", () => ({
  default: class {
    messages = {
      create: async () => ({ content: [{ type: "text", text: modelDraft }] }),
    };
  },
}));

const { applyKnownGaps, generateDraft } = await import("./draftGenerator.js");

const FLAGS: AmbiguityFlag[] = [
  { severity: "error", message: "Stale claim in CLAUDE.md: `npm run lint`." },
  { severity: "warn", message: 'No test script in package "backend".' },
  { severity: "info", message: "No linter configured in the root package." },
];

function scanResult(flags: AmbiguityFlag[]): ScanResult {
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
      ignoredPaths: [],
    },
    conventions: [{ packagePath: ".", linters: [], hasContributing: false }],
    existingDocs: { docPath: null, staleClaims: [] },
    flags,
  };
}

const gapLines = (markdown: string) =>
  markdown
    .split("\n")
    .filter((line) => line.startsWith("- ["))
    .map((line) => line.trim());

describe("generateDraft known-gaps handling", () => {
  beforeEach(() => vi.stubEnv("ANTHROPIC_API_KEY", "test-key"));
  afterEach(() => vi.unstubAllEnvs());

  it("includes every flag when the model omitted the section entirely", async () => {
    modelDraft = "# CLAUDE.md\n\n## Running it\n\n```bash\nnpm test\n```";
    const markdown = await generateDraft(scanResult(FLAGS));

    expect(markdown).toContain("## Known gaps");
    expect(gapLines(markdown)).toEqual([
      "- [error] Stale claim in CLAUDE.md: `npm run lint`.",
      '- [warn] No test script in package "backend".',
      "- [info] No linter configured in the root package.",
    ]);
  });

  it("overrides a section the model wrote with a filtered subset", async () => {
    // The failure this guards: the model reports only the flag it judged
    // important and drops the error and warning.
    modelDraft =
      "# CLAUDE.md\n\n## Known gaps\n\n- No linter is configured.\n";
    const markdown = await generateDraft(scanResult(FLAGS));

    expect(gapLines(markdown)).toHaveLength(3);
    expect(markdown).toContain("- [error] Stale claim in CLAUDE.md");
    expect(markdown).toContain('- [warn] No test script in package "backend".');
    expect(markdown).not.toContain("- No linter is configured.");
  });

  it("emits no section when there are no flags", async () => {
    modelDraft = "# CLAUDE.md\n\n## Running it\n\n```bash\nnpm test\n```";
    const markdown = await generateDraft(scanResult([]));

    expect(markdown).not.toContain("Known gaps");
  });

  it("strips a section the model invented when there are no flags", async () => {
    modelDraft =
      "# CLAUDE.md\n\n## Known gaps\n\n- Tests look thin.\n\n## Conventions\n\nNone.";
    const markdown = await generateDraft(scanResult([]));

    expect(markdown).not.toContain("Known gaps");
    expect(markdown).not.toContain("Tests look thin.");
    // Content after the section must survive.
    expect(markdown).toContain("## Conventions");
  });
});

describe("applyKnownGaps", () => {
  it("appends the section at the end when absent", () => {
    const result = applyKnownGaps("# Doc\n\n## Conventions\n\nNone.", FLAGS);
    expect(result.endsWith("- [info] No linter configured in the root package."))
      .toBe(true);
  });

  it("keeps sections that follow the replaced one intact", () => {
    const draft =
      "# Doc\n\n## Known gaps\n\n- model text\n\n## Conventions\n\nNone.";
    const result = applyKnownGaps(draft, FLAGS);

    expect(result).toContain("## Conventions");
    expect(result).toContain("None.");
    expect(result).not.toContain("- model text");
    expect(result.indexOf("## Known gaps")).toBeLessThan(
      result.indexOf("## Conventions"),
    );
  });

  it("matches the heading case-insensitively and at any level", () => {
    const draft = "# Doc\n\n### known GAPS\n\n- model text\n";
    const result = applyKnownGaps(draft, FLAGS);

    expect(result).not.toContain("- model text");
    expect(gapLines(result)).toHaveLength(3);
  });

  it("leaves a draft untouched when there are no flags and no section", () => {
    const draft = "# Doc\n\n## Conventions\n\nNone.";
    expect(applyKnownGaps(draft, [])).toBe(draft);
  });
});
