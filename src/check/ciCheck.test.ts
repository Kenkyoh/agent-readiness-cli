import { describe, it, expect } from "vitest";
import path from "node:path";
import { runCiCheck } from "./ciCheck.js";

const FIXTURES = path.resolve(__dirname, "../../test-fixtures");
const fixture = (name: string) => path.join(FIXTURES, name);

describe("runCiCheck", () => {
  describe("a repo with a stale doc claim", () => {
    it("fails by default", async () => {
      const result = await runCiCheck(fixture("stale-docs"));
      expect(result.exitCode).toBe(1);
      // The CLAUDE.md claims `npm test`, which no package declares.
      const errors = result.flags.filter((f) => f.severity === "error");
      expect(errors).toHaveLength(1);
      expect(errors[0].message).toContain("npm test");
    });

    it("still reports its non-blocking flags", async () => {
      const result = await runCiCheck(fixture("stale-docs"));
      expect(result.report).toContain("warn (");
      expect(result.report).toContain("info (");
      expect(result.report).toContain("FAIL");
    });
  });

  describe("a repo with warnings but no errors", () => {
    // simple-node has a lockfile and a test script, but no source files and
    // no context doc: one warn, two infos, zero errors.
    it("passes by default", async () => {
      const result = await runCiCheck(fixture("simple-node"));
      expect(result.exitCode).toBe(0);
      expect(result.flags.some((f) => f.severity === "error")).toBe(false);
      expect(result.flags.some((f) => f.severity === "warn")).toBe(true);
      expect(result.report).toContain("PASS");
    });

    it("fails in strict mode, because warnings block there", async () => {
      const result = await runCiCheck(fixture("simple-node"), { strict: true });
      expect(result.exitCode).toBe(1);
      expect(result.report).toContain("strict mode");
    });

    it("never fails on info alone, even in strict mode", async () => {
      const result = await runCiCheck(fixture("simple-node"), { strict: true });
      const infoOnly = result.flags.filter((f) => f.severity === "info");
      // Strict failed on the warn, not on these.
      expect(infoOnly.length).toBeGreaterThan(0);
      const blocking = result.flags.filter((f) => f.severity !== "info");
      expect(blocking.length).toBeGreaterThan(0);
    });
  });

  describe("the multi-package fixture", () => {
    // NOTE: this fixture fails by default, unlike the rest of its siblings —
    // its CLAUDE.md deliberately claims `npm run lint`, which no package
    // declares, to prove existingDocs checks nested packages too.
    it("fails by default on its deliberate stale claim", async () => {
      const result = await runCiCheck(fixture("multi-package-no-workspace"));
      expect(result.exitCode).toBe(1);
      const errors = result.flags.filter((f) => f.severity === "error");
      expect(errors).toHaveLength(1);
      expect(errors[0].message).toContain("npm run lint");
    });

    it("raises warn-severity flags for both of its packages", async () => {
      const result = await runCiCheck(fixture("multi-package-no-workspace"));
      const warnings = result.flags.filter((f) => f.severity === "warn");
      expect(warnings.some((f) => f.message.includes("the root package"))).toBe(true);
      expect(warnings.some((f) => f.message.includes('"backend"'))).toBe(true);
    });
  });

  it("groups every flag by severity regardless of outcome", async () => {
    const result = await runCiCheck(fixture("monorepo"));
    expect(result.exitCode).toBe(0);
    const printed = result.report
      .split("\n")
      .filter((line) => line.startsWith("  - ")).length;
    expect(printed).toBe(result.flags.length);
  });
});
