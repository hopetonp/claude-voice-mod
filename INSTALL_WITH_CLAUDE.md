# Install VoiceMesh from GitHub source

Give an AI agent with shell access on the target Mac or Windows PC this request:

> Read https://github.com/hopetonp/claude-voice-mod/blob/main/INSTALL_WITH_CLAUDE.md. Clone `https://github.com/hopetonp/claude-voice-mod.git`, build VoiceMesh from that checkout on this computer, and run the installer from the built package directory. Verify both Claude Mods and the local host. Tell me when to restart Claude. Do not download or build a ZIP.

## Instructions for Claude

Use a local agent session with shell access on the computer that will run VoiceMesh. Clone the repository, build on that computer, and install from the resulting directory. Do not use a GitHub-generated source archive as an installer: it lacks the compiled settings window and runtime. While the repository is private, GitHub authentication is required to clone it.

Confirm that Claude Code or Claude Desktop Code and the `claude` CLI are installed. Chrome is required for voice media. Building requires Git, Node.js 22.19 or later, npm, Rust, and Cargo. Windows also requires Visual Studio C++ build tools and the Windows SDK. If a required tool is missing, report it and stop rather than substituting an unrelated binary.

On either platform, clone and build the shared components:

```sh
git clone https://github.com/hopetonp/claude-voice-mod.git
cd claude-voice-mod
npm ci
npm run media:build
npm run settings:window:build
npm run plugin:stage
```

Record the checked-out commit with `git rev-parse --short HEAD` so the user knows what was installed. Use the commands below for the target platform. The `vendor/` dependency packages are part of the checkout; no installer archive is needed.

### macOS

Run on the target Mac. The build uses the architecture of the Node process and creates an installable directory without a ZIP:

```sh
npm run release:macos
package_dir="release/voicemesh-claude-macos-$(node -p 'process.arch')-$(node -p "require('./.claude-plugin/plugin.json').version")"
sh "$package_dir/install.sh"
```

Confirm that `release.json` in the package directory matches the current Mod version and Mac architecture. After installation, check that `claude plugin list` shows `voicemesh-controls` and `voicemesh-said` enabled, and `launchctl list com.voicemesh.claude-host` shows the host. Report any failure. Tell the user to restart Claude and open Voice settings to configure a provider key, model, and voice.

### Windows

Run on the target Windows PC in PowerShell. The Windows builder needs an official Node distribution of the same architecture as the build, containing `node.exe`, `npm.cmd`, `LICENSE`, and `node_modules\npm`. The installed Node directory may qualify; if it does not, use an official extracted Node distribution and pass its directory as `--node-dir`.

```powershell
$nodeDir = Split-Path (Get-Command node).Source
npm run release:windows -- --node-dir "$nodeDir"
$arch = node -p "process.arch"
& ".\release\voicemesh-claude-win-$arch\install.ps1"
```

Confirm that `release.json` in the package directory matches the current Mod version and Windows architecture. After installation, check that `claude plugin list` shows both Mods enabled, the installed `runtime\node.exe` has a running host process, and the Startup folder contains `VoiceMesh Claude Voice.lnk`. Report any failure. Tell the user to restart Claude and open Voice settings to configure a provider key, model, and voice.

The installers copy the built package to a durable location and register its bundled local Claude marketplace. Saved VoiceMesh settings and provider credentials are preserved during reinstall. The built package also contains `uninstall.sh` or `uninstall.ps1` to remove the host and Mods while preserving those settings. The source checkout can be removed after installation.
