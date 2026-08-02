import * as vscode from "vscode";
import type { AgentSpend, TokenUsage } from "./usage";
import {
  COLOR_PALETTE,
  isTransparent,
  normalizeHex,
  type MeterKind,
} from "./colors";

function fmtLine(used: number, limit: number): string {
  const u = Math.max(0, Math.round(used));
  const l = Math.max(0, Math.round(limit));
  const pct = l > 0 ? Math.round((u / l) * 100) : 0;
  return `${u}/${l} ${pct}%`;
}

function agentsFor(kind: MeterKind, usage: TokenUsage): AgentSpend[] {
  return usage.agents.filter((a) => (kind === "free" ? a.isFree : !a.isFree));
}

function fmtPct(percent: number): string {
  const n = Math.max(0, Math.min(100, percent));
  const rounded = Math.round(n * 10) / 10;
  return Number.isInteger(rounded) ? `${rounded}%` : `${rounded.toFixed(1)}%`;
}

export function buildBreakdownTooltip(
  kind: MeterKind,
  usage: TokenUsage
): vscode.MarkdownString {
  const title = kind === "free" ? "FREE token (free)" : "API token (api)";
  const poolUsed = kind === "free" ? usage.freeUsedCents : usage.apiUsedCents;
  const poolPct = kind === "free" ? usage.freePercent : usage.apiPercent;
  const agents = agentsFor(kind, usage);
  const categoryTotal = agents.reduce((sum, a) => sum + a.cents, 0);
  const denom = categoryTotal > 0 ? categoryTotal : usage.limitCents;

  const lines: string[] = [
    `### ${title}`,
    `\`${fmtLine(poolUsed, usage.limitCents)}\` · ${fmtPct(poolPct)}`,
    "",
  ];

  if (agents.length === 0) {
    lines.push("_ไม่มีข้อมูล agent ในรอบบิลนี้_");
  } else {
    for (const agent of agents) {
      const remaining = Math.max(0, Math.round(denom - agent.cents));
      lines.push(
        `- **${agent.name}** \`${fmtLine(agent.cents, denom)}\` · เหลือ ${remaining}`
      );
    }
  }

  lines.push("", "_คลิกเพื่อเปลี่ยนสี_");

  const md = new vscode.MarkdownString(lines.join("\n"));
  md.isTrusted = false;
  md.supportThemeIcons = true;
  return md;
}

export function buildBreakdownPlain(
  kind: MeterKind,
  usage: TokenUsage
): string {
  const title = kind === "free" ? "FREE token (free)" : "API token (api)";
  const agents = agentsFor(kind, usage);
  const categoryTotal = agents.reduce((sum, a) => sum + a.cents, 0);
  const denom = categoryTotal > 0 ? categoryTotal : usage.limitCents;
  const rows = agents.map(
    (a) => `${a.name}  ${fmtLine(a.cents, denom)}`
  );
  if (rows.length === 0) {
    return `${title}\nไม่มีข้อมูล agent\nคลิกเพื่อเปลี่ยนสี`;
  }
  return `${title}\n${rows.join("\n")}\nคลิกเพื่อเปลี่ยนสี`;
}

async function pickColor(
  title: string,
  current: string,
  allowTransparent: boolean
): Promise<string | undefined> {
  const paletteItems: { label: string; description: string; color: string }[] =
    [];
  if (allowTransparent) {
    paletteItems.push({
      label: "$(circle-outline) Transparent (ใส)",
      description: "transparent",
      color: "transparent",
    });
  }
  for (const c of COLOR_PALETTE) {
    paletteItems.push({
      label: `$(circle-filled) ${c.label}`,
      description: c.color,
      color: c.color,
    });
  }
  paletteItems.push({
    label: "$(edit) Custom hex…",
    description: isTransparent(current) ? "#000000" : current,
    color: "",
  });

  const colorPick = await vscode.window.showQuickPick(paletteItems, {
    title,
    placeHolder: allowTransparent
      ? "ค่าเริ่มต้นคือสีใส (transparent)"
      : "เลือกสี",
  });
  if (!colorPick) {
    return undefined;
  }

  if (colorPick.color) {
    return colorPick.color;
  }

  const custom = await vscode.window.showInputBox({
    title,
    value: isTransparent(current) ? "" : current,
    prompt: allowTransparent
      ? "ใส่ #RRGGBB หรือ transparent"
      : "ใส่สีแบบ #RRGGBB",
    validateInput: (v) => {
      const t = v.trim();
      if (allowTransparent && isTransparent(t)) {
        return undefined;
      }
      return normalizeHex(t) ? undefined : "ต้องเป็น #RRGGBB หรือ transparent";
    },
  });
  if (custom == null) {
    return undefined;
  }
  if (allowTransparent && isTransparent(custom)) {
    return "transparent";
  }
  return normalizeHex(custom) ?? undefined;
}

/** Click handler: pick fill or background color. */
export async function showColorMenu(
  kind: MeterKind,
  fillColor: string,
  backgroundColor: string,
  onFillPicked: (color: string) => void | Promise<void>,
  onBackgroundPicked: (color: string) => void | Promise<void>
): Promise<void> {
  const title = kind === "free" ? "FREE" : "API";
  type Item = vscode.QuickPickItem & { action: "fill" | "background" };

  const picked = await vscode.window.showQuickPick<Item>(
    [
      {
        label: "$(symbol-color) เปลี่ยนสี",
        description: fillColor,
        action: "fill",
      },
      {
        label: "$(color-mode) เปลี่ยนสีพื้นหลัง",
        description: isTransparent(backgroundColor)
          ? "transparent (ใส)"
          : backgroundColor,
        action: "background",
      },
    ],
    {
      title: `${title} — เปลี่ยนสี`,
      placeHolder: "เลือกสิ่งที่จะเปลี่ยนสี",
    }
  );

  if (!picked) {
    return;
  }

  if (picked.action === "fill") {
    const next = await pickColor(`เลือกสีหลอด ${title}`, fillColor, false);
    if (next) {
      await onFillPicked(next);
    }
    return;
  }

  const nextBg = await pickColor(
    `เลือกสีพื้นหลัง ${title}`,
    backgroundColor,
    true
  );
  if (nextBg) {
    await onBackgroundPicked(nextBg);
  }
}
