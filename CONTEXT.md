# claude-mods

Personal Claude Code mods, kept in this repo and loaded into sessions straight from the working tree.

## Language

**Mod**:
A function-hook plugin living in `mods/<name>/` of this repo.
_Avoid_: plugin (when you mean one of ours), extension

**Installed set**:
The mods of this repo that Claude Code sessions load, as recorded in `CLAUDE_CODE_PLUGIN_DIRS`.
_Avoid_: enabled mods, active mods

**Repo entry**:
A `CLAUDE_CODE_PLUGIN_DIRS` entry that points at a mod folder of this repo; together they make up the installed set.

**Foreign entry**:
A `CLAUDE_CODE_PLUGIN_DIRS` entry that is not a repo entry — another repo's plugin or any other folder — even if its folder name matches a mod.
_Avoid_: unrelated entry, external entry

**Dead entry**:
A repo entry whose mod no longer exists in the repo (deleted or renamed). It stays in the installed set until it is uninstalled.
_Avoid_: stale entry, orphan
