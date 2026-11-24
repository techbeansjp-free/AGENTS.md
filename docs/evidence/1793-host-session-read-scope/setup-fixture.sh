#!/bin/sh
# Create the synthetic fixture used by probe-run.mjs next to it: <dir>/probe/{repo,outside}.
# Copy this directory to a disposable location first; markers are random harmless values.
set -eu
D=$(cd "$(dirname "$0")" && pwd)
P="$D/probe"
rm -rf "$P"; mkdir -p "$P/outside" "$P/repo"
git -C "$P/repo" init -q -b main
git -C "$P/repo" -c user.email=probe@example.invalid -c user.name=probe commit -q --allow-empty -m init
git -C "$P/repo" worktree add -q .worktrees/target -b target
T="$P/repo/.worktrees/target"
echo "OUTSIDE-$(openssl rand -hex 8)" > "$P/outside/marker.txt"
echo "INSIDE-$(openssl rand -hex 8)" > "$T/inside.txt"
echo "ROOT-$(openssl rand -hex 8)" > "$P/repo/root-only.txt"
ln -s "$P/outside" "$T/link-dir"
ln -s "$P/outside/marker.txt" "$T/link-file.txt"
