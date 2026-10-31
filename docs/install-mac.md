# Installing Qalam Studio on a Mac

The Mac app runs on Apple silicon (M1 or later) with macOS 13 or later. It isn't notarized by Apple yet, so macOS stops it the first time you open it. You allow it once, and from then on it opens like any other app.

## Install it

1. Download `Qalam-Studio-<version>-arm64.dmg` from the [latest release](https://github.com/ahmedamr-r/qalam-studio/releases/latest).
2. Open the `.dmg` (its window shows these steps too) and drag **Qalam Studio** into **Applications**.
3. Open **Qalam Studio** from Applications. macOS stops it this first time: carry on below.

## Open it the first time

**On macOS 15 (Sequoia) or later:**

1. Open Qalam Studio. macOS says it couldn't verify that Qalam Studio is free of malware. Click **Done**, not **Move to Trash**.
2. Open **System Settings** from the Apple menu, then **Privacy & Security** in the sidebar.
3. Scroll down to **Security**. Next to the line saying Qalam Studio was blocked, click **Open Anyway**.
4. macOS asks you to confirm: click **Open Anyway**, and enter your password or use Touch ID.

Qalam Studio opens, and you won't have to do this again for this version.

The button shows for about an hour after macOS stops the app. If it isn't there, open Qalam Studio again, then go back to Privacy & Security.

**On macOS 13 or 14:** in Applications, Control-click **Qalam Studio** (or right-click it), choose **Open**, then click **Open**.

## If that doesn't work

If macOS says Qalam Studio "is damaged and can't be opened", or Privacy & Security shows no **Open Anyway**, take the downloaded mark off the app in Terminal, then open it:

```bash
xattr -dr com.apple.quarantine "/Applications/Qalam Studio.app"
```

## Why macOS asks

macOS trusts an app from the web when its developer has paid for Apple's developer program and sent the app to Apple to check (notarization). Qalam Studio is early and isn't notarized yet. **Open Anyway** lets this one app past that check, so only use it for a copy you downloaded from [Qalam Studio's releases](https://github.com/ahmedamr-r/qalam-studio/releases). All of its code is on GitHub: you can read it, or build the app yourself (the README's [Try it](../README.md#try-it)).

## Updates

This copy can't update itself: macOS only lets a notarized app do that. When there's a newer version, Qalam Studio tells you, with a link to its download page.

1. Download the new `.dmg`.
2. Quit Qalam Studio. It keeps running in the menu bar when its window is closed, so quit it from its menu bar icon too.
3. Drag **Qalam Studio** from the `.dmg` into **Applications**, and choose **Replace**.
4. Open it the way you did the first time.

Your organizations stay where they are, in `~/Qalam`. macOS may ask once more whether Qalam can use the microphone.

## On an Intel Mac

The app is built for Apple silicon. On an Intel Mac, run Qalam from source (the README's [Try it](../README.md#try-it)).
