# Claude Voice Mod

Claude Voice Mod adds VoiceMesh voice controls to Claude Code on macOS and Windows. It connects the active Claude coding session to VoiceMesh Composer, which handles microphone capture, speech recognition, voice conversation, and playback. Coding requests from voice are sent to Claude; Claude's results can be spoken back.

The package includes two Claude Mods, a local VoiceMesh host, and a settings window. Provider keys and voice settings are stored on the user's computer.

## Install on macOS

Follow [the installation instructions for Claude](INSTALL_WITH_CLAUDE.md), or download the ZIP for your Mac's architecture from the [latest release](https://github.com/hopetonp/claude-voice-mod/releases/latest). Extract it and run `./install.sh` from the extracted folder. Restart Claude after installation.

The installer places the package under `~/Library/Application Support/VoiceMesh/ClaudeVoice`, registers the local host and Claude marketplace, and installs both Mods. Run `./uninstall.sh` from the same package to remove the host and Mods. Saved voice settings and credentials are preserved.

Claude Code and Chrome are required.

## Install on Windows

Follow [the installation instructions for Claude](INSTALL_WITH_CLAUDE.md), or download the ZIP for your PC's architecture (x64 or arm64) from the [latest release](https://github.com/hopetonp/claude-voice-mod/releases/latest). Extract the complete archive, open PowerShell in the extracted package folder, and run:

```powershell
.\install.ps1
```

Restart Claude after installation. The installer places the package under `%LOCALAPPDATA%\VoiceMesh\ClaudeVoice`, starts the local host, creates a shortcut to start it at sign-in, registers the bundled Claude marketplace, and installs both Mods. Open Voice settings in Claude to configure a provider key, model, and voice. Users do not need Node, npm, Rust, or Visual Studio; the package includes its own Node runtime and native settings window.

Run `.\uninstall.ps1` from the same package to remove the host, sign-in shortcut, and Mods. Saved voice settings and credentials under `%USERPROFILE%\.claude\voicemesh-controls` are preserved. Claude Code and Chrome are required. If PowerShell blocks the installer, unblock the downloaded archive in its file Properties before extracting it again.

Clean-machine installation and live voice behavior with the updated installer still need verification.

## Build from source

The repository pins VoiceMesh Composer and the settings editor in `vendor/`. To build the macOS package on an arm64 or x64 Mac, install Node.js 22.19 or later, npm, Rust, and Cargo, then run:

```sh
npm ci
npm run media:build
npm run settings:window:build
npm run plugin:stage
npm run release:macos
```

The ZIP is created in `release/` for the build machine's architecture. Build separately on each architecture. For local development, `npm run host:install:macos` installs the per-user host service; `npm run host:install:macos -- --remove` removes it.

To build the Windows package on Windows, install Node.js 22.19 or later, npm, Rust/Cargo, Visual Studio C++ build tools, and the Windows SDK. Extract an official Windows Node distribution of the same architecture as the build machine. From this repository, run:

```powershell
npm ci
npm run media:build
npm run settings:window:build
npm run plugin:stage
npm run release:windows -- --node-dir "C:\path\to\node-distribution"
```

`settings:window:build` also builds the settings frontend. The official Node directory must contain `node.exe`, `npm.cmd`, `LICENSE`, and npm's files. Its architecture must match the Node process running the build and the native settings executable.

The Windows release builder creates `release/voicemesh-claude-win-x64` or `release/voicemesh-claude-win-arm64`. Archive the complete directory, including its `.claude-plugin` manifests, for distribution. For example:

```powershell
tar -a -cf "release\voicemesh-claude-win-x64.zip" -C release voicemesh-claude-win-x64
```

Build each architecture separately and choose a fresh `--output` directory for subsequent builds; the builder refuses to overwrite an existing release. The `release:windows:mod` command produces a separate marketplace-only development package without the installer or sign-in shortcut.

## Repository layout

| Path | Purpose |
| --- | --- |
| `hooks/`, `.claude-plugin/`, `said-plugin/` | Claude Mod controls and plugin manifests |
| `host/` | Local VoiceMesh host and Claude session bridge |
| `media/` | Composer browser audio runtime |
| `setup/`, `settings-window/` | Voice provider settings UI and native window |
| `macos/`, `windows/`, `scripts/` | Installers and release builders |
| `vendor/` | Pinned VoiceMesh package archives |

Claude's Mod UI is available in the Claude Code terminal and the Code tab of Claude Desktop. Voice controls do not appear in the VS Code chat panel or noninteractive sessions.
