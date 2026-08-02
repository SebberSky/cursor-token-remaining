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

```bash
npm install
npm run package
```

In Cursor: **Extensions: Install from VSIX…** → pick the generated `.vsix`.

Or press **F5** in this folder to launch an Extension Development Host.

## Auth

Reads your Cursor access token from the local `state.vscdb` (same store Cursor uses when signed in). No manual cookie paste.

## Commands

- `Cursor Tokens: Refresh`
- `Cursor Tokens: Show Meters`
