#!/usr/bin/env bash
# One-liner installer for macOS and Linux. Downloads the latest prebuilt
# release for your platform and installs it - no toolchain required.
#
#   curl -fsSL https://raw.githubusercontent.com/amarcu/daily-sticky-note/main/install.sh | bash
#
set -euo pipefail

REPO="amarcu/daily-sticky-note"
API="https://api.github.com/repos/$REPO/releases/latest"

os="$(uname -s)"
arch="$(uname -m)"

echo "Looking up the latest release of $REPO..."
releases_json="$(curl -fsSL "$API")"

# Print the first asset download URL whose name matches the given regex.
asset_url() {
  echo "$releases_json" \
    | grep -o '"browser_download_url": *"[^"]*"' \
    | sed 's/.*"\(https[^"]*\)"/\1/' \
    | grep -iE "$1" \
    | head -n1
}

case "$os" in
  Darwin)
    if [ "$arch" = "arm64" ]; then
      url="$(asset_url 'aarch64.*\.dmg$')"
    else
      url="$(asset_url '(x64|x86_64).*\.dmg$')"
    fi
    [ -n "${url:-}" ] || url="$(asset_url '\.dmg$')"
    [ -n "${url:-}" ] || { echo "No .dmg asset found in the latest release." >&2; exit 1; }

    tmp="$(mktemp -d)"
    echo "Downloading $(basename "$url")..."
    curl -fsSL "$url" -o "$tmp/app.dmg"

    echo "Mounting..."
    mnt="$(hdiutil attach -nobrowse -quiet "$tmp/app.dmg" | grep -o '/Volumes/[^ ]*' | tail -n1)"
    app="$(find "$mnt" -maxdepth 1 -name '*.app' | head -n1)"
    [ -n "$app" ] || { hdiutil detach "$mnt" -quiet || true; echo "No .app inside the dmg." >&2; exit 1; }

    if [ -w /Applications ]; then dest=/Applications; else dest="$HOME/Applications"; mkdir -p "$dest"; fi
    echo "Installing to $dest..."
    rm -rf "$dest/$(basename "$app")"
    cp -R "$app" "$dest/"
    xattr -dr com.apple.quarantine "$dest/$(basename "$app")" 2>/dev/null || true
    hdiutil detach "$mnt" -quiet || true
    rm -rf "$tmp"
    echo "Done. Launch it from $dest (right-click > Open the first time)."
    ;;

  Linux)
    url="$(asset_url '\.AppImage$')"
    [ -n "${url:-}" ] || { echo "No .AppImage asset found in the latest release." >&2; exit 1; }
    dest="${XDG_BIN_HOME:-$HOME/.local/bin}"
    mkdir -p "$dest"
    out="$dest/daily-sticky-note.AppImage"
    echo "Downloading $(basename "$url")..."
    curl -fsSL "$url" -o "$out"
    chmod +x "$out"
    echo "Done. Installed to $out"
    case ":$PATH:" in
      *":$dest:"*) echo "Run it with: daily-sticky-note.AppImage" ;;
      *) echo "Run it with: $out   (add $dest to your PATH to launch it by name)" ;;
    esac
    ;;

  *)
    echo "Unsupported OS: $os. On Windows use install.ps1 instead." >&2
    exit 1
    ;;
esac
