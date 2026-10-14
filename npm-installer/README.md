# Claude Voice Mod

Install the prebuilt VoiceMesh Mod for Claude Code on macOS or Windows:

```sh
npm install --global claude-voice-mod@beta
```

With pnpm, run the installer directly:

```sh
pnpm dlx claude-voice-mod@beta
```

Installation downloads the matching [v0.1.211 Beta GitHub release](https://github.com/hopetonp/claude-voice-mod/releases/tag/v0.1.211), checks its SHA-256 digest, and runs the bundled installer. It requires the Claude CLI and Chrome; it does not compile code or require Rust. Restart Claude after installation.

This package supports macOS arm64, macOS x64, and Windows x64. If npm lifecycle scripts are disabled, the installer does not run.
