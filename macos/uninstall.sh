#!/bin/sh
set -eu

purge=false
staging=false
for arg in "$@"; do
  case "$arg" in
    --purge) purge=true ;;
    --staging-only) staging=true ;;
    *) echo 'Usage: uninstall.sh [--purge] [--staging-only]' >&2; exit 1 ;;
  esac
done
user_dir="$HOME"
if [ "$staging" = true ]; then user_dir="${TMPDIR:-/tmp}/VoiceMeshPackageSmoke/user"; fi
support="$user_dir/Library/Application Support"
destination="$support/VoiceMesh/ClaudeVoice"
if [ "$staging" = false ]; then
  claude plugin uninstall voicemesh-controls@voicemesh-local --keep-data -y >/dev/null 2>&1 || true
  claude plugin uninstall voicemesh-said@voicemesh-local --keep-data -y >/dev/null 2>&1 || true
  claude plugin marketplace remove voicemesh-local >/dev/null 2>&1 || true
  launchctl bootout "gui/$(id -u)/com.voicemesh.claude-host" >/dev/null 2>&1 || true
  rm -f "$user_dir/Library/LaunchAgents/com.voicemesh.claude-host.plist"
fi
# Caches and legacy packaged builds contain no saved provider credentials.
rm -rf "$support/com.voicemesh.claude.settings" \
  "$user_dir/Library/Caches/com.voicemesh.claude.settings" \
  "$user_dir/Library/WebKit/com.voicemesh.claude.settings" \
  "$user_dir/Library/Saved Application State/com.voicemesh.claude.settings.savedState" \
  "$support/VoiceMesh/Marketplaces"
rm -f "$user_dir/Library/Preferences/com.voicemesh.claude.settings.plist"
if [ "$purge" = true ]; then
  rm -rf "$user_dir/.claude/voicemesh-controls" "$user_dir/.claude/plugins/cache/voicemesh-local"
  for plugin in voicemesh-controls voicemesh-said; do
    rm -rf "$user_dir/.claude/plugins/data/$plugin-inline" "$user_dir/.claude/plugins/data/$plugin-voicemesh-local"
    rm -f "$user_dir/.claude/plugins/store/${plugin}_"*.json
  done
fi
rm -rf "$destination"
if [ "$purge" = true ]; then
  echo 'VoiceMesh removed, including saved settings, credentials, transcripts and Mod data.'
else
  echo 'VoiceMesh and caches removed. Saved settings, credentials and history remain; use --purge to remove them.'
fi
