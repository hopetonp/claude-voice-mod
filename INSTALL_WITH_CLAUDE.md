# Install VoiceMesh from a prebuilt release

Give an AI agent with shell access on the target Mac or Windows PC this request:

> Read https://github.com/hopetonp/claude-voice-mod/blob/main/INSTALL_WITH_CLAUDE.md. Download the latest published VoiceMesh Claude Mod release ZIP for this computer from https://github.com/hopetonp/claude-voice-mod/releases/latest, verify its checksum, extract it, and run its installer. Verify both Mods and the local host. Tell me when to restart Claude. Do not build from source.

## Instructions for Claude

Use a local agent session on the computer that will run VoiceMesh. Confirm that Claude Code or Claude Desktop Code and the `claude` CLI are installed. Chrome is required for voice media. The prebuilt ZIP includes the Node runtime, settings app, both Mods, and their local host; Git, npm, Rust, and C++ build tools are not needed on the target computer.

Open the [latest published release](https://github.com/hopetonp/claude-voice-mod/releases/latest). Choose the asset matching the operating system and CPU:

| Computer | Release asset |
| --- | --- |
| Apple Silicon Mac | `voicemesh-claude-macos-arm64-<version>.zip` |
| Intel Mac | `voicemesh-claude-macos-x64-<version>.zip` |
| Windows x64 | `voicemesh-claude-win-x64-<version>.zip` |

Download the matching ZIP and `SHA256SUMS` from the same release. Compare the ZIP's SHA-256 hash with its entry in `SHA256SUMS` (`shasum -a 256` on macOS or `Get-FileHash -Algorithm SHA256` in PowerShell). Stop and report any mismatch. Extract the ZIP; it contains one package directory. Do **not** use GitHub's automatically generated “Source code” ZIP as an installer.

### macOS

Run `sh install.sh` from the extracted package directory. The installer copies the complete package to `~/Library/Application Support/VoiceMesh/ClaudeVoice`, registers the local host, and installs both Mods. Confirm that `release.json` matches the downloaded version and Mac architecture. Then check that `claude plugin list` shows `voicemesh-controls` and `voicemesh-said` enabled and `launchctl list com.voicemesh.claude-host` shows the host.

If macOS blocks the settings app because the release is unsigned, report the warning to the user. Apple provides an **Open Anyway** option in System Settings → Privacy & Security for software the user trusts.

### Windows

Extract the ZIP in Explorer or PowerShell. Run `install.ps1` from the extracted package directory in PowerShell. The installer copies the complete package to `%LOCALAPPDATA%\VoiceMesh\ClaudeVoice`, creates a Startup shortcut for the local host, and installs both Mods. Confirm that `release.json` matches the downloaded version and x64 architecture. Then check that `claude plugin list` shows both Mods enabled, the installed `runtime\node.exe` has a running host process, and the Startup folder contains `VoiceMesh Claude Voice.lnk`.

If PowerShell blocks the downloaded script under its execution policy, ask the user to approve a process-scoped invocation with `powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\install.ps1`; do not change the computer-wide policy.

Report any installation or verification failure. Tell the user to restart Claude and open Voice settings to configure a provider key, model, and voice. Reinstalling preserves saved settings and credentials. The package also includes `uninstall.sh` or `uninstall.ps1` to remove the host and Mods while preserving those settings.

For developers who want to compile the Mod, see [Build from source](BUILD_FROM_SOURCE.md).
