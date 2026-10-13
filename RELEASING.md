# Publish prebuilt installers

The [Build installable packages](.github/workflows/release-packages.yml) workflow builds macOS arm64, macOS x64, and Windows x64 packages on GitHub-hosted runners. It puts the three ZIPs and `SHA256SUMS` in a **draft** GitHub Release. Each ZIP includes the built settings app, bundled Node runtime, local host, and both Claude Mods.

1. Commit the intended source and set `.claude-plugin/plugin.json` to the release version.
2. Push a matching `v<version>` tag. The workflow rejects a tag that differs from the Mod version.
3. Wait for all three build jobs and the draft release job to pass. Download and test each platform's ZIP, including installation and a voice conversation.
4. Publish the draft release on GitHub. The [prebuilt installation guide](INSTALL_WITH_CLAUDE.md) then points users to it as the latest release.

To check archive creation without making a release, run the workflow manually from GitHub Actions. Manual runs keep the ZIPs as workflow artifacts and do not create a release.
