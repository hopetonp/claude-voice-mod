# Install VoiceMesh with Claude

Give Claude Code on your Mac this request:

> Read https://github.com/hopeton2/claude-voice-mod/blob/main/INSTALL_WITH_CLAUDE.md and install VoiceMesh from the latest GitHub Release. Check the package and installation result, then tell me when to restart Claude.

## Instructions for Claude

These instructions install the macOS package from the GitHub Releases page for `hopeton2/claude-voice-mod`. They are for a local macOS Claude Code session with shell access. Do not install from a source checkout or an unrelated download.

1. Confirm the machine is macOS and determine its architecture with `uname -m`. Choose the latest release asset named `voicemesh-claude-macos-arm64-<version>.zip` for `arm64`, or `voicemesh-claude-macos-x64-<version>.zip` for `x86_64`. If that asset is missing, stop and report that the download has not been published. Do not build from source as an installation fallback.
2. Confirm the `claude` CLI is available. Download the chosen ZIP from the repository's GitHub Release into a temporary directory and extract it. Check that the extracted folder contains `install.sh`, `runtime/node`, and `plugin-marketplace/.claude-plugin/marketplace.json` before proceeding.
3. Run `./install.sh` from inside the extracted release folder. The installer copies the package to `~/Library/Application Support/VoiceMesh/ClaudeVoice`, starts its local host, registers its bundled marketplace, and installs both `voicemesh-controls` and `voicemesh-said`. Existing VoiceMesh settings and credentials are preserved.
4. Check that `claude plugin list` shows both plugins enabled and that `launchctl list com.voicemesh.claude-host` shows a running service. Report any failure with the command output. Tell the user to restart Claude to load the Mods and open Voice settings to configure a provider key if needed.

The media runtime needs Chrome. A working Claude Code or Claude Desktop Code installation is also required. Windows installation is not covered by this guide.
