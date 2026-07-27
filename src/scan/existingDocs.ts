import { readFile } from "node:fs/promises";
import path from "node:path";
import type { ExistingDocsDiff, Fingerprint, StructureReport } from "../types.js";

/** Docs to look for, in preference order. Root only — see the note below. */
const DOC_NAMES = ["CLAUDE.md", "AGENTS.md"];

/** Package-manager runners whose arguments name a declared script. */
const RUNNERS = new Set(["npm", "pnpm", "yarn", "bun"]);

/**
 * Runner subcommands that are built into the tool rather than names of
 * scripts, so a doc mentioning them is claiming nothing we can check.
 */
const BUILTIN_SUBCOMMANDS = new Set([
  "install", "i", "ci", "add", "remove", "rm", "uninstall", "up", "upgrade",
  "update", "init", "create", "publish", "pack", "link", "unlink", "audit",
  "outdated", "why", "dlx", "exec", "dedupe", "prune", "rebuild", "version",
  "view", "ls", "list", "cache", "config", "login", "logout", "whoami",
]);

/**
 * Parse any existing CLAUDE.md / AGENTS.md and diff its claims against what
 * the other scan passes actually found — this is the core of `check` mode.
 *
 * Only the repo root is checked: a single top-level context file is the
 * convention, and there's no evidence yet that per-package docs need
 * modelling the way per-package fingerprints and conventions did.
 *
 * A claim is stale only when NO package declares that script — in a
 * multi-package repo a doc may legitimately document a nested package's
 * command, which the root manifest knows nothing about.
 *
 * Deterministic and LLM-free, so `check` mode stays fast enough for CI.
 */
export async function scanExistingDocs(
  repoRoot: string,
  fingerprints: Fingerprint[],
  structure: StructureReport
): Promise<ExistingDocsDiff> {
  let docPath: string | null = null;
  let doc: string | null = null;

  for (const name of DOC_NAMES) {
    const text = await readText(path.join(repoRoot, name));
    if (text !== null) {
      docPath = name;
      doc = text;
      break;
    }
  }

  if (doc === null) return { docPath: null, staleClaims: [] };

  const declared = new Set<string>();
  for (const fingerprint of fingerprints) {
    for (const script of Object.keys(fingerprint.scripts)) declared.add(script);
  }

  const staleClaims: string[] = [];
  for (const claim of extractCommands(doc)) {
    const script = scriptNameOf(claim);
    // Unverifiable claims (`docker compose up`, `pytest`) are left alone:
    // absence from package.json says nothing about whether they work.
    if (script !== null && !declared.has(script)) staleClaims.push(claim);
  }

  return { docPath, staleClaims: [...new Set(staleClaims)] };
}

/**
 * Pull command-like strings out of a markdown doc: fenced code blocks (one
 * command per line) and inline code spans, which is how short commands like
 * `npm test` are usually written mid-sentence.
 */
function extractCommands(doc: string): string[] {
  const commands: string[] = [];

  const fenced = doc.replace(/```[^\n]*\n([\s\S]*?)```/g, (_match, body: string) => {
    for (const line of body.split(/\r?\n/)) commands.push(line);
    return "\n"; // drop the block so its lines aren't re-read as inline spans
  });

  for (const match of fenced.matchAll(/`([^`\n]+)`/g)) commands.push(match[1]);

  return commands
    .map((line) => line.trim().replace(/^\$\s*/, "")) // strip shell prompts
    .filter((line) => line.length > 0 && !line.startsWith("#"));
}

/**
 * The script name a command claims to run, or null if the command isn't a
 * package-manager script invocation we can verify.
 */
function scriptNameOf(command: string): string | null {
  const tokens = command
    .split(/\s+/)
    .filter((token) => !token.startsWith("-")); // drop flags: --workspace, -w

  const [runner, ...rest] = tokens;
  if (!runner || !RUNNERS.has(runner)) return null;

  // `npm run build` names the script explicitly; `npm test` / `yarn build`
  // name it directly as the subcommand.
  const subcommand = rest[0] === "run" ? rest[1] : rest[0];
  if (!subcommand || BUILTIN_SUBCOMMANDS.has(subcommand)) return null;

  return subcommand;
}

async function readText(filePath: string): Promise<string | null> {
  try {
    return await readFile(filePath, "utf8");
  } catch {
    return null;
  }
}
