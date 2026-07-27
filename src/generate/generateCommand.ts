import path from "node:path";
import type { ScanResult } from "../types.js";

export interface GenerateOptions {
  /** Print the draft instead of writing it. */
  diff?: boolean;
  /** Permit overwriting an existing doc. Only meaningful when one exists. */
  force?: boolean;
}

/** Injected so the decision logic is testable without an API key or disk I/O. */
export interface GenerateDeps {
  scan: (repoRoot: string) => Promise<ScanResult>;
  draft: (scan: ScanResult) => Promise<string>;
  write: (filePath: string, contents: string) => Promise<void>;
}

export interface GenerateOutcome {
  action: "written" | "printed" | "refused";
  /** Repo-relative path that was written, or that the refusal is about. */
  docPath?: string;
  /** Message for the user. The caller prints it. */
  message?: string;
  /** The generated markdown, when one was produced. */
  draft?: string;
}

/**
 * Decide what `generate` should do, and do it.
 *
 * Generation is a replacement, not a merge: the draft is written from the scan
 * alone and has no knowledge of whatever prose the existing doc holds. So an
 * existing doc is never overwritten implicitly — the user reviews with --diff
 * and then opts in with --force. Creating a doc where none exists clobbers
 * nothing and needs no flag.
 *
 * A refusal short-circuits before `draft` is called, so it costs no API tokens.
 */
export async function runGenerate(
  repoRoot: string,
  options: GenerateOptions,
  deps: GenerateDeps,
): Promise<GenerateOutcome> {
  const scan = await deps.scan(repoRoot);
  const existing = scan.existingDocs.docPath;

  if (existing !== null && options.diff !== true && options.force !== true) {
    return {
      action: "refused",
      docPath: existing,
      message:
        `Refusing to overwrite ${existing}: the draft is generated from the scan ` +
        `alone and does not merge in anything already written there.\n` +
        `  Rerun with --diff to preview the draft, then --force to replace the file.`,
    };
  }

  const draft = await deps.draft(scan);

  if (options.diff === true) {
    return { action: "printed", docPath: existing ?? undefined, draft };
  }

  const target = existing ?? "CLAUDE.md";
  await deps.write(path.join(repoRoot, target), `${draft}\n`);
  return { action: "written", docPath: target, draft, message: `Wrote ${target}` };
}
