import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import type { ConventionsReport } from "../types.js";

/**
 * Config filenames that identify a tool, matched against the package root's
 * own directory listing. Ordered so the report reads predictably.
 */
const CONFIG_PATTERNS: Array<[tool: string, pattern: RegExp]> = [
  ["eslint", /^\.eslintrc(\.(c?js|mjs|json|ya?ml))?$/],
  ["eslint", /^eslint\.config\.(c?js|mjs|ts|mts)$/],
  ["prettier", /^\.prettierrc(\.(c?js|mjs|json|json5|toml|ya?ml))?$/],
  ["prettier", /^prettier\.config\.(c?js|mjs|ts)$/],
  ["biome", /^biome\.jsonc?$/],
  ["stylelint", /^(\.stylelintrc(\.(c?js|mjs|json|ya?ml))?|stylelint\.config\.(c?js|mjs))$/],
  ["oxlint", /^\.oxlintrc\.json$/],
  ["editorconfig", /^\.editorconfig$/],
  ["ruff", /^\.?ruff\.toml$/],
  ["flake8", /^\.flake8$/],
  ["golangci-lint", /^\.golangci\.(ya?ml|toml|json)$/],
  ["rustfmt", /^\.?rustfmt\.toml$/],
  ["clippy", /^clippy\.toml$/],
];

/** package.json keys that configure a tool inline instead of via a file. */
const PACKAGE_JSON_KEYS: Array<[tool: string, key: string]> = [
  ["eslint", "eslintConfig"],
  ["prettier", "prettier"],
  ["stylelint", "stylelint"],
];

/** pyproject.toml tables that configure a tool inline. */
const PYPROJECT_TABLES: Array<[tool: string, table: string]> = [
  ["ruff", "tool.ruff"],
  ["black", "tool.black"],
  ["isort", "tool.isort"],
  ["flake8", "tool.flake8"],
];

const CONTRIBUTING = /^contributing(\.(md|rst|txt))?$/i;

/**
 * Detect linter/formatter configs and a CONTRIBUTING.md if present, so the
 * generated doc can tell the agent what style rules to follow.
 *
 * Scoped to a single package root — call once per package reported by the
 * structure pass, the same way `scanFingerprint` is. Configs are read from
 * this directory only: a nested package with its own linter must not inherit
 * the root's, since that's exactly the difference the generated doc needs to
 * describe. (Real tools do resolve some configs upward; representing that
 * inheritance is a separate concern from recording what each package declares.)
 *
 * Pure: reads files only, never throws on unreadable or malformed config.
 */
export async function scanConventions(
  packageRoot: string,
  packagePath = ".",
): Promise<ConventionsReport> {
  let names: string[];
  try {
    const entries = await readdir(packageRoot, { withFileTypes: true });
    names = entries.filter((e) => e.isFile()).map((e) => e.name);
  } catch {
    return { packagePath, linters: [], hasContributing: false };
  }

  const linters = new Set<string>();
  for (const [tool, pattern] of CONFIG_PATTERNS) {
    if (names.some((name) => pattern.test(name))) linters.add(tool);
  }

  const pkg = await readJson(path.join(packageRoot, "package.json"));
  if (pkg) {
    for (const [tool, key] of PACKAGE_JSON_KEYS) {
      if (pkg[key]) linters.add(tool);
    }
  }

  const pyproject = await readText(path.join(packageRoot, "pyproject.toml"));
  if (pyproject) {
    for (const [tool, table] of PYPROJECT_TABLES) {
      // Matches both [tool.ruff] and its subtables, e.g. [tool.ruff.lint].
      if (new RegExp(`^\\s*\\[${escapeRegExp(table)}(\\.|\\])`, "m").test(pyproject)) {
        linters.add(tool);
      }
    }
  }

  return {
    packagePath,
    linters: [...linters].sort(),
    hasContributing: await hasContributingDoc(packageRoot, names),
  };
}

/** CONTRIBUTING lives at the package root or, by convention, under .github/. */
async function hasContributingDoc(
  packageRoot: string,
  names: string[],
): Promise<boolean> {
  if (names.some((name) => CONTRIBUTING.test(name))) return true;
  try {
    const github = await readdir(path.join(packageRoot, ".github"), {
      withFileTypes: true,
    });
    return github.some((e) => e.isFile() && CONTRIBUTING.test(e.name));
  } catch {
    return false;
  }
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
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
