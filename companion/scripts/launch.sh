#!/bin/sh
set -eu
app_path="${PLANNER_APP_PATH:-/Applications/Planner.app}"
runtime="$app_path/Contents/Resources/runtime"
if [ ! -x "$runtime/node" ]; then echo "Install Planner.app in /Applications or set PLANNER_APP_PATH." >&2; exit 1; fi
exec "$runtime/node" "$runtime/companion.cjs"
