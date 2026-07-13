# Daily sticky note

[![License: MIT](https://img.shields.io/badge/license-MIT-blue)](./LICENSE)

A tiny sticky-note task list that lives on your screen and reminds you
when something's due. Local-first: it works immediately with no setup,
storing tasks on the one device. If you want it to follow you between
devices, you can connect your own free Firebase project from inside the
app - nothing to configure in the source code either way.

## What it does

- Draggable sticky note with a task list (text + optional time).
- Notifications when a timed task comes due (tap the bell icon to turn
  these on).
- **Points and levels** - completing tasks earns points and levels you up
  through a set of tongue-in-cheek ranks, with a progress bar and a
  level-up nudge. Points sync across devices when cloud sync is on.
- **A daily note** - a small positive / keep-learning line at the bottom,
  a new one each day, from a bundled pool that quietly tops itself up in
  the background (and works fine offline).
- **Multiple languages** - English, Spanish, French, and German;
  auto-detected, switchable from the sync panel.
- **Local by default** - tasks are stored on-device, no account, no
  network calls required, nothing to set up.
- **Optional cloud sync** - connect your own Firebase project via the
  link icon to sync across devices in real time, paired with a "sync
  code" you copy from one device and paste into another. Turn it off
  again any time; your tasks stay put.
- Desktop build: an always-on-top overlay window (see below).

## Try it

- **Web**: open `docs/index.html` in a browser, or deploy it as a static
  site (e.g. GitHub Pages - see below). Works immediately, local-only.
- **Desktop**: install a prebuilt build (below), or build from source with
  `make dev` (see [Desktop app](#desktop-app-always-on-top-overlay)).

Either way, cloud sync is opt-in and configured at runtime - see
[Connect cloud sync](#connect-cloud-sync-optional).

## Install the desktop app

Prebuilt installers for **macOS, Windows, and Linux** are on the
[Releases page](https://github.com/amarcu/daily-sticky-note/releases) -
download the one for your platform and run it. No toolchain needed.

Prefer a one-liner? These fetch and install the latest release for you:

**macOS / Linux**

```bash
curl -fsSL https://raw.githubusercontent.com/amarcu/daily-sticky-note/main/install.sh | bash
```

**Windows** (PowerShell)

```powershell
irm https://raw.githubusercontent.com/amarcu/daily-sticky-note/main/install.ps1 | iex
```

The one-liner picks the right asset from the latest release: a `.dmg`
copied into Applications on macOS, an `.AppImage` dropped into
`~/.local/bin` on Linux, or the `.exe` installer launched on Windows.

These builds are unsigned, so the OS warns once about an "unidentified
developer" - expected for a personal app (right-click > Open on macOS;
"More info > Run anyway" on Windows). Installers are published
automatically by [`.github/workflows/release.yml`](.github/workflows/release.yml)
whenever a `v*` tag is pushed.

### Staying up to date

Once installed, the desktop app **updates itself**: on launch it checks the
latest release and, if there's a newer version, shows a banner that
downloads, installs, and relaunches into it in one click. Nothing to
re-run. (The one-liners above still work any time you'd rather update by
hand.)

## Deploy the web version (optional)

1. Push this folder to a GitHub repo.
2. In the repo, go to **Settings > Pages**, set the source to your
   default branch and the `/docs` folder, and save. (The web UI lives in
   `docs/` so one copy of the files backs both the site and the desktop
   app.)
3. GitHub publishes it at `https://<your-username>.github.io/<repo-name>/`.

## Connect cloud sync (optional)

Skip this entirely if you're happy with tasks staying on one device.

### 1. Create a free Firebase project

1. Go to [console.firebase.google.com](https://console.firebase.google.com)
   and create a project (the free Spark plan is enough).
2. Click the `</>` (web app) icon to register a new web app - any
   nickname is fine. You don't need Firebase Hosting.
3. Firebase shows you a `firebaseConfig` object - copy it (the whole
   `{ ... }`).

### 2. Turn on Firestore and anonymous sign-in

1. In the Firebase console, go to **Build > Firestore Database** and
   create a database (production mode, any nearby region).
2. Go to **Build > Authentication > Sign-in method** and enable the
   **Anonymous** provider - this just gives the app a login-free
   identity to satisfy the security rule below.
3. In Firestore, go to the **Rules** tab, paste in the contents of
   [`firestore.rules`](./firestore.rules) from this repo, and publish.

### 3. Connect it from inside the app

Open the app, click the link icon, click "Connect Firebase for cloud
sync," and paste the config object from step 1 exactly as Firebase gave
it to you - unquoted keys and all, no need to reformat it into strict
JSON first. That's it - no file to edit, no rebuild needed. Do this on
a second device with the sync code shown after connecting, and both
devices share the list in real time.

#### A note on security

Access is controlled by knowing the sync code, not by a real permission
system - anyone who has (or guesses) your code can read and edit that
list. Sync codes are random UUIDs, so guessing one isn't practically
feasible, but this is "unguessable ID" security, the same model as a
Google Docs "anyone with the link" share. Treat your sync code like a
password.

Your Firebase config itself isn't a secret - it identifies your
project, it doesn't grant access on its own - but whoever has it can
use your project's free-tier quota, so don't publish it somewhere truly
public.

## Desktop app (always-on-top overlay)

The same `docs/index.html` / `style.css` / `app.js` also run inside a
small **Tauri** shell (`src-tauri/`, written in Rust) that turns the note
into a frameless, always-on-top window that floats above every other app
on your screen - not just your browser. It lives in your system tray /
menu bar rather than the dock or taskbar.

### Prerequisites

Building the desktop app needs the [Rust toolchain](https://rustup.rs)
plus your platform's Tauri prerequisites (Xcode Command Line Tools on
macOS; WebView2 + Build Tools on Windows; `webkit2gtk` and friends on
Linux) - see [Tauri's setup guide](https://tauri.app/start/prerequisites/).
Node.js is only used to run the Tauri CLI.

### Run it locally

The easiest way:

```bash
make dev            # installs the Tauri CLI if needed, then launches the app
```

On macOS you can skip the terminal entirely and **double-click
`run.command`** in Finder - it does the same install-if-needed-then-run.

`make` also gives you `make build` (desktop installer) and `make web`
(serve the browser version at http://localhost:4599). The underlying npm
commands still work directly if you prefer them:

```bash
npm install        # fetches the Tauri CLI
npm run dev         # builds the Rust shell and launches the app
```

### What's different from the browser version

- The window is exactly the size of the note - no page chrome.
- Drag it by its header; the OS moves the actual window now instead of a
  div, and remembers where you left it between launches.
- The link/bell icons work the same. A third "x" icon appears only in
  this build - it hides the note to the tray rather than closing it,
  since there's no window titlebar to do that from.
- Tray menu: show/hide, toggle always-on-top, open at login, check for
  updates, quit. Left-click the tray icon to show/hide; right-click for
  the menu. (The app also checks for updates on launch and every few
  hours while running.)
- `Cmd/Ctrl+Shift+D` toggles visibility from anywhere, even when
  another app is focused.

### Build an installer for yourself

```bash
npm run build
```

Produces a `.dmg` (mac), an NSIS `.exe` installer (Windows), or an
AppImage + `.deb` (Linux) under `src-tauri/target/release/bundle/`, using
the icons in `src-tauri/icons/`. Regenerate those from your own
1024x1024 PNG any time with `npm run icon` (it reads `build/icon.png`,
the placeholder that `build/make_icon.py` generates).

You can also build your own copy this way and install it directly. Since
Firebase config lives in the running app rather than the source, the same
build works identically for local-only use or cloud sync; nothing
project-specific gets baked in at build time.

## Publishing a new version

Releasing is a version bump plus a tag - CI does the rest (builds every
platform, signs the update artifacts, and publishes the release that
installed apps auto-update from):

1. Bump the version in `package.json`, `src-tauri/tauri.conf.json`, and
   `src-tauri/Cargo.toml` (keep the three in sync) and add a
   `CHANGELOG.md` entry.
2. Commit, then tag and push:
   ```bash
   git tag -a v1.3.3 -m "v1.3.3"
   git push origin main --tags
   ```
3. The release workflow builds the macOS/Windows/Linux installers, signs
   the updater artifacts, and publishes a release with a `latest.json`
   manifest. Within a launch or two, installed apps notice it and offer
   the update.

### Update signing key

Update artifacts are signed with a Tauri updater key (minisign) - separate
from OS code signing, so it works on these unsigned builds. The **public**
key is in `src-tauri/tauri.conf.json` (`plugins.updater.pubkey`); the
**private** key lives in the repo secrets `TAURI_SIGNING_PRIVATE_KEY` and
`TAURI_SIGNING_PRIVATE_KEY_PASSWORD`, with a local backup at
`~/.tauri/daily-sticky-note-updater.key`. Keep it safe - losing it means
existing installs won't accept future updates without a manual reinstall.

## Notes and limits

- The installer built above is unsigned. macOS Gatekeeper and Windows
  SmartScreen will both warn that the app is from an "unidentified
  developer" - normal for a personal build; allow it once (right-click
  > Open on mac; "More info > Run anyway" on Windows).
- Local-only tasks live in this browser's or app's local storage.
  Clearing site data (web) or uninstalling/resetting app data (desktop)
  clears them - there's no separate backup unless you turn on cloud
  sync.
- With cloud sync on, this is last-write-wins: editing the list on two
  devices at the exact same moment means the later write wins. Fine for
  a personal planner, not built for simultaneous multi-person editing.
- Notifications only fire while the app or browser tab is open. On the
  desktop build, OS notifications are most reliable from a packaged
  (`npm run build`) app; an unsigned macOS build may need to be allowed
  under System Settings > Notifications the first time.

## Changelog

See [CHANGELOG.md](./CHANGELOG.md) for what changed in each version.

## License

MIT - see [LICENSE](./LICENSE).
