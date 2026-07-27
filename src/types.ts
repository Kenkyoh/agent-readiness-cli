export interface Fingerprint {
  packagePath: string; // repo-relative path of the package this describes ("." = root)
  language: string; // "node" | "python" | "rust" | "go" | "unknown"
  packageManager?: string; // "npm" | "yarn" | "pnpm" | "pip" | "poetry" | ...
  scripts: Record<string, string>; // e.g. { test: "vitest run", build: "tsc" }
  hasLockfile: boolean;
}

export interface EntryPoint {
  path: string; // repo-relative path to the entry file
  packagePath: string; // package root it belongs to ("." = repo root)
}

export interface StructureReport {
  /**
   * True only when a workspace is actually declared (package.json
   * `workspaces`, pnpm-workspace.yaml, lerna.json, Cargo `[workspace]`,
   * go.work). Deliberately NOT implied by `packages.length > 1`: a repo can
   * hold several packages without declaring a workspace (an app plus a
   * separately-installed backend, say), and that case warrants different
   * advice than a real monorepo.
   */
  hasWorkspacesDeclared: boolean;
  packages: string[]; // relative paths to each package root
  /**
   * Candidate entry files, each tagged with the package it belongs to.
   * Ambiguity is per package: two entry points in one package is a gap,
   * one entry point each across two packages is normal.
   */
  entryPoints: EntryPoint[];
  ignoredPaths: string[]; // node_modules, dist, vendor, etc.
}

export interface ConventionsReport {
  packagePath: string; // repo-relative path of the package this describes ("." = root)
  linters: string[]; // e.g. ["eslint", "prettier"]
  hasContributing: boolean;
}

export interface ExistingDocsDiff {
  docPath: string | null; // path to CLAUDE.md/AGENTS.md if found
  staleClaims: string[]; // human-readable mismatches found
}

export interface AmbiguityFlag {
  severity: "info" | "warn" | "error";
  message: string;
}

export interface ScanResult {
  /** One per package root in `structure.packages`, including the root itself. */
  fingerprints: Fingerprint[];
  structure: StructureReport;
  /** One per package root in `structure.packages`, including the root itself. */
  conventions: ConventionsReport[];
  existingDocs: ExistingDocsDiff;
  flags: AmbiguityFlag[];
}
