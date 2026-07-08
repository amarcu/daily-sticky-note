#!/bin/bash
# Double-click launcher for macOS (Finder runs .command files in Terminal).
# Installs dependencies the first time, then starts the desktop app.
cd "$(dirname "$0")" || exit 1

if ! command -v cargo >/dev/null 2>&1; then
  echo "Rust is required to build the desktop app."
  echo "Install it from https://rustup.rs and run this again."
  read -r -p "Press Return to close. "
  exit 1
fi

if [ ! -d node_modules ]; then
  echo "First run: installing the Tauri CLI..."
  npm install || { read -r -p "npm install failed. Press Return to close. "; exit 1; }
fi

npm run dev
