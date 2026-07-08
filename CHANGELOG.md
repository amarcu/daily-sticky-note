# Changelog

All notable changes to this project are documented here.
Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [1.3.0]

### Added

- **Multiple languages**: English, Spanish, French, and German. The app
  auto-detects from your browser/OS and you can switch any time from a
  picker at the top of the sync panel. UI, level names, dates, and the
  daily quote all follow the choice.
- **Points and levels**: completing a task earns points and levels you up
  through a set of tongue-in-cheek ranks (Sticky Novice → Cosmic
  Completionist), shown as a progress bar with a level-up toast. Points
  sync across devices when cloud sync is on, and only ever go up (a task
  can't be farmed by ticking it on and off).
- **Bigger daily-quote pool**: a bundled set per language plus a
  background top-up. Every few days the app quietly tries to fetch a few
  more (English) quotes into a local cache and reuses them offline; if
  anything about the fetch fails it silently keeps the bundled set.
- **Easier launch**: a `Makefile` (`make dev` / `make build` / `make web`,
  which install dependencies as needed) and a double-click `run.command`
  launcher for macOS.
- **Prebuilt installers for macOS, Windows, and Linux**, built and
  published to GitHub Releases by a Tauri release workflow on each `v*`
  tag, plus one-liner installers (`install.sh` for macOS/Linux,
  `install.ps1` for Windows) that fetch the right asset from the latest
  release.

## [1.2.0]

### Added

- A daily note at the bottom of the sticky - one small positive /
  keep-learning nudge (including "Learn something new every day"), the
  same one all day and rotating to a new one each day.
- The note now eases back to ~78% opacity while the app isn't focused and
  snaps to full opacity when you focus or hover it, so it sits quietly
  over whatever you're working on.

### Fixed

- The reminders bell is a real on/off toggle again. It could previously
  only be switched on - stuck on in the desktop build - so clicking it
  now turns reminders back off. Its tooltip and pressed state show whether
  reminders are on, and the choice is remembered per device.

## [1.1.0]

### Changed

- **Desktop shell rewritten from Electron to Tauri (Rust).** The
  always-on-top overlay, tray menu, global show/hide shortcut, and
  saved window position are now a small Rust program (`src-tauri/`)
  instead of Electron's `main.js`, producing a much smaller,
  lower-memory native binary. The UI (`docs/`) is unchanged
  HTML/CSS/JS, shared by the web and desktop builds exactly as before.
- Shared web UI moved into `docs/` so one copy is served by both
  GitHub Pages and the desktop build.
- Local-first by default: tasks save to local storage with no Firebase
  project required at all.
- Firebase config is entered at runtime from the app's sync panel and
  stored on-device, instead of being hard-coded in `app.js` at build
  time. Cloud sync is fully optional and toggle-able without editing
  source or rebuilding.

### Removed

- The Electron build (`main.js`, `electron`, `electron-builder`) and its
  `electron-updater` auto-update path. This repo does not publish built
  installers; build your own locally with `npm run build`.

## [1.0.0]

### Added

- Draggable sticky-note task list with optional due times.
- Real-time sync between devices via Firestore, paired with a sync code.
- Browser notifications when a task comes due.
- Desktop overlay build (Electron): always-on-top window, tray icon,
  global show/hide shortcut, and self-updates from GitHub Releases.
