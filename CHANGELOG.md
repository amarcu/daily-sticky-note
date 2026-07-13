# Changelog

All notable changes to this project are documented here.
Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [1.5.1]

### Added

- **"Check for updates" in the tray menu**: checks immediately and either shows
  the in-app update banner (bringing the note to the front) or a "You're up to
  date" notification. The app also re-checks automatically every 6 hours while
  running, instead of only at launch.

### Changed

- The per-task focus button is now a **stopwatch icon**, matching a new
  stopwatch next to the Focus Mode label, and starting a session **pulses the
  widget** - so the task button and the timer visibly read as one feature.

## [1.5.0]

### Added

- **Focus Mode sessions are now tied to tasks.** Every open task has a small
  play button that starts a session *on that task* (using your last-picked
  duration); the running timer shows the task's name, the task's row is
  highlighted while you focus on it, and the end alert names the task
  ("Your session on 'X' is done - time to switch!").
- **End-of-session prompt.** When a focus session finishes, the timer offers
  the next step in one tap: **Mark done** (checks the task off and awards
  points), **5m break** (a short break timer, with its own "Break's over"
  nudge), or **Focus next** (starts a session on the next open task).

## [1.4.9]

### Added

- **Notifications setup**: turning on reminders now fires a "Reminders on"
  confirmation notification (on macOS this registers the app in Notification
  Center so you can allow it), the browser build requests permission when you
  enable reminders or start a timer, and the settings panel has an **"Open
  settings"** button that jumps straight to the OS notification settings if
  notifications are being blocked.

## [1.4.8]

### Fixed

- **Couldn't expand a collapsed note when a timer was running**: the task-count
  and timer badges plus the action buttons overflowed the narrow bar, pushing
  the expand button off-screen. Now only one badge shows in the compact bar (the
  timer if one's running), the action buttons are never pushed off, and
  **double-clicking the header** collapses/expands as a fallback.

## [1.4.7]

### Changed

- Focus Mode now sets its duration with an **iOS Clock-style spinner wheel**
  (roll the hours and minutes drums) instead of preset buttons, with a Start
  button. The last picked duration is remembered. Countdowns of an hour or more
  show as H:MM:SS.

## [1.4.6]

### Changed

- Renamed the focus timer to **"Focus Mode"** in the widget and the completion
  message.

## [1.4.5]

### Added

- **Focus timer**: a small widget at the bottom of the note - pick 15m / 25m /
  45m / 1h and it counts down, with pause/reset. When it finishes you get a
  notification (and a little confetti). While the note is collapsed, the
  remaining time shows in the header bar. A running timer survives a reload or
  relaunch.

## [1.4.4]

### Added

- **"Start at login" toggle in the app** (desktop): the settings panel now has a
  clear on/off switch for launching at login, showing the real state, with a
  short note on how it works. It stays in sync with the tray-menu option. This
  makes the autostart setting discoverable instead of hidden in the tray.

## [1.4.3]

### Added

- **Resizable window** (desktop): drag the window's bottom edge to make it
  taller and see more tasks at once. The task list now fills the available
  height and only scrolls internally when it runs out of room. Width stays
  fixed; the size is remembered between launches. Collapsing still shrinks the
  window to a slim header bar and expanding restores your chosen height.

## [1.4.2]

### Added

- **Start at login** (desktop): the app now opens automatically when you log
  in. It's on by default and can be toggled from the tray menu ("Open at
  login").
- **Compact / expand**: a chevron button in the header collapses the note to a
  slim bar (showing a "N left" task count) and expands it again, with a smooth
  animation. On the desktop the window shrinks and grows to match. The state is
  remembered.

## [1.4.1]

### Changed

- Made the animations bolder and more visible: bigger, brighter, longer-lived
  confetti (and a much larger burst on level-ups), a punchier level-up toast,
  and a new task now pops in with a green highlight ring.

### Fixed

- The task list no longer flickers a scrollbar while a new task animates in.
  The entrance used a springy overshoot that briefly pushed the row past its
  box; it now grows with an ease-out that never exceeds its resting size, and
  the highlight is a box-shadow (which doesn't affect layout). The task-list
  scrollbar is also now thin and subtle.

## [1.4.0]

### Added

- **Animation & "juice"**: a confetti burst when you complete a task (a
  bigger one on a level-up), new tasks spring into the list, the level-up
  toast bounces in, overdue tasks gently throb, and on the desktop the
  note lifts while you drag it and springs back when you drop it. Bursts
  are one-shot (no idle battery drain) and everything respects
  `prefers-reduced-motion`.

### Fixed

- The update banner no longer flashed as an empty bar when no update was
  pending (an author `display` rule was overriding the `hidden` attribute).

## [1.3.2]

### Added

- **In-app auto-update** (desktop). On launch the app checks the latest
  GitHub release and, if a newer version exists, shows a banner that
  downloads, installs, and relaunches into it on one click. Updates are
  signed with the project's own updater key (independent of OS code
  signing, so it works on the unsigned builds), and the release workflow
  publishes the signed artifacts + `latest.json` manifest automatically.

## [1.3.1]

### Fixed

- Desktop window: no more stray scrollbars on the right/bottom. The note's
  content had grown taller than the fixed window (and its slight tilt
  pushed it sideways), so the webview showed page scrollbars. The window
  now auto-sizes to hug the note, page scrollbars are hidden, and the tilt
  is dropped in the frameless window.
- macOS one-liner installer: fixed a mount-parsing bug (`hdiutil -quiet`
  hid the mount path, and the volume name has spaces) that made
  `install.sh` fail right after "Mounting…".

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
