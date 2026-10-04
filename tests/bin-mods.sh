#!/usr/bin/env bash
# Tests for bin/mods' installed set, against a throwaway settings file and mods
# folder (CLAUDE_SETTINGS / CLAUDE_MODS_DIR). Your real settings are not touched.
set -uo pipefail

BIN="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/bin/mods"
failures=0

setup() {
  T="$(mktemp -d)"
  M="$T/mods"
  S="$T/settings.json"
  for m in issue push-band; do
    mkdir -p "$M/$m/.claude-plugin"
    echo "{\"name\":\"$m\",\"description\":\"the $m mod\"}" > "$M/$m/.claude-plugin/plugin.json"
  done
}

settings() { jq -n --arg v "$1" '{theme: "dark", env: {CLAUDE_CODE_PLUGIN_DIRS: $v}}' > "$S"; }

mods() { HOME="$T" CLAUDE_SETTINGS="$S" CLAUDE_MODS_DIR="$M" "$BIN" "$@"; }

dirs() { jq -r '.env.CLAUDE_CODE_PLUGIN_DIRS // "<unset>"' "$S"; }

check() { # check <description> <actual> <expected>
  [[ "$2" == "$3" ]] && return
  echo "  FAIL $current: $1"
  echo "       expected: $3"
  echo "       actual:   $2"
  failures=$((failures + 1))
}

ok() { # ok <description> <command...>: command must succeed
  local d="$1"; shift
  "$@" >/dev/null 2>&1 || { echo "  FAIL $current: $d"; failures=$((failures + 1)); }
}

test_install_into_missing_settings() {
  mods install >/dev/null
  check "dirs" "$(dirs)" "$M/issue:$M/push-band"
  check "function hooks" "$(jq -r .env.CLAUDE_CODE_ENABLE_FUNCTION_HOOKS "$S")" 1
  check "no backup of a file that didn't exist" "$([[ -e "$S.mods-bak" ]] && echo yes || echo no)" no
}

test_install_keeps_foreign_entries_first_in_order() {
  settings "$M/push-band:/opt/b:/opt/a"
  mods install issue >/dev/null
  check "dirs" "$(dirs)" "/opt/b:/opt/a:$M/issue:$M/push-band"
  check "other settings kept" "$(jq -r .theme "$S")" dark
}

test_repeat_install_is_a_no_op() {
  settings "/opt/a"
  cp "$S" "$T/original"
  mods install issue >/dev/null
  cp "$S" "$T/after-first"
  check "second run says unchanged" "$(mods install issue | head -1)" "CLAUDE_CODE_PLUGIN_DIRS unchanged"
  ok "settings unchanged" cmp "$S" "$T/after-first"
  ok "backup still holds the original" cmp "$S.mods-bak" "$T/original"
}

test_foreign_entry_with_a_mod_name_survives() {
  settings "/elsewhere/issue:$M/push-band"
  mods install issue >/dev/null
  check "after install" "$(dirs)" "/elsewhere/issue:$M/issue:$M/push-band"
  mods uninstall >/dev/null
  check "after uninstall all" "$(dirs)" "/elsewhere/issue"
}

test_tilde_and_trailing_slash_count_as_installed() {
  settings "~/mods/issue:$M/push-band/"
  local list; list="$(mods list)"
  ok "issue listed as installed" grep -qE '^issue +installed' <<<"$list"
  ok "push-band listed as installed" grep -qE '^push-band +installed' <<<"$list"
  mods uninstall issue >/dev/null
  check "dirs" "$(dirs)" "$M/push-band"
}

test_uninstall_one_keeps_the_others() {
  settings "/opt/a:$M/issue:$M/push-band"
  mods uninstall push-band >/dev/null
  check "dirs" "$(dirs)" "/opt/a:$M/issue"
}

test_uninstall_all_removes_repo_and_dead_entries() {
  settings "/opt/a:$M/issue:$M/gone"
  mods uninstall >/dev/null
  check "foreign kept" "$(dirs)" "/opt/a"

  settings "$M/issue:$M/push-band"
  mods install >/dev/null
  mods uninstall >/dev/null
  check "key removed when empty" "$(dirs)" "<unset>"
  check "function hooks left alone" "$(jq -r .env.CLAUDE_CODE_ENABLE_FUNCTION_HOOKS "$S")" 1
}

test_unknown_names_fail_without_writing() {
  settings "$M/issue"
  cp "$S" "$T/original"
  check "uninstall typo fails" "$(mods uninstall typo >/dev/null 2>&1; echo $?)" 1
  check "install typo fails" "$(mods install typo >/dev/null 2>&1; echo $?)" 1
  ok "settings untouched" cmp "$S" "$T/original"
  check "no backup written" "$([[ -e "$S.mods-bak" ]] && echo yes || echo no)" no
  check "uninstalling a real but uninstalled mod is fine" "$(mods uninstall push-band >/dev/null 2>&1; echo $?)" 0
}

test_dead_entry_is_kept_reported_and_uninstallable() {
  settings "$M/issue:$M/gone"
  local err; err="$(mods install push-band 2>&1 >/dev/null)"
  check "install exit status" "$?" 0
  check "dead entry kept, sorted with the rest" "$(dirs)" "$M/gone:$M/issue:$M/push-band"
  ok "install warns about it" grep -q "dead entry $M/gone" <<<"$err"
  ok "list shows it missing" grep -qE '^gone +missing' <<<"$(mods list)"
  mods uninstall gone >/dev/null 2>&1
  check "uninstall gone" "$(dirs)" "$M/issue:$M/push-band"
}

for current in $(declare -F | awk '{print $3}' | grep '^test_'); do
  setup
  "$current"
  rm -rf "$T"
done

if (( failures )); then echo "bin-mods: $failures failure(s)"; exit 1; fi
echo "bin-mods: all tests passed"
