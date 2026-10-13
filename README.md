# Claude Voice Mod

Claude Voice Mod brings two-way, natural voice conversation to Claude Code on macOS and Windows. Ask questions or give coding requests by voice, then hear a conversational summary of Claude's results. Choose whether to hear progress milestones as Claude works or wait for the outcome.

For less technical spoken results, turn on **Plain-language summaries** in Voice Settings → Conversation. This prompts the voice model to use everyday language, explain necessary technical terms, and keep the key findings and next steps. The setting is off by default and applies to every voice provider.

## Voice modes and models

**Realtime speech (recommended)** uses one live voice model to listen, converse, and speak in the same session. Start here for simpler setup and more fluid turn-taking. VoiceMesh supports GPT Live, OpenAI Realtime, xAI Grok, and Gemini Live; choose a model and voice in Voice settings.

**Voice pipeline** lets you choose speech recognition, a conversation model, and speech synthesis separately. It supports selected local speech models and custom conversation endpoints. Use it when you need that flexibility; the extra stages require more configuration and may add delay.

In either mode, the conversation model handles ordinary spoken replies, while coding requests go to the active Claude coding session. **Request classification** is an optional, separate model that helps decide whether a completed spoken request should get a voice reply, a clarifying question, or a Claude coding task. It supports Jev (TypeSafe) and OpenAI Decisions (GPT-6 Luna). It is off by default. Enable it when you want a dedicated model to make that routing decision. It requires a classifier provider key; the extra decision typically takes milliseconds, and provider usage charges may apply.

## Security and API keys

Keys entered in Voice settings are saved locally with Claude's user data in `~/.claude/voicemesh-controls/providers.json` on macOS or `%USERPROFILE%\.claude\voicemesh-controls\providers.json` on Windows. The host writes the file with owner-only permissions on macOS and omits keys from settings responses. The host listens on `127.0.0.1`.

The keys are **not encrypted by this Mod or stored in your Claude account**. They are sent to the providers you configure when those services are used; voice audio and text may also be sent to those providers. Enabling request classification sends the spoken request and context to its selected provider. Uninstalling preserves saved keys and settings; remove the `voicemesh-controls` data directory above if you want to erase them.

## Install with an AI agent

Give an AI agent with shell access this request. If you already have a prebuilt ZIP, include its full path in the request.

> Read https://github.com/hopetonp/claude-voice-mod/blob/main/INSTALL_WITH_CLAUDE.md and install VoiceMesh. Use a prebuilt ZIP for this computer's operating system and architecture: either the latest matching GitHub Release asset or the ZIP path I provide. Extract the complete package and run its installer (`./install.sh` on macOS or `.\install.ps1` on Windows). Verify the installation and tell me when to restart Claude. Do not clone the repository, build from source, run npm or Cargo, or follow the "Build from source" section. If no matching prebuilt ZIP is available, stop and ask me for one.

The build instructions below are for people creating release packages, not for installing VoiceMesh.

## Install on macOS

Follow [the installation instructions for Claude](INSTALL_WITH_CLAUDE.md), or use a prebuilt ZIP for your Mac's architecture from the [latest release](https://github.com/hopetonp/claude-voice-mod/releases/latest) or supplied by the maintainer. Extract it and run `./install.sh` from the extracted folder. Restart Claude after installation.

The installer places the package under `~/Library/Application Support/VoiceMesh/ClaudeVoice`, registers the local host and Claude marketplace, and installs both Mods. Run `./uninstall.sh` from the same package to remove the host and Mods. Saved voice settings and credentials are preserved.

Claude Code and Chrome are required.

## Install on Windows

Follow [the installation instructions for Claude](INSTALL_WITH_CLAUDE.md), or use a prebuilt ZIP for your PC's architecture (x64 or arm64) from the [latest release](https://github.com/hopetonp/claude-voice-mod/releases/latest) or supplied by the maintainer. Extract the complete archive, open PowerShell in the extracted package folder, and run:

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
