# Claude Voice Mod

Requires **Node.js 22.19 or later**. Install it from [nodejs.org](https://nodejs.org); on Windows, prefer the official installer over an outdated nvm-windows installation.

Install the prebuilt VoiceMesh Mod for Claude Code on macOS or Windows with visible progress:

```sh
npx --yes claude-voice-mod@latest
```

With pnpm, run the installer directly:

```sh
pnpm dlx claude-voice-mod@latest
```

Install Node.js 22.19 or later first. Installation downloads the matching [GitHub release](https://github.com/hopetonp/claude-voice-mod/releases/latest), checks its SHA-256 digest, and runs its installer. It requires the Claude CLI and Chrome; it does not bundle Node, compile code, or require Rust. Restart Claude after installation.

For a global installation, use `npm install --global --foreground-scripts claude-voice-mod@latest` to show installer output. This package supports macOS arm64, macOS x64, and Windows x64. If npm lifecycle scripts are disabled, run the `claude-voice-mod` command explicitly after installing the package.

If a global installation fails, run `npm uninstall --global claude-voice-mod` before trying again to remove leftover npm launcher files that can cause `EEXIST`. Using `npx` avoids creating global launchers.
