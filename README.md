# Claude Voice Mod

Have a two-way, natural voice conversation with Claude Code on macOS or Windows. Ask questions or give coding requests, then hear Claude summarize the result. You can hear progress as it works or wait for the outcome. **Plain-language summaries** in Voice Settings → Conversation make spoken results less technical.

## How voice works

**Realtime (recommended)** uses one live model to listen and respond, giving you more fluid turn-taking and simpler setup. Supported choices include GPT Live, OpenAI Realtime, xAI Grok, and Gemini Live.

**Voice pipeline** lets you choose speech recognition, conversation, and speech synthesis models separately, including selected local models and custom endpoints. It offers more control but takes more setup and can add delay.

In either mode, coding requests go to the active Claude session. Optional **request classification** uses Jev (TypeSafe) or OpenAI Decisions (GPT-6 Luna) to route a spoken request to a voice reply, clarifying question, or coding task. This decision typically takes milliseconds; provider charges may apply.

## Installation

Download ZIP from the [latest release](https://github.com/hopetonp/claude-voice-mod/releases/latest).

Ask an AI agent with shell access to your computer:

> Read https://github.com/hopetonp/claude-voice-mod/blob/main/INSTALL_WITH_CLAUDE.md. Download prebuilt ZIP from the latest release, verify it, run its installer, and check both Mods and the local host.

Choose `voicemesh-claude-macos-arm64-<version>.zip` for an Apple Silicon Mac (M-series), `voicemesh-claude-macos-x64-<version>.zip` for an Intel Mac, or `voicemesh-claude-win-x64-<version>.zip` for a Windows x64 PC. Run `install.sh` on macOS or `install.ps1` on Windows after extraction. The prebuilt packages include the runtime and settings app, so no build tools are needed. Claude Code and Chrome are required for use. The Mod has been installed successfully on macOS arm64 and on a Windows box.

To compile it yourself, see [BUILD_FROM_SOURCE.md](BUILD_FROM_SOURCE.md). GitHub's automatically generated **Source code** archives are not installable packages.

## Security

Provider keys are saved locally in Claude's user data under `.claude/voicemesh-controls/providers.json`; they are not encrypted by this Mod or stored in your Claude account. The local host listens on `127.0.0.1` and omits keys from settings responses. Audio and text are sent to the voice providers you configure. If you enable request classification, its provider also receives the spoken request and context. Uninstalling leaves your settings and keys in place.

Claude Voice Mod is available under the [MIT License](LICENSE). Third-party components retain their own terms.
