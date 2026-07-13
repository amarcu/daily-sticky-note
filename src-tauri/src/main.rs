// Prevents a spare console window from opening alongside the app on Windows.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::sync::atomic::{AtomicBool, Ordering};

use tauri::{
    menu::{CheckMenuItem, CheckMenuItemBuilder, MenuBuilder, MenuItem, MenuItemBuilder},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle, Manager, WindowEvent, Wry,
};
use tauri_plugin_autostart::{MacosLauncher, ManagerExt as AutostartManagerExt};
use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Modifiers, Shortcut, ShortcutState};
use tauri_plugin_notification::NotificationExt;
use tauri_plugin_updater::UpdaterExt;

const MAIN_WINDOW: &str = "main";

/// Handles kept around so tray, shortcut, and menu handlers can all update the
/// same UI state (this replaces the module-level `let mainWindow`/`alwaysOnTop`
/// that the old Electron `main.js` leaned on).
struct TrayState {
    show_hide: MenuItem<Wry>,
    always_on_top_item: CheckMenuItem<Wry>,
    always_on_top: AtomicBool,
    open_at_login_item: CheckMenuItem<Wry>,
}

/// Show the note if it's hidden, hide it if it's showing - and keep the tray
/// menu label in sync, the same "Show note"/"Hide note" flip Electron did.
fn toggle_window(app: &AppHandle) {
    let Some(window) = app.get_webview_window(MAIN_WINDOW) else {
        return;
    };
    let was_visible = window.is_visible().unwrap_or(false);
    if was_visible {
        let _ = window.hide();
    } else {
        let _ = window.show();
        let _ = window.set_focus();
    }
    if let Some(state) = app.try_state::<TrayState>() {
        let _ = state
            .show_hide
            .set_text(if was_visible { "Show note" } else { "Hide note" });
    }
}

/// Fire an OS notification. Called from the frontend via
/// `window.__TAURI__.core.invoke('notify', { title, body })`.
#[tauri::command]
fn notify(app: AppHandle, title: String, body: String) {
    let _ = app
        .notification()
        .builder()
        .title(title)
        .body(body)
        .show();
}

// Ask the update endpoint whether a newer release exists. Returns the new
// version string, or null if we're already up to date. Called on launch from
// the frontend via `window.__TAURI__.core.invoke('check_update')`.
#[tauri::command]
async fn check_update(app: AppHandle) -> Result<Option<String>, String> {
    let update = app
        .updater()
        .map_err(|e| e.to_string())?
        .check()
        .await
        .map_err(|e| e.to_string())?;
    Ok(update.map(|u| u.version))
}

// Download and install the pending update, then relaunch into it. Invoked when
// the user clicks the update banner.
#[tauri::command]
async fn install_update(app: AppHandle) -> Result<(), String> {
    if let Some(update) = app
        .updater()
        .map_err(|e| e.to_string())?
        .check()
        .await
        .map_err(|e| e.to_string())?
    {
        update
            .download_and_install(|_chunk, _total| {}, || {})
            .await
            .map_err(|e| e.to_string())?;
        app.restart();
    }
    Ok(())
}

// Whether the app is registered to start at login (per-platform: a LaunchAgent
// on macOS, a Run registry key on Windows, an autostart .desktop on Linux - all
// handled by tauri-plugin-autostart).
#[tauri::command]
fn autostart_enabled(app: AppHandle) -> bool {
    app.autolaunch().is_enabled().unwrap_or(false)
}

// Turn start-at-login on or off, keep the tray checkbox in sync, and return the
// resulting state so the UI can reflect what actually happened.
#[tauri::command]
fn set_autostart(app: AppHandle, enable: bool) -> bool {
    let autostart = app.autolaunch();
    let _ = if enable {
        autostart.enable()
    } else {
        autostart.disable()
    };
    let now = autostart.is_enabled().unwrap_or(false);
    if let Some(state) = app.try_state::<TrayState>() {
        let _ = state.open_at_login_item.set_checked(now);
    }
    now
}

fn main() {
    // CommandOrControl+Shift+D, matching the old Electron global shortcut:
    // Cmd on macOS, Ctrl elsewhere.
    #[cfg(target_os = "macos")]
    let cmd_or_ctrl = Modifiers::SUPER;
    #[cfg(not(target_os = "macos"))]
    let cmd_or_ctrl = Modifiers::CONTROL;
    let toggle_shortcut = Shortcut::new(Some(cmd_or_ctrl | Modifiers::SHIFT), Code::KeyD);
    let handler_shortcut = toggle_shortcut;

    tauri::Builder::default()
        // Remembers window position/size between launches (was hand-rolled in
        // main.js via window-bounds.json).
        .plugin(tauri_plugin_window_state::Builder::default().build())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_autostart::init(
            MacosLauncher::LaunchAgent,
            None,
        ))
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(move |app, shortcut, event| {
                    if event.state() == ShortcutState::Pressed && shortcut == &handler_shortcut {
                        toggle_window(app);
                    }
                })
                .build(),
        )
        .invoke_handler(tauri::generate_handler![
            notify,
            check_update,
            install_update,
            autostart_enabled,
            set_autostart
        ])
        .setup(move |app| {
            // A menu-bar / tray widget, not a Dock app: keep it out of the
            // macOS Dock so it behaves like the Electron tray build did.
            #[cfg(target_os = "macos")]
            app.set_activation_policy(tauri::ActivationPolicy::Accessory);

            app.global_shortcut().register(toggle_shortcut)?;

            // Start at login by default, but only enable it once (the first
            // launch ever) - after that, respect whatever the user set via the
            // tray toggle, tracked by a marker file in the app config dir.
            let autostart = app.autolaunch();
            if let Ok(config_dir) = app.path().app_config_dir() {
                let marker = config_dir.join(".autostart-initialized");
                if !marker.exists() {
                    let _ = std::fs::create_dir_all(&config_dir);
                    let _ = autostart.enable();
                    let _ = std::fs::write(&marker, b"1");
                }
            }
            let login_enabled = autostart.is_enabled().unwrap_or(false);

            let show_hide = MenuItemBuilder::with_id("show_hide", "Hide note").build(app)?;
            let always_on_top_item =
                CheckMenuItemBuilder::with_id("always_on_top", "Always on top")
                    .checked(true)
                    .build(app)?;
            let open_at_login_item =
                CheckMenuItemBuilder::with_id("open_at_login", "Open at login")
                    .checked(login_enabled)
                    .build(app)?;
            let quit = MenuItemBuilder::with_id("quit", "Quit").build(app)?;
            let menu = MenuBuilder::new(app)
                .item(&show_hide)
                .item(&always_on_top_item)
                .item(&open_at_login_item)
                .separator()
                .item(&quit)
                .build()?;

            app.manage(TrayState {
                show_hide: show_hide.clone(),
                always_on_top_item: always_on_top_item.clone(),
                always_on_top: AtomicBool::new(true),
                open_at_login_item: open_at_login_item.clone(),
            });

            TrayIconBuilder::with_id("main")
                .icon(app.default_window_icon().unwrap().clone())
                .icon_as_template(true)
                .tooltip("Daily sticky note")
                .menu(&menu)
                .show_menu_on_left_click(false)
                .on_menu_event(|app, event| match event.id().as_ref() {
                    "show_hide" => toggle_window(app),
                    "always_on_top" => {
                        let state = app.state::<TrayState>();
                        let next = !state.always_on_top.load(Ordering::Relaxed);
                        state.always_on_top.store(next, Ordering::Relaxed);
                        let _ = state.always_on_top_item.set_checked(next);
                        if let Some(window) = app.get_webview_window(MAIN_WINDOW) {
                            let _ = window.set_always_on_top(next);
                        }
                    }
                    "open_at_login" => {
                        let autostart = app.autolaunch();
                        let enabled = autostart.is_enabled().unwrap_or(false);
                        let _ = if enabled {
                            autostart.disable()
                        } else {
                            autostart.enable()
                        };
                        let now = autostart.is_enabled().unwrap_or(false);
                        let _ = app.state::<TrayState>().open_at_login_item.set_checked(now);
                    }
                    "quit" => app.exit(0),
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        ..
                    } = event
                    {
                        toggle_window(tray.app_handle());
                    }
                })
                .build(app)?;

            Ok(())
        })
        // Frameless windows have no close button, but a Cmd+W / programmatic
        // close still fires here - hide to the tray instead of quitting, so the
        // widget keeps running in the background like it did under Electron.
        .on_window_event(|window, event| {
            if let WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                let _ = window.hide();
                if let Some(state) = window.app_handle().try_state::<TrayState>() {
                    let _ = state.show_hide.set_text("Show note");
                }
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running the Daily Sticky Note app");
}
