#!/bin/sh
set -eu

scripts=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
app=$(dirname "$scripts")
requirements="$scripts"
if [ ! -f "$requirements/node-minimum" ]; then requirements="$app/npm-installer"; fi
minimum=$(cat "$requirements/node-minimum")
node_path=$(cat "$app/node-path.txt" 2>/dev/null) || node_path=''
if [ -z "$node_path" ] || [ ! -x "$node_path" ]; then
  echo "VoiceMesh cannot find its saved Node.js executable. Install Node.js $minimum or later from https://nodejs.org and run the VoiceMesh installer again." >&2
  exit 78
fi
"$node_path" "$requirements/node-requirement.cjs" || exit 78
PATH="$(dirname "$node_path"):${PATH:-/usr/bin:/bin}"
export PATH
exec "$node_path" --max-semi-space-size=2 "$scripts/launch-host.js" "$@"
