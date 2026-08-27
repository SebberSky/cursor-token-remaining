#!/usr/bin/env bash
# Install Token Remaining into one VS Code-compatible IDE per run.
# Scans every IDE on the machine, then asks which one to install into.
#
# One-liner (no clone):
#   curl -fsSL https://github.com/SebberSky/cursor-token-remaining/releases/latest/download/bootstrap.sh | bash
#
# From a local checkout:
#   ./install.sh
#
# Non-interactive:
#   TOKEN_REMAINING_IDE=1 ./install.sh
#   TOKEN_REMAINING_IDE=Cursor ./install.sh
#
# Extra CLIs (colon-separated):
#   TOKEN_REMAINING_BINS="/path/to/foo:/path/to/bar" ./install.sh
#
set -euo pipefail

REPO="${TOKEN_REMAINING_REPO:-SebberSky/cursor-token-remaining}"
REF="${TOKEN_REMAINING_REF:-main}"
FORCE_BUILD="${TOKEN_REMAINING_FORCE_BUILD:-0}"
CLEANUP_ROOT=0
ROOT=""
TMP=""

KNOWN_CLIS=(
  cursor cursor-nightly cursor-dev
  code code-insiders code-oss code-exploration
  codium codium-insiders
  windsurf windsurf-next windsurf-dev
  trae trae-cn
  kiro void positron pearai pear
  antigravity qoder lingma comate theia
  vscode vscodium
)

have_cmd() {
  command -v "$1" >/dev/null 2>&1
}

env_bin_name() {
  printf '%s' "$1" | tr '[:lower:]-' '[:upper:]_'
}

emit_cli() {
  local bin="${1:-}"
  [[ -n "${bin}" ]] || return 0
  [[ -f "${bin}" || -L "${bin}" ]] || return 0
  [[ -x "${bin}" ]] || return 0
  local base
  base="$(basename "${bin}")"
  base="${base%.cmd}"
  base="${base%.exe}"
  case "${base}" in
    rg | node | python | python3 | *-tunnel | code-tunnel) return 0 ;;
  esac
  echo "${bin}"
}

scan_bin_dir() {
  local bindir="$1"
  local bin base has_named=0
  [[ -d "${bindir}" ]] || return 0
  for bin in "${bindir}"/*; do
    [[ -e "${bin}" ]] || continue
    base="$(basename "${bin}")"
    base="${base%.cmd}"
    base="${base%.exe}"
    case "${base}" in
      code | rg | node | python | python3 | *-tunnel) continue ;;
    esac
    if [[ -x "${bin}" ]]; then
      has_named=1
    fi
  done
  for bin in "${bindir}"/*; do
    base="$(basename "${bin}")"
    base="${base%.cmd}"
    base="${base%.exe}"
    if [[ "${has_named}" -eq 1 && "${base}" == "code" ]]; then
      continue
    fi
    emit_cli "${bin}"
  done
}

scan_product_tree() {
  local root="$1"
  local maxdepth="${2:-6}"
  local product bindir
  [[ -d "${root}" ]] || return 0
  while IFS= read -r product; do
    [[ -f "${product}" ]] || continue
    bindir="$(dirname "${product}")/bin"
    scan_bin_dir "${bindir}"
  done < <(find "${root}" -maxdepth "${maxdepth}" -name product.json 2>/dev/null || true)
}

scan_macos_apps() {
  local dir app
  for dir in "/Applications" "${HOME}/Applications"; do
    [[ -d "${dir}" ]] || continue
    for app in "${dir}"/*.app; do
      [[ -d "${app}" ]] || continue
      if [[ -f "${app}/Contents/Resources/app/product.json" ]]; then
        scan_bin_dir "${app}/Contents/Resources/app/bin"
      fi
    done
  done
}

scan_linux_roots() {
  local root
  for root in \
    /opt \
    /usr/share \
    /usr/lib \
    "${HOME}/.local/share" \
    "${HOME}/.local/opt"; do
    scan_product_tree "${root}" 6
  done
}

scan_windows_roots() {
  local root
  for root in \
    "${LOCALAPPDATA:-}/Programs" \
    "${LOCALAPPDATA:-}" \
    "${PROGRAMFILES:-}" \
    "${PROGRAMFILES:-} (x86)"; do
    scan_product_tree "${root}" 7
  done
}

candidate_bins() {
  local name resolved env_key extra
  if [[ -n "${TOKEN_REMAINING_BINS:-}" ]]; then
    IFS=':;' read -r -a extra <<< "${TOKEN_REMAINING_BINS}"
    for name in "${extra[@]}"; do
      emit_cli "${name}"
    done
  fi

  for name in "${KNOWN_CLIS[@]}"; do
    env_key="$(env_bin_name "${name}")_BIN"
    if [[ -n "${!env_key:-}" ]]; then
      emit_cli "${!env_key}"
    fi
    resolved="$(command -v "${name}" 2>/dev/null || true)"
    if [[ -n "${resolved}" ]]; then
      emit_cli "${resolved}"
    fi
  done

  scan_macos_apps
  scan_linux_roots
  if [[ "${OSTYPE:-}" == msys* || "${OSTYPE:-}" == cygwin* || "${OSTYPE:-}" == mingw* ]]; then
    scan_windows_roots
  fi
}

list_unique_bins() {
  candidate_bins | awk 'NF && !seen[$0]++'
}

ide_label() {
  local bin="$1"
  local app
  app="$(printf '%s\n' "${bin}" | sed -n 's|.*/\([^/]*\)\.app/.*|\1|p')"
  if [[ -n "${app}" ]]; then
    printf '%s\n' "${app}"
    return
  fi
  basename "${bin}"
}

pick_one_cli() {
  local -a bins=()
  local -a labels=()
  local line i want choice lab base

  while IFS= read -r line; do
    bins+=("${line}")
    labels+=("$(ide_label "${line}")")
  done < <(list_unique_bins)

  if [[ ${#bins[@]} -eq 0 ]]; then
    return 1
  fi

  if [[ -n "${TOKEN_REMAINING_IDE:-}" ]]; then
    want="$(printf '%s' "${TOKEN_REMAINING_IDE}" | tr '[:upper:]' '[:lower:]')"
    if [[ "${want}" =~ ^[0-9]+$ ]]; then
      i=$((want - 1))
      if [[ "${i}" -ge 0 && "${i}" -lt ${#bins[@]} ]]; then
        printf '%s\n' "${bins[$i]}"
        return 0
      fi
    fi
    for i in "${!bins[@]}"; do
      lab="$(printf '%s' "${labels[$i]}" | tr '[:upper:]' '[:lower:]')"
      base="$(basename "${bins[$i]}" | tr '[:upper:]' '[:lower:]')"
      if [[ "${lab}" == "${want}" || "${base}" == "${want}" ]]; then
        printf '%s\n' "${bins[$i]}"
        return 0
      fi
    done
    echo "TOKEN_REMAINING_IDE=${TOKEN_REMAINING_IDE} ไม่ตรงกับ IDE ที่เจอ" >&2
    return 1
  fi

  echo "พบ ${#bins[@]} IDE — เลือกอันเดียวต่อรอบ:" >&2
  for i in "${!bins[@]}"; do
    printf '  %d) %s\n' "$((i + 1))" "${labels[$i]}" >&2
  done

  if [[ ! -r /dev/tty ]]; then
    echo "ไม่มี TTY — ใช้ TOKEN_REMAINING_IDE=1 หรือ TOKEN_REMAINING_IDE=Cursor" >&2
    return 1
  fi

  while true; do
    printf 'หมายเลข (q ยกเลิก): ' >&2
    if ! read -r choice < /dev/tty; then
      return 1
    fi
    case "${choice}" in
      q | Q)
        echo "ยกเลิก" >&2
        return 2
        ;;
    esac
    if [[ "${choice}" =~ ^[0-9]+$ ]]; then
      i=$((choice - 1))
      if [[ "${i}" -ge 0 && "${i}" -lt ${#bins[@]} ]]; then
        printf '%s\n' "${bins[$i]}"
        return 0
      fi
    fi
    echo "เลือก 1–${#bins[@]} หรือ q" >&2
  done
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
  local bin=""
  local status=0

  echo "→ Scanning VS Code-compatible IDEs"
  set +e
  bin="$(pick_one_cli)"
  status=$?
  set -e

  if [[ "${status}" -eq 2 ]]; then
    exit 0
  fi
  if [[ "${status}" -ne 0 || -z "${bin}" ]]; then
    echo "⚠ No VS Code-compatible IDE CLI found, or no valid choice." >&2
    echo "  Open the IDE once, or add its CLI to PATH." >&2
    echo "  Non-interactive: TOKEN_REMAINING_IDE=1 ./install.sh" >&2
    echo "  Extra CLIs: TOKEN_REMAINING_BINS=/path/to/cli ./install.sh" >&2
    echo "  Zed / JetBrains / ChatGPT.app cannot load a VSIX — use the CLI or MCP there." >&2
    echo "  VSIX left at: ${vsix}" >&2
    CLEANUP_ROOT=0
    TMP=""
    exit 1
  fi

  echo "→ Installing into $(ide_label "${bin}")"
  if ! "${bin}" --install-extension "${vsix}" --force; then
    echo "Install failed via ${bin}" >&2
    echo "  VSIX left at: ${vsix}" >&2
    CLEANUP_ROOT=0
    TMP=""
    exit 1
  fi

  echo
  echo "Installed into $(ide_label "${bin}")."
  echo "Reload that IDE (Developer: Reload Window)."
}

resolve_release_vsix_url() {
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
  exit 0
fi

echo "→ No release VSIX available — building from source"
build_and_install
