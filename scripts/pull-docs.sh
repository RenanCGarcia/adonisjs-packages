#!/usr/bin/env sh
# Clones (or updates) third-party docs into repos/<name> as read-only reference
# for coding agents. Gitignored: only the listed doc paths are checked out.
set -eu

ROOT="$(git rev-parse --show-toplevel)/repos"

# pull <name> <repo> <branch> <path>...
# Paths use non-cone sparse-checkout patterns: cone mode would also check out
# each repo's root files (package.json, ace.js...).
pull() {
  name="$1" repo="$2" branch="$3"
  shift 3
  dest="$ROOT/$name"

  if [ -d "$dest/.git" ]; then
    git -C "$dest" pull --quiet --ff-only
  else
    git clone --quiet --depth 1 --filter=blob:none --sparse --branch "$branch" "$repo" "$dest"
  fi

  git -C "$dest" sparse-checkout set --no-cone "$@"
  echo "$name at $(git -C "$dest" log -1 --format='%h (%cs)') -> $dest"
}

pull adonisjs-docs https://github.com/adonisjs/v7-docs.git main /content/start/ /content/guides/ /content/reference/
pull lucid-docs https://github.com/adonisjs/lucid.git 22.x /docs/
pull vinejs-docs https://github.com/vinejs/vinejs.dev.git main /content/docs/guides/ /content/docs/types/ /content/docs/extend/
