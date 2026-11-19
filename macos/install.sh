#!/bin/sh
set -eu

source_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
destination="$HOME/Library/Application Support/VoiceMesh/ClaudeVoice"
marketplace="$destination/plugin-marketplace"

if [ ! -f "$source_dir/app/host/server.js" ] || [ ! -d "$source_dir/plugin-marketplace" ]; then
  echo 'Incomplete VoiceMesh package' >&2
  exit 1
fi
minimum=$(cat "$source_dir/app/scripts/node-minimum")
node_command=$(command -v node 2>/dev/null) || node_command=''
if [ -z "$node_command" ]; then
  echo "VoiceMesh requires Node.js $minimum or later. Install Node from https://nodejs.org (or brew install node), then run this installer again." >&2
  exit 1
fi
# Validate before stopping a service, removing files, or changing Claude's plugins.
node_path=$("$node_command" "$source_dir/app/scripts/node-requirement.cjs" --resolve) || exit 1
if ! command -v claude >/dev/null 2>&1; then
  echo 'Claude CLI is required to install the bundled Mods' >&2
  exit 1
fi
if [ "$source_dir" = "$destination" ]; then
  echo 'Run install.sh from the built package directory' >&2
  exit 1
fi

launchctl bootout "gui/$(id -u)/com.voicemesh.claude-host" >/dev/null 2>&1 || true
mkdir -p "$(dirname "$destination")"
rm -rf "$destination"
ditto "$source_dir" "$destination"
"$node_path" "$destination/app/scripts/install-host-macos.js"

# The local marketplace records an absolute path. Point it at the durable install,
# then refresh both plugins from this release rather than the build checkout.
claude plugin uninstall voicemesh-controls@voicemesh-local --keep-data -y >/dev/null 2>&1 || true
claude plugin uninstall voicemesh-said@voicemesh-local --keep-data -y >/dev/null 2>&1 || true
claude plugin marketplace remove voicemesh-local >/dev/null 2>&1 || true
claude plugin marketplace add "$marketplace"
claude plugin install voicemesh-controls@voicemesh-local -y
claude plugin install voicemesh-said@voicemesh-local -y
echo "VoiceMesh installed at $destination. Restart Claude to load the Mods."
