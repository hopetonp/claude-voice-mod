#!/bin/sh
set -eu

source_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
destination="$HOME/Library/Application Support/VoiceMesh/ClaudeVoice"
marketplace="$destination/plugin-marketplace"

if [ ! -x "$source_dir/runtime/node" ] || [ ! -d "$source_dir/plugin-marketplace" ]; then
  echo 'Incomplete VoiceMesh package' >&2
  exit 1
fi
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
"$destination/runtime/node" "$destination/app/scripts/install-host-macos.js"

# The local marketplace records an absolute path. Point it at the durable install,
# then refresh both plugins from this release rather than the build checkout.
claude plugin uninstall voicemesh-controls@voicemesh-local --keep-data -y >/dev/null 2>&1 || true
claude plugin uninstall voicemesh-said@voicemesh-local --keep-data -y >/dev/null 2>&1 || true
claude plugin marketplace remove voicemesh-local >/dev/null 2>&1 || true
claude plugin marketplace add "$marketplace"
claude plugin install voicemesh-controls@voicemesh-local -y
claude plugin install voicemesh-said@voicemesh-local -y
echo "VoiceMesh installed at $destination. Restart Claude to load the Mods."
