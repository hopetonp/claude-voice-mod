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

## Install

Give an AI agent with shell access on the target computer this request:

> Read https://github.com/hopetonp/claude-voice-mod/blob/main/INSTALL_WITH_CLAUDE.md. Download the latest prebuilt VoiceMesh release for this computer, verify and extract it, run its installer, and check both Mods and the local host. Tell me when to restart Claude.

The [prebuilt installation guide](INSTALL_WITH_CLAUDE.md) covers macOS Apple Silicon and Intel, and Windows x64. Download the matching ZIP from the [latest release](https://github.com/hopetonp/claude-voice-mod/releases/latest). The package includes the runtime, settings app, local host, and both Mods. Installing it does not require Git, Node.js, npm, Rust, or C++ build tools. Claude Code and Chrome are required for use.

| Computer | Download this release archive |
| --- | --- |
| Apple Silicon Mac | `voicemesh-claude-macos-arm64-<version>.zip` |
| Intel Mac | `voicemesh-claude-macos-x64-<version>.zip` |
| Windows x64 | `voicemesh-claude-win-x64-<version>.zip` |

Download `SHA256SUMS` from the same release and verify the archive, then extract it. Run `install.sh` on macOS or `install.ps1` on Windows from the extracted package directory. Each installer copies the package to the user's application data, registers the local host and bundled marketplace, and installs both Mods. Restart Claude after installation. Saved voice settings and credentials are preserved during reinstall. GitHub's automatically generated **Source code** archives are not installable packages.

Run `uninstall.sh` or `uninstall.ps1` from the package directory to remove the host and Mods. Saved settings and credentials remain in place.

Developers can [build from source](BUILD_FROM_SOURCE.md) using the pinned VoiceMesh packages in `vendor/`. That path requires Git, Node.js 22.19 or later, npm, Rust, and Cargo; Windows also requires Visual Studio C++ build tools and the Windows SDK. Fresh-clone build and installation were verified on macOS arm64 at commit `7c32277`. Windows installation and live voice behavior on both platforms still need verification.

## License

Claude Voice Mod is available under the [MIT License](LICENSE). Third-party components retain their own terms.

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
