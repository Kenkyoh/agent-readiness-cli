import path from "node:path";
import { computeAmbiguityFlags } from "./ambiguity.js";
import { scanConventions } from "./conventions.js";
import { scanExistingDocs } from "./existingDocs.js";
import { scanFingerprint } from "./fingerprint.js";
import { scanStructure } from "./structure.js";
import type { ScanResult } from "../types.js";

/**
 * Run every deterministic pass and assemble the full ScanResult.
 *
 * Structure runs first because it decides which package roots exist; the
 * per-package passes then run once per package. No LLM call happens here —
 * `check` depends on this being fast and key-free.
 */
export async function runScan(repoRoot: string): Promise<ScanResult> {
  const structure = await scanStructure(repoRoot);
  const [fingerprints, conventions] = await Promise.all([
    Promise.all(
      structure.packages.map((pkg) => scanFingerprint(path.join(repoRoot, pkg), pkg)),
    ),
    Promise.all(
      structure.packages.map((pkg) => scanConventions(path.join(repoRoot, pkg), pkg)),
    ),
  ]);
  const existingDocs = await scanExistingDocs(repoRoot, fingerprints, structure);
  const flags = computeAmbiguityFlags(
    fingerprints,
    structure,
    conventions,
    existingDocs,
  );

  return { fingerprints, structure, conventions, existingDocs, flags };
}
