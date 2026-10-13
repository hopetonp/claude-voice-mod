#!/bin/sh
set -eu

destination="$HOME/Library/Application Support/VoiceMesh/ClaudeVoice"
claude plugin uninstall voicemesh-controls@voicemesh-local --keep-data -y >/dev/null 2>&1 || true
claude plugin uninstall voicemesh-said@voicemesh-local --keep-data -y >/dev/null 2>&1 || true
claude plugin marketplace remove voicemesh-local >/dev/null 2>&1 || true
launchctl bootout "gui/$(id -u)/com.voicemesh.claude-host" >/dev/null 2>&1 || true
rm -f "$HOME/Library/LaunchAgents/com.voicemesh.claude-host.plist"
rm -rf "$destination"
echo 'VoiceMesh removed. Saved voice settings and credentials remain in place.'
