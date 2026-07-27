# CLAUDE.md

Context for AI coding agents working in this repo.

## What this project is

A CLI that scans a codebase and reports how ready it is for an AI coding
agent to work in it, then generates/updates a `CLAUDE.md` (this kind of
file) for that codebase. The project is deliberately dogfooding its own
concept — this file is a hand-written v0 of what the tool itself should
eventually be able to produce automatically.

## Structure

- `src/index.ts` — CLI entry point (commander), wires up the three
  subcommands: `scan`, `generate`, `check`.
- `src/scan/` — the deterministic analysis passes. Each file is one pass:
  `fingerprint.ts` (stack + scripts detection), `structure.ts` (folder/
  monorepo mapping), `conventions.ts` (lint/format config detection),
  `existingDocs.ts` (parse + diff current docs), `ambiguity.ts` (rule-based
  flags). These must stay dependency-free of any LLM call — `check` mode
  relies on them being fast and deterministic.
- `src/generate/draftGenerator.ts` — the one place that calls the Claude
  API, to turn the structured scan output into the actual markdown draft.
- `src/check/ciCheck.ts` — re-runs the scan passes and diffs against the
  committed `CLAUDE.md`/`AGENTS.md`, exits non-zero on drift.
- `src/types.ts` — shared types for scan results.

## Running it

```bash
npm install
npm run dev -- scan      # runs src/index.ts directly via tsx, no build step
npm run build             # compiles to dist/
npm test                  # runs the test suite (vitest)
```

## Testing

Each `src/scan/*.ts` pass is tested against fixture repos in
`test-fixtures/`, not against real projects — fixtures are small, checked
into git, and built to exercise a specific case:

- `test-fixtures/simple-node/` — a plain single-package project with a
  lockfile, for the baseline case.
- `test-fixtures/monorepo/` — two nested packages under `packages/`, for
  monorepo detection.
- `test-fixtures/stale-docs/` — a `CLAUDE.md` that claims `npm test` works,
  but `package.json` has no `test` script. This is the fixture that proves
  the existing-docs diff (and therefore `check` mode) actually works.

When implementing a new pass, write or extend its fixture(s) first if the
case isn't covered yet, then implement until the test passes.

## Conventions

- TypeScript, ESM (`"type": "module"` in package.json), strict mode on.
- Each `src/scan/*.ts` file exports one pure function taking a repo root
  path and returning a typed result — no side effects, no I/O beyond
  reading files, so they're easy to unit test in isolation.
- Keep the LLM call isolated to `draftGenerator.ts`. Nothing else in the
  codebase should need an API key to run.

## Current state

All six passes are implemented and tested — `fingerprint`, `structure`,
`conventions`, `existingDocs`, `ambiguity`, and `ciCheck` — along with the
`scan`, `check`, and `generate` commands. 50 tests pass; no stubs remain.

Two safety behaviours are worth knowing before changing `generate`:

- It **refuses to overwrite** an existing `CLAUDE.md`/`AGENTS.md` unless
  `--force` is passed. Generation replaces rather than merges, so an
  implicit write would silently drop hand-written prose. The refusal is
  decided before the model is called, so it costs no tokens.
- The `## Known gaps` section of a generated doc is rebuilt in code from
  `scan.flags` after the model responds. Left to the prompt, the model
  folded flags into surrounding prose. Presence and contents of that
  section must not become model-dependent again.

## Known gaps (update as they close)

- No npm publish workflow — the package is unpublished, so the `npx`
  usage in the README is aspirational and the README says so.
- No GitHub Actions CI workflow. `npm run dev -- check` is built to be the
  CI entry point but nothing runs it automatically yet.
- **Open design decision:** the `generate` prompt never sees the existing
  doc's contents — `ExistingDocsDiff` carries only `docPath` and
  `staleClaims`, never the prose. So generation cannot preserve
  hand-written sections it can't derive from the scan. This is currently
  handled by refusing to overwrite by default rather than by merging.
  Feeding the current doc into the prompt would make `generate` a genuine
  update; it hasn't been done yet.
