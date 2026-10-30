# Google Drive: Qalam's own sign-in

Qalam reaches Google Drive in two ways:

- **Through Claude Code.** Anyone who has added Google Drive to claude.ai (**Settings ▸ Connectors**) can pick Drive files in Qalam with no setup. Each step runs through Claude Code and takes a few seconds.
- **Qalam's own Google sign-in**, to Drive's API, for instant browsing without Claude Code. It needs a Google OAuth client that belongs to Qalam. A copy of Qalam without one doesn't offer it. This page is about setting that client up.

The sign-in asks only for `drive.readonly`: Qalam can see and read the person's files, and never change them. The tokens stay in this computer's Keychain (`connector:drive:oauth`), and Disconnect revokes them at Google.

## Once: the Google client

1. **Make a project.** In the [Google Cloud console](https://console.cloud.google.com/), create a project, for example "Qalam Studio".
2. **Turn on the Drive API.** In **APIs & Services ▸ Library**, find **Google Drive API** and click **Enable**.
3. **Set up the sign-in screen.** In **Google Auth Platform**:
   - **Branding:** set the app's name (Qalam Studio), a support email and a logo.
   - **Audience:** pick **External** and leave it in **Testing**. Under **Test users**, add the Google accounts that will sign in, yours first.
   - **Data access:** add the scope `https://www.googleapis.com/auth/drive.readonly`.
4. **Make the client.** In **Clients ▸ Create client**, pick **Desktop app** and name it "Qalam Studio". Copy its client ID and client secret.

   A Desktop client's secret isn't a real secret: Google expects it to ship inside an installed app. Qalam's sign-in uses PKCE, and its answer comes back only to a listener on `127.0.0.1` that's open for that one sign-in.
5. **Give them to Qalam.** For `pnpm dev`, put them in `.env.local` and start it again:

   ```
   QALAM_GOOGLE_CLIENT_ID=1234567890-abc.apps.googleusercontent.com
   QALAM_GOOGLE_CLIENT_SECRET=GOCSPX-…
   ```

   The Google Drive card in Connections, and the Drive picker in the chat box, now offer **Sign in with Google**. The packaged app reads the same two variables from its environment; building them into releases comes later, as for the GitHub App's `QALAM_GITHUB_CLIENT_ID`.

## What Google allows

- **While the app is in Testing,** only the test users can sign in (up to 100). Google ends their sign-ins after 7 days, and Qalam's card then says **Sign in again**.
- **`drive.readonly` is a restricted scope.** To take the app out of Testing for everyone, Google has to verify it, including a security assessment every year. Until then, people outside the test users can't sign in, and test users see a "Google hasn't verified this app" screen they can click through.
- **The other way round it:** the `drive.file` scope with Google's own file picker needs no assessment, but Qalam then sees only the files picked in Google's picker, not folders it can browse itself. Qalam doesn't do that today.

## Checking it

`pnpm vitest run server/connectors/google.test.ts` runs the whole sign-in, refresh, revoke, listing and reading against a stand-in Google. Against the real one, sign in from Connections, then pick a Doc, a Sheet and a PDF in the chat box's Drive picker (the idea door of the first run).
