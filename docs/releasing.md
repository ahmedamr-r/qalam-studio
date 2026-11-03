# Releasing the Mac app

Qalam Studio ships as a Mac app for Apple silicon: a `.dmg` to install from, and a `.zip` the installed app updates itself from. GitHub Actions builds it from a version tag ([`.github/workflows/release.yml`](../.github/workflows/release.yml)) and uploads it as a **draft** release, which you check and publish. Intel Macs can run `npx qalam-studio` instead.

How it's signed depends on the repository's Apple secrets:
- **With them** (below), it's signed with your Developer ID and notarized. It opens without a warning, updates itself, and gets a Homebrew cask.
- **Without them**, it's signed ad hoc. macOS stops it the first time and people open it with **Open Anyway** ([install-mac.md](install-mac.md)). It can't install an update itself, so it says a new version is out and opens its page. There's no Homebrew cask.

## Once: Apple and GitHub

This is for a notarized app. Skip it to release signed ad hoc.

1. **Join the Apple Developer Program** ($99 a year) at [developer.apple.com/programs](https://developer.apple.com/programs/). Apple only trusts an app downloaded from the web if a member signed it and Apple has checked it (notarization).
2. **Make a Developer ID Application certificate.** In Xcode, go to **Settings ▸ Accounts**, pick your team, click **Manage Certificates…**, then **+ ▸ Developer ID Application**. In Keychain Access, find "Developer ID Application: …" under **My Certificates**, then right-click ▸ **Export…** as a `.p12` with a password.
3. **Make an App Store Connect API key** for notarizing. In [App Store Connect](https://appstoreconnect.apple.com/access/integrations/api), go to **Users and Access ▸ Integrations ▸ Team Keys**, add a key with the **Developer** role, and download the `.p8` file (Apple lets you download it only once). Note the key's ID, and the Issuer ID shown above the list.
4. **Add the repository's secrets** in GitHub, under **Settings ▸ Secrets and variables ▸ Actions ▸ New repository secret**:

   | Secret | What goes in it |
   |---|---|
   | `MAC_CERTIFICATE` | The `.p12`, as base64: `base64 -i DeveloperID.p12 \| pbcopy` |
   | `MAC_CERTIFICATE_PASSWORD` | The password you exported it with |
   | `APPLE_API_KEY_P8` | The `.p8` file's contents, as they are |
   | `APPLE_API_KEY_ID` | The key's ID |
   | `APPLE_API_ISSUER` | The Issuer ID |

5. **Homebrew (optional).** Create a public repository named `homebrew-tap` under your account. Then make a fine-grained personal access token that can only write to that repository (**Repository access ▸ Only select repositories**, **Contents: Read and write**), and add it as the secret `HOMEBREW_TAP_TOKEN`. Each published release then updates the cask, so people can run `brew install --cask ahmedamr-r/tap/qalam-studio`. Homebrew now refuses apps that aren't signed, which is why the cask only comes with signed releases.

## Each release

1. Set the new version in `package.json` (for example `0.2.0`) and commit it.
2. Tag the commit and push the tag:

   ```bash
   git tag v0.2.0
   git push origin v0.2.0
   ```

3. The **Release** workflow:
   - runs the checks;
   - makes sure the tag matches `package.json`;
   - builds the app, signed and notarized with the Apple secrets, or signed ad hoc without them (the run shows a warning);
   - uploads `Qalam-Studio-0.2.0-arm64.dmg`, the `.zip` and `latest-mac.yml` to a draft release, which starts with how to install it ([`build/release-notes.md`](../build/release-notes.md)).

   It stops if only one of the two is set: the certificate and the notarizing key go together.
4. Open the draft on GitHub, download the `.dmg`, and open the app from it on a Mac. Notarized, it opens without any warning. Signed ad hoc, macOS stops it once, and [Open Anyway](install-mac.md) opens it.
5. Write what's new under the install notes, then **Publish release**. Publishing does two things:
   - Installed apps hear of it: they look when they start and every six hours (or from **Qalam Studio ▸ Check for Updates…**). A notarized app installs it when you quit; one signed ad hoc says it's out and opens its page.
   - For a notarized release, the **Homebrew** workflow writes the new version into the tap.

To try a build without releasing, run the workflow by hand (**Actions ▸ Release ▸ Run workflow**). It builds without publishing, signed as a tag would be, and keeps the files with the run for a week.

## On your own Mac

```bash
pnpm dist:mac
```

This puts the `.dmg`, the `.zip` and `latest-mac.yml` in `release/dist/`.
- **Signing:** electron-builder signs with a Developer ID certificate it finds in your keychain. Run `pnpm dist:mac:adhoc` to sign it ad hoc, as releases are without the Apple secrets; its `.dmg` window then shows how to open the app the first time.
- **Notarizing:** it notarizes when `APPLE_API_KEY` (the `.p8` file's path), `APPLE_API_KEY_ID` and `APPLE_API_ISSUER` are set.
- **Ad hoc:** another Mac stops it once it's downloaded, until **Open Anyway**, and it can't update itself.
- **Not signed at all** (`CSC_IDENTITY_AUTO_DISCOVERY=false`): it runs on the Mac that built it, but a downloaded copy reads as damaged, with no Open Anyway. Don't hand those out.

How it's put together:
- **Staging:** [`scripts/stage-app.mjs`](../scripts/stage-app.mjs) puts what the installed app loads in `release/app`: the built UI, the Node entries, and node-llama-cpp for search by meaning.
- **Packaging:** [`electron-builder.yml`](../electron-builder.yml) packages that folder.
- **The icon:** it's `build/icon.png`, rendered from `build/icon.svg` with `pnpm exec electron scripts/render-icon.mjs`.
- **The ad-hoc `.dmg` window:** its background is `build/dmg-open-anyway.tiff`, rendered at 1x and 2x from `build/dmg-open-anyway.html` with `pnpm exec electron scripts/render-dmg.mjs`. The page writes around where Finder puts the icons (electron-builder's layout), so keep those spots clear when you change it.

The installed app checks for updates unless `QALAM_NO_UPDATES=1` is set.

## Publishing to npm

`npx qalam-studio` runs the package on npm. It has to be published from an Apple silicon Mac with Xcode's Swift, on the repo's Node (`nvm use`): `prepack` builds everything and stops if the Mac helpers are missing (`scripts/check-pack.mjs`).

1. Bump `version` in `package.json`. npm keeps a version's number for good once it's used, so publishing can't really be taken back.
2. See what would go, with `npm publish --dry-run`. Then try it with empty caches, the way a stranger would:

   ```bash
   npm pack
   ```

   ```bash
   npm_config_cache=$(mktemp -d) electron_config_cache=$(mktemp -d) QALAM_HOME=$(mktemp -d) npx --yes --package=./qalam-studio-<version>.tgz qalam-studio
   ```

3. `npm login`, then `npm publish`, which asks you to approve it in the browser. npm may take a few minutes to make a version available: on the first publish it answered with a placeholder, `0.0.0-stage`, for about 5 minutes, and `npx` gets that until it's done, so check `npm view qalam-studio version` before telling anyone.
4. Try the real thing, again with empty caches:

   ```bash
   npm_config_cache=$(mktemp -d) electron_config_cache=$(mktemp -d) QALAM_HOME=$(mktemp -d) npx --yes qalam-studio@latest
   ```

`npm audit` on an install reports 2 critical and 2 high in `simple-git` (November 2026). It comes through `node-llama-cpp`, at its newest, with no fix available. `node-llama-cpp` only uses it to clone llama.cpp at a fixed address when it has to build from source, so nothing from outside reaches it. `npx` doesn't print this, but `npm install` does, so someone may ask.

### When a release is a launch

Each step is public, so go in this order, and don't start one until the one before it is done:

1. Publish to npm, and try it (above), including pressing Send and going to another app: a window out of sight behaves differently, and nothing but a real window shows it.
2. Merge into `main` and push, since the README says `npx qalam-studio` works.
3. Tag the version and push the tag, then publish the draft release `release.yml` makes, so the Mac app the README links to has the same loop.
4. Change GitHub's description to the README's first sentence.

