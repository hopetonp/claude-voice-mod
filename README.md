# Claude Voice Mod

Claude Voice Mod adds VoiceMesh voice controls to Claude Code on macOS and Windows. It connects the active Claude coding session to VoiceMesh Composer, which handles microphone capture, speech recognition, voice conversation, and playback. Coding requests from voice are sent to Claude; Claude's results can be spoken back.

The package includes two Claude Mods, a local VoiceMesh host, and a settings window. Provider keys and voice settings are stored on the user's computer.

## Install on macOS

Follow [the installation instructions for Claude](INSTALL_WITH_CLAUDE.md), or download the ZIP for your Mac's architecture from the [latest release](https://github.com/hopetonp/claude-voice-mod/releases/latest). Extract it and run `./install.sh` from the extracted folder. Restart Claude after installation.

The installer places the package under `~/Library/Application Support/VoiceMesh/ClaudeVoice`, registers the local host and Claude marketplace, and installs both Mods. Run `./uninstall.sh` from the same package to remove the host and Mods. Saved voice settings and credentials are preserved.

Claude Code and Chrome are required.

## Install on Windows

Extract the complete Windows package, open PowerShell in the extracted `voicemesh-claude-win-x64` or `voicemesh-claude-win-arm64` folder, and run:

```powershell
.\install.ps1
claude plugin marketplace add "$env:LOCALAPPDATA\VoiceMesh\ClaudeVoice\plugin-marketplace"
claude plugin install voicemesh-controls@voicemesh-local
claude plugin install voicemesh-said@voicemesh-local
```

Restart Claude, then open Voice settings to configure a provider key. The installer copies the host to `%LOCALAPPDATA%\VoiceMesh\ClaudeVoice`, starts it, and creates a shortcut to start it at sign-in. It includes its own Node runtime; Claude Code and Chrome are required separately. Run `uninstall.ps1` from the installed folder to remove the host and startup shortcut. That script leaves Claude plugins, voice settings, and credentials in place.

Windows is supported; the installer has worked on a Windows machine. No GitHub Release has been published yet, so a downloadable package will be available only after the release assets are uploaded.

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
npm run setup:build
npm run settings:window:build
npm run plugin:stage
npm run release:windows -- --node-dir "C:\path\to\node-distribution"
```

The release builder creates `release/voicemesh-claude-win-x64` or `release/voicemesh-claude-win-arm64`. Distribute the complete folder as one archive; users do not need build tools or a system Node installation.

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
