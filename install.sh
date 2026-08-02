#!/usr/bin/env bash
# Install Cursor Token Remaining (status-bar / panel meters).
#
# One-liner (no clone):
#   curl -fsSL https://github.com/SebberSky/cursor-token-remaining/releases/latest/download/bootstrap.sh | bash
#
# Or from raw main (after merge):
#   curl -fsSL https://raw.githubusercontent.com/SebberSky/cursor-token-remaining/main/install.sh | bash
#
# From a local checkout:
#   ./install.sh
#
set -euo pipefail

REPO="${TOKEN_REMAINING_REPO:-SebberSky/cursor-token-remaining}"
REF="${TOKEN_REMAINING_REF:-main}"
FORCE_BUILD="${TOKEN_REMAINING_FORCE_BUILD:-0}"
CLEANUP_ROOT=0
ROOT=""
TMP=""

have_cmd() {
  command -v "$1" >/dev/null 2>&1
}

find_cursor() {
  if [[ -n "${CURSOR_BIN:-}" && -x "${CURSOR_BIN}" ]]; then
    echo "${CURSOR_BIN}"
    return
  fi
  if [[ -x "/Applications/Cursor.app/Contents/Resources/app/bin/cursor" ]]; then
    echo "/Applications/Cursor.app/Contents/Resources/app/bin/cursor"
    return
  fi
  if have_cmd cursor; then
    command -v cursor
    return
  fi
  echo ""
}

download_file() {
  local url="$1"
  local dest="$2"
  if have_cmd curl; then
    curl -fsSL "${url}" -o "${dest}"
  elif have_cmd wget; then
    wget -qO "${dest}" "${url}"
  else
    echo "curl or wget required" >&2
    exit 1
  fi
}

download_repo() {
  local dest="$1"
  local url="https://github.com/${REPO}/archive/refs/heads/${REF}.tar.gz"
  if [[ "${REF}" == v* ]]; then
    url="https://github.com/${REPO}/archive/refs/tags/${REF}.tar.gz"
  fi

  echo "→ Downloading ${REPO}@${REF}"
  mkdir -p "${dest}"
  if have_cmd curl; then
    curl -fsSL "${url}" | tar -xz -C "${dest}" --strip-components=1
  elif have_cmd wget; then
    wget -qO- "${url}" | tar -xz -C "${dest}" --strip-components=1
  else
    echo "curl or wget required for source install" >&2
    exit 1
  fi
}

resolve_root() {
  local script_path="${BASH_SOURCE[0]:-}"
  if [[ -n "${script_path}" && "${script_path}" != "bash" && -f "${script_path}" ]]; then
    local script_dir
    script_dir="$(cd "$(dirname "${script_path}")" && pwd)"
    if [[ -f "${script_dir}/package.json" && -d "${script_dir}/src" ]]; then
      ROOT="${script_dir}"
      return
    fi
  fi

  ROOT="$(mktemp -d "${TMPDIR:-/tmp}/cursor-token-remaining.XXXXXX")"
  CLEANUP_ROOT=1
  download_repo "${ROOT}"
  if [[ ! -f "${ROOT}/package.json" ]]; then
    echo "Download succeeded but package.json is missing — check REPO/REF" >&2
    exit 1
  fi
}

cleanup() {
  if [[ -n "${TMP}" && -d "${TMP}" ]]; then
    rm -rf "${TMP}"
  fi
  if [[ "${CLEANUP_ROOT}" -eq 1 && -n "${ROOT}" && -d "${ROOT}" ]]; then
    rm -rf "${ROOT}"
  fi
}
trap cleanup EXIT

install_vsix() {
  local vsix="$1"
  local cursor_bin
  cursor_bin="$(find_cursor)"
  if [[ -z "${cursor_bin}" ]]; then
    echo "⚠ Cursor CLI not found." >&2
    echo "  Install Cursor, or set CURSOR_BIN, then re-run." >&2
    echo "  VSIX left at: ${vsix}" >&2
    CLEANUP_ROOT=0
    TMP=""
    exit 1
  fi
  echo "→ Installing via Cursor CLI (${cursor_bin})"
  "${cursor_bin}" --install-extension "${vsix}"
}

resolve_release_vsix_url() {
  # Prefer a stable alias; fall back to versioned / any *.vsix on the latest release.
  local candidates=(
    "https://github.com/${REPO}/releases/latest/download/extension.vsix"
    "https://github.com/${REPO}/releases/latest/download/cursor-token-remaining.vsix"
  )
  local url
  for url in "${candidates[@]}"; do
    if have_cmd curl; then
      if curl -fsSIL "${url}" >/dev/null 2>&1; then
        echo "${url}"
        return
      fi
    elif have_cmd wget; then
      if wget --spider -q "${url}" 2>/dev/null; then
        echo "${url}"
        return
      fi
    fi
  done

  local api="https://api.github.com/repos/${REPO}/releases/latest"
  local browser_url=""
  if have_cmd curl; then
    browser_url="$(curl -fsSL "${api}" 2>/dev/null | sed -n 's/.*"browser_download_url": "\([^"]*\.vsix\)".*/\1/p' | head -1 || true)"
  elif have_cmd wget; then
    browser_url="$(wget -qO- "${api}" 2>/dev/null | sed -n 's/.*"browser_download_url": "\([^"]*\.vsix\)".*/\1/p' | head -1 || true)"
  fi
  if [[ -n "${browser_url}" ]]; then
    echo "${browser_url}"
  fi
}

try_release_vsix() {
  if [[ "${FORCE_BUILD}" == "1" ]]; then
    return 1
  fi

  local url
  url="$(resolve_release_vsix_url)"
  if [[ -z "${url}" ]]; then
    return 1
  fi

  TMP="$(mktemp -d "${TMPDIR:-/tmp}/cursor-token-remaining-vsix.XXXXXX")"
  local vsix="${TMP}/cursor-token-remaining.vsix"

  echo "→ Fetching release VSIX"
  if ! download_file "${url}" "${vsix}" 2>/dev/null; then
    rm -rf "${TMP}"
    TMP=""
    return 1
  fi
  if [[ ! -s "${vsix}" ]]; then
    rm -rf "${TMP}"
    TMP=""
    return 1
  fi

  install_vsix "${vsix}"
  return 0
}

build_and_install() {
  if ! have_cmd npm; then
    echo "npm not found — cannot build from source" >&2
    echo "Install Node.js/npm, or publish a GitHub release VSIX." >&2
    exit 1
  fi

  resolve_root
  echo "→ Building VSIX from source"
  (
    cd "${ROOT}"
    if [[ -f package-lock.json ]]; then
      npm ci
    else
      npm install
    fi
    npm run package
  )

  local vsix
  vsix="$(ls -1 "${ROOT}"/cursor-token-remaining-*.vsix 2>/dev/null | sort -V | tail -1 || true)"
  if [[ -z "${vsix}" || ! -f "${vsix}" ]]; then
    echo "Build finished but no .vsix was produced" >&2
    exit 1
  fi

  install_vsix "${vsix}"
}

if try_release_vsix; then
  echo
  echo "Done. In Cursor: Developer: Reload Window"
  exit 0
fi

echo "→ No release VSIX available — building from source"
build_and_install
echo
echo "Done. In Cursor: Developer: Reload Window"
