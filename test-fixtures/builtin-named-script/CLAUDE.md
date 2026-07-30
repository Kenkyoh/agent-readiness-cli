# CLAUDE.md

This fixture's scripts share names with npm's own subcommands.

```bash
npm publish
npm run publish
npm run version
```

`npm publish` is the built-in command and is unverifiable. `npm run publish`
can only mean a script, and no such script exists — it must be stale.
`npm run version` matches the declared `version` script and must not be.
