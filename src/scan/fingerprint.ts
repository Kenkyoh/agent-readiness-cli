import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import type { Fingerprint } from "../types.js";

/** Lockfiles that identify a package manager, in detection order. */
const NODE_LOCKFILES: Array<[file: string, packageManager: string]> = [
  ["pnpm-lock.yaml", "pnpm"],
  ["yarn.lock", "yarn"],
  ["bun.lockb", "bun"],
  ["package-lock.json", "npm"],
];

const PYTHON_LOCKFILES: Array<[file: string, packageManager: string]> = [
  ["poetry.lock", "poetry"],
  ["uv.lock", "uv"],
  ["Pipfile.lock", "pipenv"],
  ["requirements.txt", "pip"],
];

/**
 * Detect one package's language/stack and declared scripts by reading
 * package.json / pyproject.toml / Cargo.toml / go.mod in `packageRoot`.
 *
 * Call this once per package root reported by the structure pass — in a
 * multi-package repo the nested packages carry their own scripts, and reading
 * only the top-level manifest hides them.
 *
 * `packagePath` is the repo-relative label recorded on the result; it does not
 * affect what is read.
 *
 * Pure: reads files only, returns the data. Never throws on a malformed or
 * missing manifest — an unreadable package is reported as `language: "unknown"`.
 */
export async function scanFingerprint(
  packageRoot: string,
  packagePath = ".",
): Promise<Fingerprint> {
  const repoRoot = packageRoot;
  const pkg = await readJson(path.join(repoRoot, "package.json"));
  if (pkg) {
    const { packageManager, hasLockfile } = await detectLockfile(
      repoRoot,
      NODE_LOCKFILES,
    );
    return {
      packagePath,
      language: "node",
      // A "packageManager" field in package.json (corepack) is more
      // authoritative than the lockfile, e.g. "pnpm@9.1.0".
      packageManager: parsePackageManagerField(pkg.packageManager) ?? packageManager,
      scripts: stringRecord(pkg.scripts),
      hasLockfile,
    };
  }

  const pyproject = await readText(path.join(repoRoot, "pyproject.toml"));
  if (pyproject !== null) {
    const { packageManager, hasLockfile } = await detectLockfile(
      repoRoot,
      PYTHON_LOCKFILES,
    );
    return {
      packagePath,
      language: "python",
      packageManager:
        packageManager ??
        (/^\s*\[tool\.poetry\b/m.test(pyproject) ? "poetry" : "pip"),
      scripts: parseTomlScripts(pyproject, "tool.poetry.scripts"),
      hasLockfile,
    };
  }

  const cargo = await readText(path.join(repoRoot, "Cargo.toml"));
  if (cargo !== null) {
    return {
      packagePath,
      language: "rust",
      packageManager: "cargo",
      // Cargo has no user-declared script table; the commands are fixed.
      scripts: { test: "cargo test", build: "cargo build" },
      hasLockfile: await exists(path.join(repoRoot, "Cargo.lock")),
    };
  }

  if (await exists(path.join(repoRoot, "go.mod"))) {
    return {
      packagePath,
      language: "go",
      packageManager: "go",
      scripts: { test: "go test ./...", build: "go build ./..." },
      hasLockfile: await exists(path.join(repoRoot, "go.sum")),
    };
  }

  return { packagePath, language: "unknown", scripts: {}, hasLockfile: false };
}

async function detectLockfile(
  repoRoot: string,
  candidates: Array<[string, string]>,
): Promise<{ packageManager?: string; hasLockfile: boolean }> {
  for (const [file, packageManager] of candidates) {
    if (await exists(path.join(repoRoot, file))) {
      return { packageManager, hasLockfile: true };
    }
  }
  return { packageManager: undefined, hasLockfile: false };
}

/** "pnpm@9.1.0" -> "pnpm". Returns undefined for anything unparseable. */
function parsePackageManagerField(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const name = value.split("@")[0]?.trim();
  return name ? name : undefined;
}

/** Keep only string-valued entries, so a malformed manifest can't leak through. */
function stringRecord(value: unknown): Record<string, string> {
  if (!value || typeof value !== "object") return {};
  const out: Record<string, string> = {};
  for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
    if (typeof val === "string") out[key] = val;
  }
  return out;
}

/**
 * Minimal TOML table reader: pulls `key = "value"` pairs out of one named
 * table. Enough for `[tool.poetry.scripts]`, and avoids a TOML dependency in
 * a pass that has to stay fast and dependency-free.
 */
function parseTomlScripts(toml: string, table: string): Record<string, string> {
  const lines = toml.split(/\r?\n/);
  const scripts: Record<string, string> = {};
  let inTable = false;

  for (const raw of lines) {
    const line = raw.trim();
    if (line.startsWith("[")) {
      inTable = line === `[${table}]`;
      continue;
    }
    if (!inTable || !line || line.startsWith("#")) continue;

    const match = /^["']?([\w.-]+)["']?\s*=\s*["'](.*)["']\s*$/.exec(line);
    if (match) scripts[match[1]] = match[2];
  }
  return scripts;
}

async function readText(filePath: string): Promise<string | null> {
  try {
    return await readFile(filePath, "utf8");
  } catch {
    return null;
  }
}

async function readJson(
  filePath: string,
): Promise<Record<string, any> | null> {
  const text = await readText(filePath);
  if (text === null) return null;
  try {
    const parsed = JSON.parse(text);
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

async function exists(filePath: string): Promise<boolean> {
  try {
    return (await stat(filePath)).isFile();
  } catch {
    return false;
  }
}
