# agent-readiness-cli

Scans a repository and tells you how ready it is for an AI coding agent
(Claude Code, Cursor, etc.) to work in it — then generates or updates the
`CLAUDE.md` / `AGENTS.md` context file for you.

> **Status:** not yet published to npm — the `npx` commands below are the
> intended interface, not a working one. To use it today, clone the repo and
> run it locally (see [Local development](#local-development)).

## Why

AI coding agents work best when a repo has a short context file explaining
how to run tests, how the project is structured, and what conventions to
follow. Most repos either don't have one, or have one that's gone stale as
the project changed. This tool scans the repo itself (not an LLM guess) to
find that information and keep the context file honest over time.

## Usage (target v1)

```bash
npx agent-readiness scan          # analyze the current repo, print a report
npx agent-readiness generate      # write CLAUDE.md (refuses if one already exists)
npx agent-readiness generate --diff   # preview the draft without writing
npx agent-readiness generate --force  # replace the existing file
npx agent-readiness check         # CI mode: fail if a documented command is stale
npx agent-readiness check --strict  # also fail on warnings
```

## Local development

The package isn't published yet, so run it from a clone. `npm run dev` executes
`src/index.ts` directly through tsx — no build step.

```bash
npm install
npm run dev -- scan                  # analyze this repo, print a report
npm run dev -- scan ../other-repo    # or point it somewhere else
npm run dev -- generate --diff       # preview a drafted CLAUDE.md
npm run dev -- check                 # exit non-zero if a documented command is stale
npm test                             # vitest
```

Note the `--` before the subcommand: it tells npm to pass the arguments through
to the script rather than consuming them itself.

Only `generate` needs an API key (`ANTHROPIC_API_KEY`) — `scan` and `check` are
fully deterministic and run without one.

If you're extending the tool, `CLAUDE.md` has the current project context and
`docs/claude-code-kickoff-prompt.md` has the prompt used to start implementation.

## How it works

1. **Fingerprint** — detect the stack from `package.json` / `pyproject.toml` /
   `Cargo.toml` / `go.mod`, pull declared scripts (test, build, lint).
2. **Structure** — map the folder tree, detect monorepo vs single package,
   flag ambiguous entry points, identify generated/vendored paths to ignore.
3. **Conventions** — read lint/formatter configs to capture style rules.
4. **Existing docs** — parse any current CLAUDE.md/AGENTS.md and diff its
   **command claims** against the scripts steps 1–3 actually found. Scope is
   deliberately narrow: it extracts commands from fenced code blocks and
   inline code spans (`npm test`, `yarn build`) and reports a claim as stale
   when no package in the repo declares that script. Prose claims — about
   folder structure, conventions, or anything else — are **not** verified,
   so a doc can pass `check` and still describe the layout incorrectly.
5. **Ambiguity flags** — rule-based checks (no lockfile, no test command,
   multiple plausible entry points, etc.).
6. **Draft generation** — only this step calls an LLM, to turn the structured
   findings into readable prose. Steps 1–5 are deterministic, which is what
   makes `check` mode fast enough to run in CI without an API call.

### On "update"

Generation **replaces** the file; it does not merge. The draft is written from
the scan alone and never sees the prose already in your `CLAUDE.md`, so
anything hand-written that the scan can't derive — design rationale, known
gaps, team conventions — would be lost. "Update" here means *regenerate after
reviewing the diff*, not *intelligently merge*.

Because of that, `generate` refuses to write when a `CLAUDE.md` or `AGENTS.md`
already exists. Preview with `--diff`, then opt in with `--force`. When no doc
exists there is nothing to clobber, so plain `generate` writes one.

The "Known gaps" section is generated deterministically from the scan and
always accurate; surrounding prose is model-written and, while instructed to
stay consistent with it, is not independently verified.

## Testing

```bash
npm test
```

Each scan pass has tests against small fixture repos in `test-fixtures/`
(a plain project, a monorepo, and a project with a deliberately stale
`CLAUDE.md`) rather than against real-world repos — so tests stay fast,
deterministic, and don't depend on anything outside this repository.

## License

MIT
