export const DEFAULT_FREE_COLOR = "#3ecf8e";
export const DEFAULT_API_COLOR = "#5b9cff";
export const DEFAULT_BACKGROUND = "transparent";

export const COLOR_PALETTE: { label: string; color: string }[] = [
  { label: "Green", color: "#3ecf8e" },
  { label: "Teal", color: "#14b8a6" },
  { label: "Cyan", color: "#22d3ee" },
  { label: "Blue", color: "#5b9cff" },
  { label: "Indigo", color: "#818cf8" },
  { label: "Violet", color: "#a78bfa" },
  { label: "Pink", color: "#f472b6" },
  { label: "Rose", color: "#fb7185" },
  { label: "Orange", color: "#fb923c" },
  { label: "Amber", color: "#fbbf24" },
  { label: "Lime", color: "#a3e635" },
  { label: "White", color: "#e5e7eb" },
  { label: "Dark", color: "#1f2937" },
  { label: "Black", color: "#111827" },
];

const PROVIDER_PALETTE: Record<string, string[]> = {
  cursor: [DEFAULT_FREE_COLOR, DEFAULT_API_COLOR],
  copilot: ["#a78bfa", "#818cf8", "#22d3ee"],
  claude: ["#fb923c", "#fbbf24", "#fb7185"],
  codex: ["#14b8a6", DEFAULT_FREE_COLOR],
  gemini: [DEFAULT_API_COLOR, "#22d3ee", "#818cf8", "#a78bfa"],
  windsurf: ["#22d3ee", "#a78bfa"],
};

const FIXED_FILLS: Record<string, string> = {
  "cursor.free": DEFAULT_FREE_COLOR,
  "cursor.api": DEFAULT_API_COLOR,
};

export function defaultFillFor(meterId: string, provider: string, index: number): string {
  if (FIXED_FILLS[meterId]) {
    return FIXED_FILLS[meterId];
  }
  const palette = PROVIDER_PALETTE[provider] ?? COLOR_PALETTE.map((c) => c.color);
  return palette[index % palette.length];
}

export function isTransparent(color: string | undefined): boolean {
  const v = (color ?? "").trim().toLowerCase();
  return !v || v === "transparent" || v === "none" || v === "clear";
}

export function normalizeHex(color: string): string | null {
  const t = color.trim();
  if (isTransparent(t)) {
    return "transparent";
  }
  if (/^#[0-9a-fA-F]{6}$/.test(t)) {
    return t.toLowerCase();
  }
  if (/^[0-9a-fA-F]{6}$/.test(t)) {
    return `#${t.toLowerCase()}`;
  }
  return null;
}

export function deepen(hex: string): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) {
    return hex;
  }
  const n = parseInt(m[1], 16);
  const r = Math.max(0, Math.round(((n >> 16) & 255) * 0.72));
  const g = Math.max(0, Math.round(((n >> 8) & 255) * 0.72));
  const b = Math.max(0, Math.round((n & 255) * 0.72));
  return `#${[r, g, b].map((x) => x.toString(16).padStart(2, "0")).join("")}`;
}
