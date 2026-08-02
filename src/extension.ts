import * as vscode from "vscode";
import { fetchTokenUsage, type TokenUsage } from "./usage";
import { MetersViewProvider } from "./metersView";
import { watchPromptActivity } from "./promptWatcher";
import { buildBreakdownTooltip, showColorMenu } from "./breakdown";
import {
  DEFAULT_API_COLOR,
  DEFAULT_BACKGROUND,
  DEFAULT_FREE_COLOR,
  isTransparent,
  normalizeHex,
  type MeterKind,
} from "./colors";

let freeStatus: vscode.StatusBarItem | undefined;
let apiStatus: vscode.StatusBarItem | undefined;
let pollTimer: NodeJS.Timeout | undefined;
let refreshing = false;
let latestUsage: TokenUsage | undefined;
let freeColor = DEFAULT_FREE_COLOR;
let apiColor = DEFAULT_API_COLOR;
let freeBackground = DEFAULT_BACKGROUND;
let apiBackground = DEFAULT_BACKGROUND;

const COLOR_FREE_KEY = "cursorTokenRemaining.freeColor";
const COLOR_API_KEY = "cursorTokenRemaining.apiColor";
const BG_FREE_KEY = "cursorTokenRemaining.freeBackground";
const BG_API_KEY = "cursorTokenRemaining.apiBackground";
const SAVED_CC_KEY = "cursorTokenRemaining.savedColorCustomizations";

/** Status bar only allows these theme ids for item backgrounds. */
const FREE_CHIP_BG = "statusBarItem.warningBackground";
const API_CHIP_BG = "statusBarItem.errorBackground";
const FREE_CHIP_FG = "statusBarItem.warningForeground";
const API_CHIP_FG = "statusBarItem.errorForeground";
const FREE_CHIP_HOVER_BG = "statusBarItem.warningHoverBackground";
const API_CHIP_HOVER_BG = "statusBarItem.errorHoverBackground";
const FREE_CHIP_HOVER_FG = "statusBarItem.warningHoverForeground";
const API_CHIP_HOVER_FG = "statusBarItem.errorHoverForeground";

let extensionContext: vscode.ExtensionContext | undefined;

function readBackgroundSetting(key: "freeBackground" | "apiBackground"): string {
  const raw = vscode.workspace
    .getConfiguration("cursorTokenRemaining")
    .get<string>(key, DEFAULT_BACKGROUND);
  if (isTransparent(raw)) {
    return "transparent";
  }
  return normalizeHex(raw) ?? "transparent";
}

export function activate(context: vscode.ExtensionContext): void {
  extensionContext = context;
  freeColor = context.globalState.get(COLOR_FREE_KEY, DEFAULT_FREE_COLOR);
  apiColor = context.globalState.get(COLOR_API_KEY, DEFAULT_API_COLOR);
  freeBackground = context.globalState.get(
    BG_FREE_KEY,
    readBackgroundSetting("freeBackground")
  );
  apiBackground = context.globalState.get(
    BG_API_KEY,
    readBackgroundSetting("apiBackground")
  );

  const provider = new MetersViewProvider();
  provider.setColors(freeColor, apiColor, freeBackground, apiBackground);
  provider.setOnTubeClick((kind) => {
    void openColorMenu(kind, context, provider);
  });

  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(
      MetersViewProvider.viewType,
      provider,
      { webviewOptions: { retainContextWhenHidden: true } }
    )
  );

  freeStatus = vscode.window.createStatusBarItem(
    vscode.StatusBarAlignment.Right,
    100
  );
  apiStatus = vscode.window.createStatusBarItem(
    vscode.StatusBarAlignment.Right,
    99
  );
  freeStatus.command = "cursorTokenRemaining.showFreeColors";
  apiStatus.command = "cursorTokenRemaining.showApiColors";
  freeStatus.tooltip = "FREE — ชี้ดู breakdown · คลิกเปลี่ยนสี";
  apiStatus.tooltip = "API — ชี้ดู breakdown · คลิกเปลี่ยนสี";
  applyItemColors(freeStatus, freeColor, freeBackground, "free");
  applyItemColors(apiStatus, apiColor, apiBackground, "api");
  context.subscriptions.push(freeStatus, apiStatus);
  void syncChipBackgrounds();

  const refresh = async (reason: string) => {
    if (refreshing) {
      return;
    }
    refreshing = true;
    try {
      const usage = await fetchTokenUsage();
      latestUsage = usage;
      provider.setUsage(usage);
      updateStatusBar(usage);
      console.log(`[cursor-token-remaining] refreshed (${reason})`, {
        free: usage.freePercent,
        api: usage.apiPercent,
        agents: usage.agents.length,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      provider.setError(message);
      if (freeStatus && apiStatus) {
        freeStatus.text = "FREE —";
        apiStatus.text = "API —";
        applyItemColors(freeStatus, freeColor, freeBackground, "free");
        applyItemColors(apiStatus, apiColor, apiBackground, "api");
        freeStatus.show();
        apiStatus.show();
      }
    } finally {
      refreshing = false;
    }
  };

  const syncColors = (meters: MetersViewProvider) => {
    meters.setColors(freeColor, apiColor, freeBackground, apiBackground);
    void syncChipBackgrounds().then(() => {
      if (latestUsage) {
        updateStatusBar(latestUsage);
      } else if (freeStatus && apiStatus) {
        applyItemColors(freeStatus, freeColor, freeBackground, "free");
        applyItemColors(apiStatus, apiColor, apiBackground, "api");
      }
    });
  };

  const openColorMenu = async (
    kind: MeterKind,
    ctx: vscode.ExtensionContext,
    meters: MetersViewProvider
  ) => {
    const fill = kind === "free" ? freeColor : apiColor;
    const bg = kind === "free" ? freeBackground : apiBackground;
    await showColorMenu(
      kind,
      fill,
      bg,
      async (next) => {
        if (kind === "free") {
          freeColor = next;
          await ctx.globalState.update(COLOR_FREE_KEY, next);
        } else {
          apiColor = next;
          await ctx.globalState.update(COLOR_API_KEY, next);
        }
        syncColors(meters);
      },
      async (next) => {
        const value = isTransparent(next) ? "transparent" : next;
        if (kind === "free") {
          freeBackground = value;
          await ctx.globalState.update(BG_FREE_KEY, value);
          await vscode.workspace
            .getConfiguration("cursorTokenRemaining")
            .update("freeBackground", value, vscode.ConfigurationTarget.Global);
        } else {
          apiBackground = value;
          await ctx.globalState.update(BG_API_KEY, value);
          await vscode.workspace
            .getConfiguration("cursorTokenRemaining")
            .update("apiBackground", value, vscode.ConfigurationTarget.Global);
        }
        syncColors(meters);
      }
    );
  };

  context.subscriptions.push(
    vscode.commands.registerCommand("cursorTokenRemaining.refresh", () =>
      refresh("command")
    ),
    vscode.commands.registerCommand("cursorTokenRemaining.showMeters", async () => {
      await vscode.commands.executeCommand("cursorTokenRemaining.meters.focus");
    }),
    vscode.commands.registerCommand(
      "cursorTokenRemaining.showFreeColors",
      () => openColorMenu("free", context, provider)
    ),
    vscode.commands.registerCommand(
      "cursorTokenRemaining.showApiColors",
      () => openColorMenu("api", context, provider)
    )
  );

  context.subscriptions.push(
    watchPromptActivity(() => {
      void refresh("prompt-finished");
    })
  );

  const config = () => vscode.workspace.getConfiguration("cursorTokenRemaining");

  const startPoll = () => {
    if (pollTimer) {
      clearInterval(pollTimer);
    }
    const seconds = Math.max(
      15,
      config().get<number>("pollIntervalSeconds", 60)
    );
    pollTimer = setInterval(() => {
      void refresh("poll");
    }, seconds * 1000);
  };

  startPoll();
  context.subscriptions.push(
    new vscode.Disposable(() => {
      if (pollTimer) {
        clearInterval(pollTimer);
      }
    }),
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration("cursorTokenRemaining.pollIntervalSeconds")) {
        startPoll();
      }
      if (e.affectsConfiguration("cursorTokenRemaining.showStatusBar")) {
        applyStatusBarVisibility();
      }
      if (
        e.affectsConfiguration("cursorTokenRemaining.freeBackground") ||
        e.affectsConfiguration("cursorTokenRemaining.apiBackground")
      ) {
        freeBackground = readBackgroundSetting("freeBackground");
        apiBackground = readBackgroundSetting("apiBackground");
        void context.globalState.update(BG_FREE_KEY, freeBackground);
        void context.globalState.update(BG_API_KEY, apiBackground);
        syncColors(provider);
      }
    })
  );

  void refresh("activate");

  if (config().get<boolean>("autoReveal", true)) {
    setTimeout(() => {
      void vscode.commands.executeCommand("cursorTokenRemaining.meters.focus");
    }, 800);
  }

  applyStatusBarVisibility();
}

function applyItemColors(
  item: vscode.StatusBarItem,
  fill: string,
  background: string,
  kind: MeterKind
): void {
  // Keep explicit fill color; when a chip background is active, Cursor may
  // swap in warning/errorForeground — those are synced to fill in syncChipBackgrounds.
  item.color = fill;
  if (isTransparent(background)) {
    item.backgroundColor = undefined;
  } else if (kind === "free") {
    item.backgroundColor = new vscode.ThemeColor(FREE_CHIP_BG);
  } else {
    item.backgroundColor = new vscode.ThemeColor(API_CHIP_BG);
  }
}

/**
 * Map FREE/API chip colors onto the only status-bar theme keys Cursor allows.
 * Background and font (fill) are written separately so neither overrides the other.
 */
async function syncChipBackgrounds(): Promise<void> {
  if (!extensionContext) {
    return;
  }
  const wb = vscode.workspace.getConfiguration("workbench");
  const current = {
    ...(wb.get<Record<string, string>>("colorCustomizations") ?? {}),
  };
  const saved = {
    ...(extensionContext.globalState.get<Record<string, string | null>>(
      SAVED_CC_KEY,
      {}
    ) ?? {}),
  };

  const setKey = (themeKey: string, value: string | null) => {
    if (value != null) {
      if (!(themeKey in saved)) {
        saved[themeKey] = themeKey in current ? current[themeKey] : null;
      }
      current[themeKey] = value;
      return;
    }
    if (themeKey in saved) {
      const prev = saved[themeKey];
      if (prev == null) {
        delete current[themeKey];
      } else {
        current[themeKey] = prev;
      }
      delete saved[themeKey];
    }
  };

  if (isTransparent(freeBackground)) {
    setKey(FREE_CHIP_BG, null);
    setKey(FREE_CHIP_FG, null);
    setKey(FREE_CHIP_HOVER_BG, null);
    setKey(FREE_CHIP_HOVER_FG, null);
  } else {
    // Keep hover identical to idle — no color shift on pointer over.
    setKey(FREE_CHIP_BG, freeBackground);
    setKey(FREE_CHIP_FG, freeColor);
    setKey(FREE_CHIP_HOVER_BG, freeBackground);
    setKey(FREE_CHIP_HOVER_FG, freeColor);
  }

  if (isTransparent(apiBackground)) {
    setKey(API_CHIP_BG, null);
    setKey(API_CHIP_FG, null);
    setKey(API_CHIP_HOVER_BG, null);
    setKey(API_CHIP_HOVER_FG, null);
  } else {
    setKey(API_CHIP_BG, apiBackground);
    setKey(API_CHIP_FG, apiColor);
    setKey(API_CHIP_HOVER_BG, apiBackground);
    setKey(API_CHIP_HOVER_FG, apiColor);
  }

  await extensionContext.globalState.update(SAVED_CC_KEY, saved);
  await wb.update(
    "colorCustomizations",
    current,
    vscode.ConfigurationTarget.Global
  );
}

function applyStatusBarVisibility(): void {
  const show = vscode.workspace
    .getConfiguration("cursorTokenRemaining")
    .get<boolean>("showStatusBar", true);
  if (!freeStatus || !apiStatus) {
    return;
  }
  if (show) {
    freeStatus.show();
    apiStatus.show();
  } else {
    freeStatus.hide();
    apiStatus.hide();
  }
}

/** 20 thin ticks (20:100) using | so segments sit flush. */
function tube(percent: number, width = 20): string {
  const clamped = Math.max(0, Math.min(100, percent));
  const filled = Math.max(0, Math.min(width, Math.round((clamped / 100) * width)));
  return `${"|".repeat(filled)}${"·".repeat(width - filled)}`;
}

function fmtPct(percent: number): string {
  const n = Math.max(0, Math.min(100, percent));
  const rounded = Math.round(n * 10) / 10;
  return Number.isInteger(rounded) ? `${rounded}%` : `${rounded.toFixed(1)}%`;
}

function updateStatusBar(usage: TokenUsage): void {
  if (!freeStatus || !apiStatus) {
    return;
  }
  const free = usage.freePercent;
  const api = usage.apiPercent;
  freeStatus.text = `FREE ${tube(free)} ${fmtPct(free)}`;
  apiStatus.text = `API ${tube(api)} ${fmtPct(api)}`;
  freeStatus.tooltip = buildBreakdownTooltip("free", usage);
  apiStatus.tooltip = buildBreakdownTooltip("api", usage);
  applyItemColors(freeStatus, freeColor, freeBackground, "free");
  applyItemColors(apiStatus, apiColor, apiBackground, "api");
  applyStatusBarVisibility();
}

export function deactivate(): void {
  if (pollTimer) {
    clearInterval(pollTimer);
  }
  // Restore hijacked theme keys when possible.
  freeBackground = "transparent";
  apiBackground = "transparent";
  void syncChipBackgrounds();
}
