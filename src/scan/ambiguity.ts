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
 * The doc rules are repo-wide, matching `existingDocs`' root-only scope.
 *
 * The lockfile and test-script rules are the exception: in a *declared*
 * workspace they are evaluated once for the whole repo, because a workspace
 * installs from one root lockfile and usually tests from one root script.
 * An incidental multi-package repo (no `workspaces` field) still gets both
 * per package, since there each package really is installed on its own.
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

  // In a declared workspace, dependencies are installed once from the root and
  // the test harness usually lives there too — members having neither is the
  // correct layout, not a gap. Evaluating those two rules per package turns a
  // well-configured monorepo into one warning per member.
  const isWorkspace = structure.hasWorkspacesDeclared;

  if (isWorkspace) {
    // A workspace root usually has a manifest, but pnpm allows one with only
    // pnpm-workspace.yaml. Fall back to "nobody has a lockfile" there, so the
    // rule can't go silent just because the root isn't a package.
    const root = fingerprintsByPath.get(".");
    const lockfilePresent = root
      ? root.hasLockfile
      : fingerprints.some((f) => f.hasLockfile);

    if (!lockfilePresent) {
      flags.push({
        severity: "warn",
        message:
          "No lockfile at the workspace root — dependency versions are " +
          "ambiguous for every package.",
      });
    }

    if (!fingerprints.some(hasTestScript)) {
      flags.push({
        severity: "warn",
        message:
          "No test script anywhere in the workspace — no way to verify a change.",
      });
    }
  }

  for (const packagePath of structure.packages) {
    const where = packagePath === "." ? "the root package" : `package "${packagePath}"`;
    const fingerprint = fingerprintsByPath.get(packagePath);
    const packageConventions = conventionsByPath.get(packagePath);

    // Outside a workspace each package is installed and tested independently,
    // so both rules stay per package.
    if (!isWorkspace && fingerprint && !fingerprint.hasLockfile) {
      flags.push({
        severity: "warn",
        message: `No lockfile in ${where} — dependency versions are ambiguous.`,
      });
    }

    if (!isWorkspace && fingerprint && !hasTestScript(fingerprint)) {
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
