# claude-mods

Personal Claude Code mods (function-hook plugins).

## Mods

### issue

Start work on a GitHub issue without leaving the prompt. Needs the `gh` CLI,
logged in, and a session started inside the repo.

- `/issue 33` fetches issue #33 and puts a prompt in the input box:
  *Work on GitHub issue #33: <title>. Commit with "Closes #33" in the message.*
  Press Enter to send it, or edit it first.
- The issue's text goes to the model along with that prompt: title, state,
  labels, body and comments, cut at 20k characters. The model doesn't need to
  run `gh issue view` itself. This only happens when the next prompt you send
  still mentions `#33` (not `#330` or `other/repo#33`); otherwise the issue
  is dropped. Messages from peer sessions, schedules or other plugins don't
  count as your next prompt.
- `/issue` with no number opens a pane listing up to 50 open issues. Press 1–9
  or select an issue to load it the same way. **Refresh** (`r`) reloads the
  list, and **Close** closes the pane.

### push-band

A one-line bar above the prompt that appears when your current branch has
commits that haven't been pushed to its upstream branch:

```
↑ 2 commits on main not pushed · abc1234 docs: tidy glossary  [ Push ] [ Later ]
```

- `p` (or **Push**) runs `git push`. On success you get a toast and the bar
  goes away. On failure the last line of git's error appears under the bar,
  until you push again or make another commit.
- `l` (or **Later**) hides the bar until you make another commit.
- It checks when the session starts and after each turn finishes. The bar
  stays hidden while Claude is working.

## Layout

Each mod lives in `mods/<name>/`:

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
- **Deleting or renaming a mod** leaves a dead entry in the setting. `bin/mods`
  keeps it and warns about it, and `list` shows it as `missing`, until you run
  `bin/mods uninstall <old-name>`.

The words used here (installed set, repo entry, foreign entry, dead entry) are
defined in [CONTEXT.md](CONTEXT.md). `tests/bin-mods.sh` tests this against a
throwaway settings file. The pre-commit hook runs it when `bin/` or `tests/`
changes.

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
