# First prompt to give Claude Code

Paste this after running `claude` inside the project folder. It's scoped to
one pass at a time on purpose — implementing all six passes in one shot
tends to produce shakier code than doing them one at a time and testing
each against a real repo before moving on.

---

```
I'm building a CLI (see CLAUDE.md and README.md for the full spec) that
scans a repo and reports how ready it is for an AI coding agent, then
generates/updates a CLAUDE.md file.

Start with just the fingerprint pass: implement src/scan/fingerprint.ts.
It should read package.json (and check for pyproject.toml/Cargo.toml/go.mod
as fallbacks, but package.json is the priority case for now), detect the
package manager from which lockfile is present, and return the Fingerprint
type from src/types.ts with the declared scripts pulled out.

There's already a test file at src/scan/fingerprint.test.ts that runs
against fixtures in test-fixtures/ (simple-node and stale-docs). Run
`npm test` after implementing — get both tests in that file passing before
we move to the next pass.
```

---

## Suggested build order after that

1. `fingerprint.ts` (above) — tests already exist in `fingerprint.test.ts`.
2. `structure.ts` — tests already exist in `structure.test.ts`, using the
   `test-fixtures/monorepo` fixture for the monorepo-detection case.
3. `conventions.ts` — no test file yet; ask Claude Code to write one first
   (add a fixture with an `.eslintrc` if needed), then implement against it.
4. `existingDocs.ts` — tests already exist in `existingDocs.test.ts`, using
   `test-fixtures/stale-docs` to confirm the diff logic actually catches a
   claim that doesn't match reality. This is the most important one to get
   right, since `check` mode depends entirely on it.
5. `ambiguity.ts` — once 1–4 return real data, this is mostly wiring rules
   together; low risk. Add a test file covering at least: no lockfile,
   missing test script, and a stale claim from step 4.
6. Wire `scan` in `src/index.ts` to run 1–5 and print a report — get this
   fully working and tested before touching the LLM step at all.
7. `draftGenerator.ts` — the one pass that needs `ANTHROPIC_API_KEY` set.
   Test manually against a real repo (this one's output is prose, harder
   to assert on automatically) — read the draft and check it's accurate.
8. Wire `generate` in `src/index.ts`, including `--diff` mode.
9. `ciCheck.ts` + wire `check` — reuses 1–5, no new logic beyond the
   pass/fail decision. Add a test that runs it against `test-fixtures/
   stale-docs` and asserts it fails (non-zero), and against `simple-node`
   and asserts it passes.

Each step: implement, ask Claude Code to run it against a real folder, look
at the actual output, fix what's wrong before moving on. That loop is where
Claude Code earns its keep over writing this by hand.

## After the passes work: getting it adopted

- Push to GitHub, write the before/after example in the README (a messy
  repo's generated CLAUDE.md is more convincing than any description).
- `npm publish` once `generate` and `check` both work end to end.
- Add a GitHub Actions workflow to this repo itself that runs
  `agent-readiness check` on every PR — dogfooding it is the best proof
  it works.
