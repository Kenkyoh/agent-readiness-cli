import type {
  AmbiguityFlag,
  ConventionsReport,
  ExistingDocsDiff,
  Fingerprint,
  StructureReport,
} from "../types.js";

/**
 * Roll up rule-based warnings from the other scan passes into a flat list.
 *
 * Most rules are evaluated per package, since in a multi-package repo the
 * gaps differ package by package — a root app with tests and a backend
 * without are two different situations, and one aggregate answer hides that.
 * Only the doc rules are repo-wide, matching `existingDocs`' root-only scope.
 *
 * Pure and synchronous: everything it needs was already gathered.
 */
export function computeAmbiguityFlags(
  fingerprints: Fingerprint[],
  structure: StructureReport,
  conventions: ConventionsReport[],
  existingDocs: ExistingDocsDiff
): AmbiguityFlag[] {
  const flags: AmbiguityFlag[] = [];
  const conventionsByPath = new Map(conventions.map((c) => [c.packagePath, c]));
  const fingerprintsByPath = new Map(fingerprints.map((f) => [f.packagePath, f]));

  for (const packagePath of structure.packages) {
    const where = packagePath === "." ? "the root package" : `package "${packagePath}"`;
    const fingerprint = fingerprintsByPath.get(packagePath);
    const packageConventions = conventionsByPath.get(packagePath);

    if (fingerprint && !fingerprint.hasLockfile) {
      flags.push({
        severity: "warn",
        message: `No lockfile in ${where} — dependency versions are ambiguous.`,
      });
    }

    if (fingerprint && !hasTestScript(fingerprint)) {
      flags.push({
        severity: "warn",
        message: `No test script in ${where} — no way to verify a change.`,
      });
    }

    const entries = structure.entryPoints.filter((e) => e.packagePath === packagePath);
    if (entries.length === 0) {
      flags.push({
        severity: "warn",
        message: `No entry point found for ${where}.`,
      });
    } else if (entries.length > 1) {
      flags.push({
        severity: "warn",
        message:
          `Multiple plausible entry points in ${where} ` +
          `(${entries.map((e) => e.path).join(", ")}), ` +
          `nothing indicates which is canonical.`,
      });
    }

    if (packageConventions && packageConventions.linters.length === 0) {
      flags.push({
        severity: "info",
        message: `No linter or formatter configured in ${where}.`,
      });
    }
  }

  for (const claim of existingDocs.staleClaims) {
    flags.push({
      severity: "error",
      message:
        `Stale claim in ${existingDocs.docPath ?? "the context doc"}: ` +
        `\`${claim}\` matches no script in any package.`,
    });
  }

  if (existingDocs.docPath === null) {
    flags.push({
      severity: "info",
      message: "No CLAUDE.md or AGENTS.md found — the agent starts with no context.",
    });
  }

  return flags;
}

/**
 * A test script may be named `test` or scoped (`test:unit`), and running
 * either means the package is verifiable.
 */
function hasTestScript(fingerprint: Fingerprint): boolean {
  return Object.keys(fingerprint.scripts).some((name) => /^test(:|$)/.test(name));
}
