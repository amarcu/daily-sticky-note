# Changelog

All notable changes to this project are documented here.
Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

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
