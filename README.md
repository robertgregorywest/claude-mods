# claude-mods

Personal Claude Code mods (function-hook plugins). Each lives in `mods/<name>/`:

```
mods/<name>/
  .claude-plugin/plugin.json   manifest (+ "types" if the mod uses $.state)
  hooks/hooks.json             { "modules": ["./register.tsx"] }
  hooks/register.tsx           the hooks module
  hooks/*.test.ts(x)           tests, run by `claude plugin test`
  types/index.d.ts             $.state contract (optional)
  tsconfig.json                extends the engine-laid .claude-plugin/types/tsconfig.json
```

## Install

```sh
bin/mods install            # all mods
bin/mods install issue      # just one (added to what's already installed)
bin/mods uninstall push-band
bin/mods list
```

Install doesn't copy anything. It points `CLAUDE_CODE_PLUGIN_DIRS` in
`~/.claude/settings.json` at the folders in this repo (keeping any unrelated
entries, and backing the file up to `settings.json.mods-bak`). So:

- **Updating** = editing files here, or `git pull`. Interactive sessions watch
  these folders and hot-reload a mod when its files are saved.
- **Adding a new mod** to the list needs a session restart, since the env var is
  read at startup.

## Test loop

1. `bin/mods new <name> "description"` to scaffold.
2. Write the module and its tests. Ask Claude to load the `plugin-authoring` skill
   first: it has the API types and examples.
3. `bin/mods check <name>` runs `claude plugin validate`, `tsc` and
   `claude plugin test`. tsc is skipped until the engine has loaded the mod once,
   because that load writes `.claude-plugin/types/` (gitignored).
4. Try it live:
   - `bin/mods try <name>` starts a one-off `claude --plugin-dir` session with only
     that mod, without installing it.
   - Or install it. From then on every save reloads it in running sessions, and
     failures show as a dim line in the transcript (`claude --debug` gives more).
5. Commit. The pre-commit hook (`.githooks/`, enabled with
   `git config core.hooksPath .githooks`) runs `bin/mods check` on every mod the
   commit touches.

Because installed mods load straight from the working tree, a half-finished edit
reaches your real sessions as soon as you save it. For risky changes, use a
branch plus `bin/mods try`, or a worktree.
