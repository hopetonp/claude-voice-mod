# Publish prebuilt installers

The [Build installable packages](.github/workflows/release-packages.yml) workflow builds macOS arm64, macOS x64, and Windows x64 packages on GitHub-hosted runners. It puts the three ZIPs and `SHA256SUMS` in a **draft** GitHub Release. Each ZIP includes the built settings app, bundled Node runtime, local host, and both Claude Mods.

1. Commit the intended source and set `.claude-plugin/plugin.json` to the release version.
2. Push a matching `v<version>` tag. The workflow rejects a tag that differs from the Mod version.
3. Wait for all three build jobs and the draft release job to pass. Download and test each platform's ZIP, including installation and a voice conversation.
4. Publish the draft release on GitHub. The [prebuilt installation guide](INSTALL_WITH_CLAUDE.md) then points users to it as the latest release.

To check archive creation without making a release, run the workflow manually from GitHub Actions. Manual runs keep the ZIPs as workflow artifacts and do not create a release.

## npm beta installer

The `npm` job in `release-packages.yml` publishes `npm-installer/` using npm trusted publishing (GitHub OIDC). Configure the npm package's trusted publisher for `hopetonp/claude-voice-mod` and workflow filename `release-packages.yml`, with direct publishing allowed. No npm token is used.

Keep `npm-installer/package.json` at the Mod release version. Publishing a GitHub release triggers the npm beta job; its version and all four release assets must be present before npm publication. To publish an existing release, run the workflow manually with `publish_npm_tag` set to its tag (for example, `v0.1.215`). This skips package builds. Leave the input blank for the existing package-build smoke run.

Releases published by another workflow using `GITHUB_TOKEN` do not trigger a second workflow. In that case, dispatch the npm job explicitly after publishing the GitHub release.
