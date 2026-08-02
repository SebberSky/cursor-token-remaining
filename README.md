# Cursor Token Remaining

Minimal Cursor extension: two horizontal token meters for **free** (`autoPercentUsed`) and **api** (`apiPercentUsed`).

## What you get

- Panel view **Tokens → Token Meters** with two tubes, centered `%`, and a water-ripple animation when values change
- Compact status bar items (`free N%` / `api N%`) — color lives in the tube text (no status-bar background)
- Hover a tube → agent breakdown (`xxx/yyy zz%`)
- Click a tube → change fill / background color
- Refresh when an agent transcript settles after a prompt finishes
- Background poll (default 60s)

## Install

### One-liner (no clone)

```bash
curl -fsSL https://github.com/SebberSky/cursor-token-remaining/releases/latest/download/install.sh | bash
```

Then in Cursor: **Developer: Reload Window**.

Optional pins:

```bash
# force rebuild from a branch/tag instead of the release VSIX
curl -fsSL https://github.com/SebberSky/cursor-token-remaining/releases/latest/download/install.sh \
  | TOKEN_REMAINING_FORCE_BUILD=1 TOKEN_REMAINING_REF=main bash
```

### From a clone

```bash
git clone https://github.com/SebberSky/cursor-token-remaining.git
cd cursor-token-remaining
./install.sh
```

Or manually:

```bash
npm install
npm run package
```

Then **Extensions: Install from VSIX…**, or press **F5** for an Extension Development Host.

## Auth

Reads your Cursor access token from the local `state.vscdb` (same store Cursor uses when signed in). No manual cookie paste.

## Commands

- `Cursor Tokens: Refresh`
- `Cursor Tokens: Show Meters`
