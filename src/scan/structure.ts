import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import type { EntryPoint, StructureReport } from "../types.js";

/**
 * Directories never worth walking into. This single list drives three things,
 * deliberately: what lands in `ignoredPaths`, what the walk descends into, and
 * therefore what counts as a package root.
 *
 * Fixture and example directories are here because their manifests are props,
 * not packages. Counting them pollutes every downstream pass — most damagingly
 * `existingDocs`, where a fixture's fake script could mask a genuinely stale
 * claim in the real doc.
 *
 * Exported so later passes can share one definition rather than drift.
 */
export const IGNORED_DIRS = new Set([
  "test-fixtures",
  "fixtures",
  "__fixtures__",
  "__mocks__",
  "examples",
  ".git",
  ".hg",
  ".svn",
  ".venv",
  "venv",
  ".tox",
  ".mypy_cache",
  ".pytest_cache",
  ".next",
  ".nuxt",
  ".turbo",
  ".cache",
  "node_modules",
  "dist",
  "build",
  "out",
  "target",
  "vendor",
  "coverage",
  "__pycache__",
]);

/** A directory containing one of these is a package root. */
const MANIFESTS = ["package.json", "pyproject.toml", "Cargo.toml", "go.mod"];

const CODE_EXTENSIONS = "ts|tsx|js|jsx|mjs|cjs|py|go|rs";

/** Last-resort entry-point guess when a package declares nothing. */
const ENTRY_BASENAMES = new RegExp(`^(index|main|cli|app|__main__)\\.(${CODE_EXTENSIONS})$`);

/** A token inside a script command that looks like a path to a source file. */
const SCRIPT_PATH = new RegExp(`^[\\w./@-]+\\.(${CODE_EXTENSIONS})$`);

/**
 * Scripts that run tooling over the project rather than starting it. They
 * often name a real file (`screenshots: node scripts/take-screenshots.mjs`),
 * but that file is a dev utility, not a way into the program.
 */
const NON_ENTRY_SCRIPT =
  /^(lint|format|test|coverage|clean|deploy|release|docs?|storybook|screenshots?|prepare|postinstall)/i;

/**
 * How deep to walk. Package roots and entry points live near the top of a
 * repo; going deeper mostly costs time on directories we'd never report.
 */
const MAX_DEPTH = 4;

/**
 * Walk the repo's directory tree and classify its shape.
 *
 * Pure: reads the filesystem only, returns the data. Paths in the result are
 * repo-relative and posix-style (`packages/a`) so output is identical on
 * Windows and POSIX; the repo root itself is reported as `.`.
 */
export async function scanStructure(repoRoot: string): Promise<StructureReport> {
  const packages: string[] = [];
  const conventionFiles: string[] = [];
  const ignoredPaths: string[] = [];

  await walk(repoRoot, ".", 0);
  packages.sort();

  const entryPoints = new Map<string, EntryPoint>();
  for (const pkgDir of packages) {
    for (const entry of await findEntryPoints(
      repoRoot,
      pkgDir,
      conventionFiles,
      packages,
    )) {
      // Keyed by path: if two packages reference the same file, the first
      // (outermost, since `packages` is sorted) owns it.
      if (!entryPoints.has(entry)) {
        entryPoints.set(entry, { path: entry, packagePath: pkgDir });
      }
    }
  }

  return {
    hasWorkspacesDeclared: await hasWorkspaceConfig(repoRoot),
    packages,
    entryPoints: [...entryPoints.values()].sort((a, b) =>
      a.path.localeCompare(b.path),
    ),
    ignoredPaths: ignoredPaths.sort(),
  };

  async function walk(absDir: string, relDir: string, depth: number): Promise<void> {
    let entries;
    try {
      entries = await readdir(absDir, { withFileTypes: true });
    } catch {
      return; // unreadable directory (permissions, race) — skip, don't fail the scan
    }

    const names = new Set(entries.filter((e) => e.isFile()).map((e) => e.name));
    if (MANIFESTS.some((m) => names.has(m))) packages.push(relDir);

    for (const entry of entries) {
      const rel = join(relDir, entry.name);

      // isDirectory() is false for symlinks, which keeps the walk acyclic.
      if (entry.isDirectory()) {
        if (IGNORED_DIRS.has(entry.name)) {
          ignoredPaths.push(rel);
          continue;
        }
        if (depth < MAX_DEPTH) {
          await walk(path.join(absDir, entry.name), rel, depth + 1);
        }
        continue;
      }

      if (entry.isFile() && ENTRY_BASENAMES.test(entry.name)) conventionFiles.push(rel);
    }
  }
}

/**
 * Entry points for a single package, in priority order:
 *
 *   a. `main` / `module` / `bin` fields in package.json — an explicit declaration
 *   b. source paths referenced inside script commands (`tsx watch src/server.ts`)
 *   c. the `<script type="module">` target in index.html (Vite and friends)
 *   d. filename convention (index.*, main.*) — only when a–c found nothing
 *
 * a–c are unioned, since a package can legitimately have several real entries
 * (a server and a CLI, say). (d) is a last resort precisely because it can't
 * tell a program entry from a barrel file that only re-exports types.
 */
async function findEntryPoints(
  repoRoot: string,
  pkgDir: string,
  conventionFiles: string[],
  packages: string[],
): Promise<string[]> {
  const pkgAbs = path.join(repoRoot, pkgDir);
  const pkg = await readJson(path.join(pkgAbs, "package.json"));
  const declared = new Set<string>();

  // (a) explicit manifest fields
  if (pkg) {
    for (const field of [pkg.main, pkg.module]) {
      if (typeof field === "string") declared.add(field);
    }
    if (typeof pkg.bin === "string") declared.add(pkg.bin);
    else if (pkg.bin && typeof pkg.bin === "object") {
      for (const target of Object.values(pkg.bin)) {
        if (typeof target === "string") declared.add(target);
      }
    }

    // (b) paths named inside script commands
    for (const [name, command] of Object.entries(pkg.scripts ?? {})) {
      if (typeof command !== "string" || NON_ENTRY_SCRIPT.test(name)) continue;
      for (const token of command.split(/\s+/)) {
        const cleaned = token.replace(/^['"]|['"]$/g, "");
        if (SCRIPT_PATH.test(cleaned) && !cleaned.startsWith("-")) declared.add(cleaned);
      }
    }
  }

  // (c) the module script an HTML shell boots from
  const html = await readText(path.join(pkgAbs, "index.html"));
  if (html) {
    const match = /<script[^>]*\btype=["']module["'][^>]*\bsrc=["']([^"']+)["']/i.exec(html);
    if (match) declared.add(match[1]);
  }

  const resolved: string[] = [];
  for (const ref of declared) {
    const rel = join(pkgDir, ref.replace(/^\.?\//, ""));
    // Keep only what really exists: an unbuilt `dist/server.js` from a
    // `start` script is a build artifact, not a source entry point.
    if (!isIgnored(rel) && (await fileExists(path.join(repoRoot, rel)))) {
      resolved.push(rel);
    }
  }
  if (resolved.length) return resolved;

  // (d) fallback: convention-named files whose nearest package is this one
  return conventionFiles.filter((file) => nearestPackage(file, packages) === pkgDir);
}

/** The innermost package directory containing `file`. */
function nearestPackage(file: string, packages: string[]): string | undefined {
  return packages
    .filter((pkg) => contains(pkg, file))
    .sort((a, b) => b.length - a.length)[0];
}

function contains(pkgDir: string, file: string): boolean {
  return pkgDir === "." || file.startsWith(`${pkgDir}/`);
}

function isIgnored(rel: string): boolean {
  return rel.split("/").some((segment) => IGNORED_DIRS.has(segment));
}

function join(dir: string, name: string): string {
  return dir === "." ? name : `${dir}/${name}`;
}

/**
 * A declared workspace is a different thing from "this repo happens to contain
 * more than one package", so this checks only for real declarations.
 */
async function hasWorkspaceConfig(repoRoot: string): Promise<boolean> {
  if (await fileExists(path.join(repoRoot, "pnpm-workspace.yaml"))) return true;
  if (await fileExists(path.join(repoRoot, "lerna.json"))) return true;

  const pkg = await readJson(path.join(repoRoot, "package.json"));
  if (pkg?.workspaces) return true;

  const cargo = await readText(path.join(repoRoot, "Cargo.toml"));
  if (cargo && /^\s*\[workspace\]/m.test(cargo)) return true;

  // A go.work file lists multiple modules by definition.
  return fileExists(path.join(repoRoot, "go.work"));
}

async function readText(filePath: string): Promise<string | null> {
  try {
    return await readFile(filePath, "utf8");
  } catch {
    return null;
  }
}

async function readJson(filePath: string): Promise<Record<string, any> | null> {
  const text = await readText(filePath);
  if (text === null) return null;
  try {
    const parsed = JSON.parse(text);
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    return (await stat(filePath)).isFile();
  } catch {
    return false;
  }
}
