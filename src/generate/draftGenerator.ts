import Anthropic from "@anthropic-ai/sdk";
import type { AmbiguityFlag, ScanResult } from "../types.js";

// Sonnet is the right tier here: drafting prose from an already-structured
// scan doesn't need Opus-level reasoning, and `generate` is run repeatedly.
const MODEL = "claude-sonnet-5";

/**
 * The ONLY place in this codebase that should call the Claude API.
 * Takes the structured, deterministic scan result and turns it into
 * readable CLAUDE.md / AGENTS.md prose.
 *
 * Throws if ANTHROPIC_API_KEY is unset rather than failing at request time —
 * every other pass runs without a key, so this is the one place the user
 * needs to be told.
 */
export async function generateDraft(scan: ScanResult): Promise<string> {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error(
      "ANTHROPIC_API_KEY is not set. `generate` is the only command that " +
        "calls the Claude API — `scan` and `check` run without one.",
    );
  }

  const client = new Anthropic();
  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 16000,
    system: SYSTEM_PROMPT,
    messages: [{ role: "user", content: buildPrompt(scan) }],
  });

  const draft = response.content
    .filter((block): block is Anthropic.TextBlock => block.type === "text")
    .map((block) => block.text)
    .join("")
    .trim();

  return applyKnownGaps(draft, scan.flags);
}

const KNOWN_GAPS_HEADING = "## Known gaps";
const HEADING = /^#{1,6}\s/;
const KNOWN_GAPS = /^#{1,6}\s+known gaps\s*$/i;

/**
 * Replace the draft's "Known gaps" section with one built directly from the
 * flags, or append it if the model omitted it.
 *
 * The flags are the scan's findings, so they must not be filtered, reworded,
 * or quietly folded into surrounding prose by the model — on a repo with
 * several warnings that would bury exactly what the tool exists to surface.
 * The system prompt still asks for the section, but only so the surrounding
 * prose reads as though it belongs; presence and contents are decided here.
 *
 * With no flags there is nothing to report, so any section the model invented
 * is removed rather than left as an unfounded claim.
 */
export function applyKnownGaps(draft: string, flags: AmbiguityFlag[]): string {
  const lines = draft.split(/\r?\n/);
  const start = lines.findIndex((line) => KNOWN_GAPS.test(line.trim()));

  if (start !== -1) {
    // Section runs until the next heading of any level, or end of document.
    let end = lines.length;
    for (let i = start + 1; i < lines.length; i++) {
      if (HEADING.test(lines[i])) {
        end = i;
        break;
      }
    }
    const replacement = flags.length ? [...renderKnownGaps(flags), ""] : [];
    lines.splice(start, end - start, ...replacement);
    return lines.join("\n").trimEnd();
  }

  if (flags.length === 0) return draft;
  return [draft.trimEnd(), "", ...renderKnownGaps(flags)].join("\n");
}

function renderKnownGaps(flags: AmbiguityFlag[]): string[] {
  return [
    KNOWN_GAPS_HEADING,
    "",
    ...flags.map((flag) => `- [${flag.severity}] ${flag.message}`),
  ];
}

/**
 * The document's shape is load-bearing, not cosmetic. Commands must land in
 * fenced code blocks because that is what `existingDocs.ts` extracts and
 * `check` verifies — prose describing a command is invisible to the checker.
 * Structure and conventions are prose precisely because nothing verifies them,
 * and the doc says so rather than implying the whole file is kept honest.
 */
const SYSTEM_PROMPT = `You write CLAUDE.md context files: the short document an
AI coding agent reads before working in an unfamiliar repository.

You are given the output of a deterministic scan of the repo. Everything in it
was read from the filesystem — treat it as ground truth. Never invent a script,
path, package, or tool that does not appear in the scan, and never soften a
reported gap into a claim that something exists.

Structure the document exactly like this:

# CLAUDE.md

One or two sentences on what the project is, inferred only from what the scan
shows (package names, entry points, structure). If the scan does not support a
confident description, say what the layout suggests rather than guessing at
purpose.

## Running it

Every command in a fenced \`\`\`bash block, one command per line, written the way
a user would type it (\`npm test\`, \`npm run build\`). Only commands backed by a
script in the scan. In a multi-package repo, use a separate fenced block per
package with a short line above it naming the package. These blocks are checked
against the manifests automatically, so a command that is not in the scan will
be reported as stale.

## Structure

Prose describing the layout: packages, where entry points live, which
directories are ignored. Begin this section with the line:

> The sections below are descriptive and are not automatically verified.

## Conventions

Prose covering the linters and formatters the scan found, per package if they
differ. If none were found, say so plainly — that absence is useful to an agent.

## Known gaps

A short bullet list of the scan's flags, phrased as what an agent should watch
out for. Omit the section entirely if there are no flags.

Write plainly and briefly. No preamble, no closing summary — output only the
markdown document.`;

/**
 * Flatten the scan into labelled bullets. Passing raw JSON would make the
 * model infer the schema before it could use it, and would bury the flags.
 */
export function buildPrompt(scan: ScanResult): string {
  const lines: string[] = ["# Scan results", ""];

  lines.push(
    `Packages found: ${scan.structure.packages.length}`,
    `Workspace declared: ${scan.structure.hasWorkspacesDeclared ? "yes" : "no"}`,
    "",
  );

  const conventionsByPath = new Map(
    scan.conventions.map((report) => [report.packagePath, report]),
  );

  for (const fingerprint of scan.fingerprints) {
    const label = fingerprint.packagePath === "." ? "repo root" : fingerprint.packagePath;
    lines.push(`## Package: ${label}`);
    lines.push(`- Language: ${fingerprint.language}`);
    lines.push(`- Package manager: ${fingerprint.packageManager ?? "unknown"}`);
    lines.push(`- Lockfile committed: ${fingerprint.hasLockfile ? "yes" : "no"}`);

    const scripts = Object.entries(fingerprint.scripts);
    if (scripts.length) {
      lines.push("- Declared scripts (the only commands you may document):");
      for (const [name, command] of scripts) {
        lines.push(`    - \`${name}\` runs \`${command}\``);
      }
    } else {
      lines.push("- Declared scripts: none");
    }

    const entries = scan.structure.entryPoints.filter(
      (entry) => entry.packagePath === fingerprint.packagePath,
    );
    lines.push(
      `- Entry points: ${entries.length ? entries.map((e) => e.path).join(", ") : "none detected"}`,
    );

    const conventions = conventionsByPath.get(fingerprint.packagePath);
    lines.push(
      `- Linters/formatters: ${
        conventions?.linters.length ? conventions.linters.join(", ") : "none detected"
      }`,
      `- CONTRIBUTING doc: ${conventions?.hasContributing ? "present" : "absent"}`,
      "",
    );
  }

  lines.push("## Ignored directories");
  lines.push(
    scan.structure.ignoredPaths.length
      ? scan.structure.ignoredPaths.map((p) => `- ${p}`).join("\n")
      : "- none",
  );
  lines.push("");

  lines.push("## Existing context doc");
  lines.push(
    scan.existingDocs.docPath
      ? `- Found at ${scan.existingDocs.docPath}`
      : "- None found; this draft will be the repo's first.",
  );
  for (const claim of scan.existingDocs.staleClaims) {
    lines.push(`- Stale claim to drop or correct: \`${claim}\``);
  }
  lines.push("");

  if (scan.flags.length) {
    lines.push("## Flags raised by the scan");
    for (const flag of scan.flags) {
      lines.push(`- [${flag.severity}] ${flag.message}`);
    }
    lines.push("");
  }

  lines.push("Write the CLAUDE.md for this repository.");
  return lines.join("\n");
}
