# Claude Voice Mod

Requires **Node.js 22.19 or later**. Install it from [nodejs.org](https://nodejs.org); on Windows, prefer the official installer over an outdated nvm-windows installation.

Install the prebuilt VoiceMesh Mod for Claude Code on macOS or Windows with visible progress:

```sh
npx --yes --allow-scripts=claude-voice-mod claude-voice-mod@latest
```

With pnpm, run the installer directly:

```sh
pnpm dlx claude-voice-mod@latest
```

Install Node.js 22.19 or later first. Installation downloads the matching [GitHub release](https://github.com/hopetonp/claude-voice-mod/releases/latest), checks its SHA-256 digest, and runs its installer. It requires the Claude CLI and Chrome; it does not bundle Node, compile code, or require Rust. Restart Claude after installation.

For a global installation, use `npm install --global --foreground-scripts --allow-scripts=claude-voice-mod claude-voice-mod@latest` to permit VoiceMesh's setup script and show installer output. This package supports macOS arm64, macOS x64, and Windows x64.

Newer npm versions require local approval for install scripts. The `--allow-scripts=claude-voice-mod` flag approves only this package for that command, following [npm's script-approval policy](https://docs.npmjs.com/cli/commands/npm-install-scripts/). If npm already installed the global command but warned that setup was skipped or not on its allowed list, run `claude-voice-mod` explicitly to finish setup, then restart Claude. The same explicit command works when lifecycle scripts were disabled during package installation.

If a global installation fails, run `npm uninstall --global claude-voice-mod` before trying again to remove leftover npm launcher files that can cause `EEXIST`. Using `npx` avoids creating global launchers.
