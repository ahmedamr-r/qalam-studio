# Releasing the Mac app

Qalam Studio ships as a signed, notarized Mac app for Apple silicon: a `.dmg` to install from, and a `.zip` the installed app updates itself from. GitHub Actions builds it from a version tag ([`.github/workflows/release.yml`](../.github/workflows/release.yml)) and uploads it as a **draft** release, which you check and publish. Intel Macs can run `npx qalam-studio` instead.

## Once: Apple and GitHub

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
   - builds, signs and notarizes the app;
   - uploads `Qalam-Studio-0.2.0-arm64.dmg`, the `.zip` and `latest-mac.yml` to a draft release.

   It stops if the Apple secrets aren't set.
4. Open the draft on GitHub, download the `.dmg`, and open the app from it on a Mac. It should open without any warning.
5. Write what's new, then **Publish release**. Publishing does two things:
   - Installed apps update to it: they look when they start and every six hours, and install it when you quit (or from **Qalam Studio ▸ Check for Updates…**).
   - The **Homebrew** workflow writes the new version into the tap.

To try a build without releasing, run the workflow by hand (**Actions ▸ Release ▸ Run workflow**). It builds without publishing, signed if the secrets are there, and keeps the files with the run for a week.

## On your own Mac

```bash
pnpm dist:mac
```

This puts the `.dmg`, the `.zip` and `latest-mac.yml` in `release/dist/`.
- **Signing:** electron-builder signs with a Developer ID certificate it finds in your keychain. Run `CSC_IDENTITY_AUTO_DISCOVERY=false pnpm dist:mac` to skip signing.
- **Notarizing:** it notarizes when `APPLE_API_KEY` (the `.p8` file's path), `APPLE_API_KEY_ID` and `APPLE_API_ISSUER` are set.
- **Unsigned builds:** these run on the Mac that built them, but can't update themselves, and another Mac refuses them once they're downloaded.

How it's put together:
- **Staging:** [`scripts/stage-app.mjs`](../scripts/stage-app.mjs) puts what the installed app loads in `release/app`: the built UI, the Node entries, and node-llama-cpp for search by meaning.
- **Packaging:** [`electron-builder.yml`](../electron-builder.yml) packages that folder.
- **The icon:** it's `build/icon.png`, rendered from `build/icon.svg` with `pnpm exec electron scripts/render-icon.mjs`.

The installed app checks for updates unless `QALAM_NO_UPDATES=1` is set.
