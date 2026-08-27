import * as vscode from "vscode";
import type { Meter } from "./core/types";
import { formatResetIn } from "./core/format";
import {
  COLOR_PALETTE,
  isTransparent,
  normalizeHex,
} from "./colors";

function fmtLine(used: number, limit: number): string {
  const u = Math.max(0, Math.round(used));
  const l = Math.max(0, Math.round(limit));
  const pct = l > 0 ? Math.round((u / l) * 100) : 0;
  return `${u}/${l} ${pct}%`;
}

function fmtPct(percent: number): string {
  const n = Math.max(0, Math.min(100, percent));
  const rounded = Math.round(n * 10) / 10;
  return Number.isInteger(rounded) ? `${rounded}%` : `${rounded.toFixed(1)}%`;
}

export function buildMeterTooltip(meter: Meter): vscode.MarkdownString {
  const lines: string[] = [`### ${meter.label}`];
  if (meter.used != null && meter.limit != null) {
    lines.push(`\`${fmtLine(meter.used, meter.limit)}\` · ${fmtPct(meter.usedPercent)}`);
  } else {
    lines.push(`${fmtPct(meter.usedPercent)}`);
  }
  if (meter.resetsAt) {
    lines.push(formatResetIn(meter.resetsAt));
  }
  lines.push("");
  const rows = meter.breakdown ?? [];
  if (rows.length === 0) {
    lines.push("_ไม่มี breakdown_");
  } else {
    const denom = rows.reduce((sum, row) => sum + row.used, 0);
    for (const row of rows) {
      lines.push(`- **${row.name}** \`${fmtLine(row.used, denom || row.used)}\``);
    }
  }
  lines.push("", "_คลิกเพื่อเปลี่ยนสี หรือล็อกอินเจ้าอื่น_");
  const md = new vscode.MarkdownString(lines.join("\n"));
  md.isTrusted = false;
  md.supportThemeIcons = true;
  return md;
}

export function buildMeterPlain(meter: Meter): string {
  const rows = meter.breakdown ?? [];
  const reset = meter.resetsAt ? `\n${formatResetIn(meter.resetsAt)}` : "";
  if (rows.length === 0) {
    return `${meter.label}\n${fmtPct(meter.usedPercent)}${reset}\nคลิกเพื่อเปลี่ยนสี หรือล็อกอินเจ้าอื่น`;
  }
  const denom = rows.reduce((sum, row) => sum + row.used, 0);
  const body = rows.map((row) => `${row.name}  ${fmtLine(row.used, denom || row.used)}`);
  return `${meter.label}\n${body.join("\n")}${reset}\nคลิกเพื่อเปลี่ยนสี หรือล็อกอินเจ้าอื่น`;
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

export async function showColorMenu(
  label: string,
  fillColor: string,
  backgroundColor: string,
  onFillPicked: (color: string) => void | Promise<void>,
  onBackgroundPicked: (color: string) => void | Promise<void>,
  onSignIn?: () => void | Promise<void>,
  onCheckUpdate?: () => void | Promise<void>,
  onHide?: () => void | Promise<void>,
  onVisibility?: () => void | Promise<void>
): Promise<void> {
  type Item = vscode.QuickPickItem & {
    action: "fill" | "background" | "signin" | "update" | "hide" | "visibility";
  };

  const items: Item[] = [
    {
      label: "$(eye) แสดง/ซ่อนหลอด",
      description: "เลือกหลอดที่มีข้อมูล",
      action: "visibility",
    },
  ];
  if (onHide) {
    items.push({
      label: "$(eye-closed) ซ่อนหลอดนี้",
      description: label,
      action: "hide",
    });
  }
  items.push(
    {
      label: "$(plug) ล็อกอิน / ล็อกเอาต์",
      description: "คลิกเจ้าที่ล็อกอินอยู่แล้วเพื่อออก",
      action: "signin",
    },
    {
      label: "$(sync) Check for updates",
      description: "GitHub release",
      action: "update",
    },
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
    }
  );

  const picked = await vscode.window.showQuickPick<Item>(items, {
    title: `${label} — ตัวเลือก`,
    placeHolder: "แสดง/ซ่อน, ล็อกอิน, อัปเดต, หรือเปลี่ยนสี",
  });

  if (!picked) {
    return;
  }

  if (picked.action === "visibility") {
    await onVisibility?.();
    return;
  }
  if (picked.action === "hide") {
    await onHide?.();
    return;
  }
  if (picked.action === "signin") {
    await onSignIn?.();
    return;
  }

  if (picked.action === "update") {
    await onCheckUpdate?.();
    return;
  }

  if (picked.action === "fill") {
    const next = await pickColor(`เลือกสีหลอด ${label}`, fillColor, false);
    if (next) {
      await onFillPicked(next);
    }
    return;
  }

  const nextBg = await pickColor(
    `เลือกสีพื้นหลัง ${label}`,
    backgroundColor,
    true
  );
  if (nextBg) {
    await onBackgroundPicked(nextBg);
  }
}
