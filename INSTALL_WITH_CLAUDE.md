# Install VoiceMesh with Claude

Give Claude Code on your Mac or Windows PC this request:

> Read https://github.com/hopetonp/claude-voice-mod/blob/main/INSTALL_WITH_CLAUDE.md and install VoiceMesh from the latest GitHub Release. Check the package and installation result, then tell me when to restart Claude.

## Instructions for Claude

These instructions install the package for the current operating system from the GitHub Releases page for `hopetonp/claude-voice-mod`. Use a local Claude Code session with shell access. Do not install from a source checkout or an unrelated download.

### macOS

1. Confirm the machine is macOS and determine its architecture with `uname -m`. Choose the latest release asset named `voicemesh-claude-macos-arm64-<version>.zip` for `arm64`, or `voicemesh-claude-macos-x64-<version>.zip` for `x86_64`. If that asset is missing, stop and report that the download has not been published. Do not build from source as an installation fallback.
2. Confirm the `claude` CLI is available. Download the chosen ZIP from the repository's GitHub Release into a temporary directory and extract it. Check that the extracted folder contains `install.sh`, `runtime/node`, and `plugin-marketplace/.claude-plugin/marketplace.json` before proceeding.
3. Run `./install.sh` from inside the extracted release folder. The installer copies the package to `~/Library/Application Support/VoiceMesh/ClaudeVoice`, starts its local host, registers its bundled marketplace, and installs both `voicemesh-controls` and `voicemesh-said`. Existing VoiceMesh settings and credentials are preserved.
4. Check that `claude plugin list` shows both plugins enabled and that `launchctl list com.voicemesh.claude-host` shows a running service. Report any failure with the command output. Tell the user to restart Claude to load the Mods and open Voice settings to configure a provider key if needed.

### Windows

1. Confirm the machine is Windows and determine whether it is x64 or arm64. Find the latest Windows release archive for that architecture. It must contain the complete `voicemesh-claude-win-x64` or `voicemesh-claude-win-arm64` folder. If no matching archive is published, stop and report that the download is not available. Do not build from source as an installation fallback.
2. Confirm the `claude` CLI and Chrome are available. Extract the archive and check that its package folder contains `install.ps1`, `runtime/node.exe`, `app/dist/index.html`, `app/settings-window/src-tauri/target/release/voicemesh-settings-window.exe`, and `plugin-marketplace/.claude-plugin/marketplace.json`.
3. Open PowerShell in the extracted package folder and run `.\install.ps1`. The installer copies the package to `$env:LOCALAPPDATA\VoiceMesh\ClaudeVoice`, starts the host, creates a sign-in shortcut, registers its bundled marketplace, and installs both `voicemesh-controls` and `voicemesh-said`. Existing VoiceMesh settings and credentials are preserved.
4. Check that `claude plugin list` shows both plugins enabled, the installed `runtime/node.exe` has a running host process, and the Startup folder contains `VoiceMesh Claude Voice.lnk`. Report any failure with the command output. Tell the user to restart Claude and open Voice settings to configure a provider key if needed. Running `.\uninstall.ps1` removes the host, shortcut, and Mods while preserving saved voice settings and credentials.

The media runtime needs Chrome. A working Claude Code or Claude Desktop Code installation is required on both platforms.
