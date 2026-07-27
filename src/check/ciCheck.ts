import { runScan } from "../scan/runScan.js";
import type { AmbiguityFlag } from "../types.js";

export interface CheckOptions {
  /** Also fail on "warn" flags. "info" never fails the build. */
  strict?: boolean;
}

export interface CheckResult {
  exitCode: number;
  flags: AmbiguityFlag[];
  /** Human-readable report, printed by the caller regardless of exit code. */
  report: string;
}

const SEVERITIES: AmbiguityFlag["severity"][] = ["error", "warn", "info"];

/**
 * `agent-readiness check` — designed to run in CI.
 *
 * Re-runs the deterministic passes only: no LLM call, so this needs no API
 * key and stays fast enough to run on every push.
 *
 * Returns the exit code rather than calling process.exit, so the decision is
 * testable without spawning a process; the CLI does the exiting.
 */
export async function runCiCheck(
  repoRoot: string,
  options: CheckOptions = {},
): Promise<CheckResult> {
  const { flags } = await runScan(repoRoot);

  const failing = flags.filter(
    (flag) =>
      flag.severity === "error" || (options.strict === true && flag.severity === "warn"),
  );

  return {
    exitCode: failing.length > 0 ? 1 : 0,
    flags,
    report: formatReport(flags, failing.length, options.strict === true),
  };
}

/** Every flag, grouped by severity, so a passing run still shows its warnings. */
function formatReport(
  flags: AmbiguityFlag[],
  failingCount: number,
  strict: boolean,
): string {
  const lines: string[] = [];

  for (const severity of SEVERITIES) {
    const group = flags.filter((flag) => flag.severity === severity);
    if (group.length === 0) continue;
    lines.push(`${severity} (${group.length}):`);
    for (const flag of group) lines.push(`  - ${flag.message}`);
    lines.push("");
  }

  if (flags.length === 0) lines.push("No issues found.", "");

  if (failingCount > 0) {
    lines.push(
      `FAIL — ${failingCount} blocking ${failingCount === 1 ? "issue" : "issues"}` +
        `${strict ? " (strict mode: warnings block)" : ""}.`,
    );
  } else {
    const warnings = flags.filter((f) => f.severity !== "error").length;
    lines.push(
      warnings > 0
        ? `PASS — ${warnings} non-blocking ${warnings === 1 ? "issue" : "issues"}.`
        : "PASS — docs are up to date.",
    );
  }

  return lines.join("\n");
}
