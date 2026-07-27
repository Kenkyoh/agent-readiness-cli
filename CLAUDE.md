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

## Known gaps (update as they close)

- `existingDocs.ts`, `ambiguity.ts`, `ciCheck.ts` are stubs — their tests
  exist and currently fail (`not implemented`) until implemented.
- No packaging/publish workflow yet.
