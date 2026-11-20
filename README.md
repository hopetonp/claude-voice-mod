# Claude Voice Mod

Have a bidirectional, natural voice conversation with Claude Code on macOS or Windows desktop. Ask questions or give coding requests, then hear Claude summarize the result. You can hear progress as it works or wait for the outcome. **Plain-language summaries** option in Voice Settings → Conversation makes spoken results less technical if desired.

## How voice works

**Realtime (recommended)** uses one live model to listen and respond, giving you more fluid turn-taking and simpler setup. Supported choices include GPT Live, OpenAI Realtime, xAI Grok, and Gemini Live.

**Voice pipeline** lets you choose speech recognition, conversation, and speech synthesis models separately, including selected local models and custom endpoints. It offers more control but takes more setup and can add delay.

In either mode, coding requests go to the active Claude session. Optional **request classification** uses Jev (TypeSafe) or OpenAI Decisions (GPT-6 Luna) to route a spoken request to a voice reply, clarifying question, or coding task. This decision typically takes milliseconds; provider charges may apply.

## Installation

Requires **Node.js 22.19 or later** and npm. Install Node from [nodejs.org](https://nodejs.org); on Windows, prefer the official installer over an outdated nvm-windows installation.

Run the installer directly to see download progress, checksum verification, and the result:

```sh
npx --yes claude-voice-mod@latest
```

This downloads and verifies the prebuilt package for your Mac or Windows PC. With pnpm, use `pnpm dlx claude-voice-mod@latest`. Restart Claude after installation.

For a global installation, use `npm install --global --foreground-scripts claude-voice-mod@latest` so npm shows the installer output.

If a global installation fails, run `npm uninstall --global claude-voice-mod` before trying again. This removes leftover npm launcher files that can otherwise cause an `EEXIST` error. The `npx` command above avoids creating global launchers.

For an installation without npm, download a prebuilt ZIP from the [GitHub releases](https://github.com/hopetonp/claude-voice-mod/releases) page. Choose the release marked “Latest”.

Ask an AI agent with shell access to your computer:

> Read https://github.com/hopetonp/claude-voice-mod/blob/main/INSTALL_WITH_CLAUDE.md. Download the latest published ZIP, verify it, run its installer, and check both Mods and the local host.

Choose `voicemesh-claude-macos-arm64-<version>.zip` for an Apple Silicon Mac (M-series), `voicemesh-claude-macos-x64-<version>.zip` for an Intel Mac, or `voicemesh-claude-win-x64-<version>.zip` for a Windows x64 PC. Install Node.js 22.19 or later before running `install.sh` on macOS or `install.ps1` on Windows. The prebuilt packages include the host and settings app, so no build tools are needed. Claude Code and Chrome are required for use. The Mod has been installed successfully on macOS arm64 and on a Windows box.

To compile it yourself, see [BUILD_FROM_SOURCE.md](BUILD_FROM_SOURCE.md). GitHub's automatically generated **Source code** archives are not installable packages.

## Uninstall

Run `uninstall.sh` on macOS or `uninstall.ps1` on Windows from the installed package. This removes the host, settings-window caches and old packaged builds while keeping saved settings, keys and history. For a complete uninstall that also deletes those personal records, use `sh uninstall.sh --purge` or `powershell.exe -File .\uninstall.ps1 -Purge`.

## Security

Provider keys are saved locally in Claude's user data under `.claude/voicemesh-controls/providers.json`; they are not encrypted by this Mod or stored in your Claude account. The local host listens on `127.0.0.1` and omits keys from settings responses. Audio and text are sent to the voice providers you configure. If you enable request classification, its provider also receives the spoken request and context. Uninstalling leaves your settings and keys in place unless you explicitly use the purge option.

Claude Voice Mod is available under the [MIT License](LICENSE). Third-party components retain their own terms.
