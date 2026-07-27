#!/usr/bin/env node
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { Command } from "commander";
import { runCiCheck } from "./check/ciCheck.js";
import { buildPrompt, generateDraft } from "./generate/draftGenerator.js";
import { runGenerate } from "./generate/generateCommand.js";
import { runScan } from "./scan/runScan.js";

const program = new Command();

program
  .name("agent-readiness")
  .description("Scan a repo for AI-agent readiness and manage its CLAUDE.md")
  .version("0.1.0");

program
  .command("scan")
  .description("Analyze a repo and print a readiness report")
  .argument("[path]", "repo to scan", ".")
  .action(async (target: string) => {
    const repoRoot = path.resolve(target);
    const { fingerprints, structure, conventions, existingDocs, flags } =
      await runScan(repoRoot);
    const conventionsByPath = new Map(conventions.map((c) => [c.packagePath, c]));

    const list = (items: string[]) =>
      items.length ? items.map((i) => `  - ${i}`).join("\n") : "  (none)";

    console.log(`\n${repoRoot}\n`);
    for (const fingerprint of fingerprints) {
      console.log(`Package [${fingerprint.packagePath}]`);
      console.log(`  language:       ${fingerprint.language}`);
      console.log(`  packageManager: ${fingerprint.packageManager ?? "unknown"}`);
      console.log(`  lockfile:       ${fingerprint.hasLockfile ? "yes" : "no"}`);
      console.log("  scripts:");
      console.log(
        Object.entries(fingerprint.scripts).length
          ? Object.entries(fingerprint.scripts)
              .map(([name, cmd]) => `    ${name}: ${cmd}`)
              .join("\n")
          : "    (none)",
      );

      const packageConventions = conventionsByPath.get(fingerprint.packagePath);
      console.log(
        `  linters:        ${
          packageConventions?.linters.length
            ? packageConventions.linters.join(", ")
            : "(none)"
        }`,
      );
      console.log(
        `  contributing:   ${packageConventions?.hasContributing ? "yes" : "no"}`,
      );
      console.log("");
    }

    console.log("Structure");
    console.log(
      `  workspaces declared: ${structure.hasWorkspacesDeclared ? "yes" : "no"}`,
    );
    console.log(`  packages (${structure.packages.length}):`);
    console.log(list(structure.packages));
    console.log(`  entry points (${structure.entryPoints.length}):`);
    console.log(
      list(structure.entryPoints.map((e) => `${e.path}  [${e.packagePath}]`)),
    );
    console.log(`  ignored (${structure.ignoredPaths.length}):`);
    console.log(list(structure.ignoredPaths));

    console.log("\nExisting docs");
    console.log(`  doc: ${existingDocs.docPath ?? "(none found)"}`);
    console.log(`  stale claims (${existingDocs.staleClaims.length}):`);
    console.log(list(existingDocs.staleClaims));

    console.log(`\nFlags (${flags.length}):`);
    console.log(
      list(flags.map((flag) => `[${flag.severity}] ${flag.message}`)),
    );
    console.log("");
  });

program
  .command("generate")
  .description("Draft or update CLAUDE.md based on the scan")
  .argument("[path]", "repo to document", ".")
  .option("--diff", "print the draft instead of writing the file")
  .option("--force", "overwrite an existing CLAUDE.md/AGENTS.md")
  .option("--print-prompt", "print the prompt that would be sent, without calling the API")
  .action(
    async (
      target: string,
      options: { diff?: boolean; force?: boolean; printPrompt?: boolean },
    ) => {
      const repoRoot = path.resolve(target);

      if (options.printPrompt === true) {
        console.log(buildPrompt(await runScan(repoRoot)));
        return;
      }

      const outcome = await runGenerate(repoRoot, options, {
        scan: runScan,
        draft: generateDraft,
        write: (filePath, contents) => writeFile(filePath, contents, "utf8"),
      });

      if (outcome.action === "printed") console.log(outcome.draft);
      if (outcome.message) console.log(outcome.message);
      if (outcome.action === "refused") process.exitCode = 1;
    },
  );

program
  .command("check")
  .description("CI mode: exit non-zero if CLAUDE.md has drifted from reality")
  .argument("[path]", "repo to check", ".")
  .option("--strict", "also fail on warnings (info flags never fail)")
  .action(async (target: string, options: { strict?: boolean }) => {
    const result = await runCiCheck(path.resolve(target), {
      strict: options.strict === true,
    });
    console.log(`\n${result.report}\n`);
    process.exitCode = result.exitCode;
  });

program.parse();
