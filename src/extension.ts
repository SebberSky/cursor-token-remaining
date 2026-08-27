import * as vscode from "vscode";
import { fetchAll, visibleProviders, type Meter, type UsageReport } from "./core";
import { dataMeters, filterVisible, hiddenFromPicked } from "./core/visibility";
import { MetersViewProvider, type MeterStyle } from "./metersView";
import { watchPromptActivity } from "./promptWatcher";
import { buildMeterTooltip, showColorMenu } from "./breakdown";
import { pickAndSignIn } from "./login";
import { checkForUpdate } from "./update";
import {
  DEFAULT_API_COLOR,
  DEFAULT_BACKGROUND,
  DEFAULT_FREE_COLOR,
  defaultFillFor,
  isTransparent,
  normalizeHex,
} from "./colors";

const COLOR_FREE_KEY = "cursorTokenRemaining.freeColor";
const COLOR_API_KEY = "cursorTokenRemaining.apiColor";
const BG_FREE_KEY = "cursorTokenRemaining.freeBackground";
const BG_API_KEY = "cursorTokenRemaining.apiBackground";
const METER_STYLES_KEY = "tokenRemaining.meterStyles";
const HIDDEN_KEY = "tokenRemaining.hiddenIds";
const SAVED_CC_KEY = "cursorTokenRemaining.savedColorCustomizations";

const FREE_CHIP_BG = "statusBarItem.warningBackground";
const API_CHIP_BG = "statusBarItem.errorBackground";
const FREE_CHIP_FG = "statusBarItem.warningForeground";
const API_CHIP_FG = "statusBarItem.errorForeground";
const FREE_CHIP_HOVER_BG = "statusBarItem.warningHoverBackground";
const API_CHIP_HOVER_BG = "statusBarItem.errorHoverBackground";
const FREE_CHIP_HOVER_FG = "statusBarItem.warningHoverForeground";
const API_CHIP_HOVER_FG = "statusBarItem.errorHoverForeground";

const MAX_STATUS_CHIPS = 6;

let pollTimer: NodeJS.Timeout | undefined;
let refreshing = false;
let latestReport: UsageReport | undefined;
let extensionContext: vscode.ExtensionContext | undefined;
const statusItems = new Map<string, vscode.StatusBarItem>();
const meterStyles = new Map<string, MeterStyle>();
const hiddenIds = new Set<string>();

function tokenConfig() {
  return vscode.workspace.getConfiguration("tokenRemaining");
}

function cursorConfig() {
  return vscode.workspace.getConfiguration("cursorTokenRemaining");
}

function pollIntervalSeconds(): number {
  const next = tokenConfig().get<number>("pollIntervalSeconds");
  if (typeof next === "number") {
    return Math.max(15, next);
  }
  return Math.max(15, cursorConfig().get<number>("pollIntervalSeconds", 60));
}

function showStatusBar(): boolean {
  const next = tokenConfig().get<boolean>("showStatusBar");
  if (typeof next === "boolean") {
    return next;
  }
  return cursorConfig().get<boolean>("showStatusBar", true);
}

function autoReveal(): boolean {
  const next = tokenConfig().get<boolean>("autoReveal");
  if (typeof next === "boolean") {
    return next;
  }
  return cursorConfig().get<boolean>("autoReveal", true);
}

function selectedProviders(): string[] | undefined {
  const raw = tokenConfig().get<string[]>("providers", ["auto"]);
  if (!raw || raw.length === 0 || raw.includes("auto")) {
    return undefined;
  }
  return raw;
}

function readBackgroundSetting(key: "freeBackground" | "apiBackground"): string {
  const raw = cursorConfig().get<string>(key, DEFAULT_BACKGROUND);
  if (isTransparent(raw)) {
    return "transparent";
  }
  return normalizeHex(raw) ?? "transparent";
}

function styleFor(meter: Meter, indexInProvider: number): MeterStyle {
  const stored = meterStyles.get(meter.id);
  if (stored) {
    return stored;
  }
  return {
    fill: defaultFillFor(meter.id, meter.provider, indexInProvider),
    background: DEFAULT_BACKGROUND,
  };
}

function ensureMeterStyles(report: UsageReport): void {
  const indexByProvider = new Map<string, number>();
  for (const meter of report.meters) {
    const index = indexByProvider.get(meter.provider) ?? 0;
    indexByProvider.set(meter.provider, index + 1);
    if (!meterStyles.has(meter.id)) {
      meterStyles.set(meter.id, {
        fill: defaultFillFor(meter.id, meter.provider, index),
        background: DEFAULT_BACKGROUND,
      });
    }
  }
}

function persistHidden(): Thenable<void> {
  if (!extensionContext) {
    return Promise.resolve();
  }
  return extensionContext.globalState.update(HIDDEN_KEY, [...hiddenIds]);
}

function persistStyles(): Thenable<void> {
  if (!extensionContext) {
    return Promise.resolve();
  }
  const packed: Record<string, MeterStyle> = {};
  for (const [id, style] of meterStyles) {
    packed[id] = style;
  }
  return extensionContext.globalState.update(METER_STYLES_KEY, packed);
}

export function activate(context: vscode.ExtensionContext): void {
  extensionContext = context;
  const packed =
    context.globalState.get<Record<string, MeterStyle>>(METER_STYLES_KEY, {}) ??
    {};
  for (const [id, style] of Object.entries(packed)) {
    meterStyles.set(id, style);
  }
  hiddenIds.clear();
  for (const id of context.globalState.get<string[]>(HIDDEN_KEY, []) ?? []) {
    hiddenIds.add(id);
  }
  if (!meterStyles.has("cursor.free")) {
    meterStyles.set("cursor.free", {
      fill: context.globalState.get(COLOR_FREE_KEY, DEFAULT_FREE_COLOR),
      background: context.globalState.get(
        BG_FREE_KEY,
        readBackgroundSetting("freeBackground")
      ),
    });
  }
  if (!meterStyles.has("cursor.api")) {
    meterStyles.set("cursor.api", {
      fill: context.globalState.get(COLOR_API_KEY, DEFAULT_API_COLOR),
      background: context.globalState.get(
        BG_API_KEY,
        readBackgroundSetting("apiBackground")
      ),
    });
  }

  const provider = new MetersViewProvider();
  provider.setStyles(meterStyles);
  provider.setOnTubeClick((meterId) => {
    void openColorMenu(meterId, provider);
  });

  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(
      MetersViewProvider.viewType,
      provider,
      { webviewOptions: { retainContextWhenHidden: true } }
    )
  );

  const applyViews = () => {
    if (!latestReport) {
      return;
    }
    const { groups, meters } = filterVisible(latestReport, hiddenIds);
    provider.setGroups(groups);
    renderStatusBar(meters);
  };

  const pickVisibility = async () => {
    if (!latestReport) {
      return;
    }
    const all = dataMeters(latestReport);
    if (all.length === 0) {
      void vscode.window.showInformationMessage(
        "ไม่มีหลอดที่มีข้อมูลให้แสดง"
      );
      return;
    }
    type Item = vscode.QuickPickItem & { id: string };
    const items: Item[] = all.map((meter) => ({
      id: meter.id,
      label: `${meter.provider} / ${meter.label}`,
      picked: !hiddenIds.has(meter.id) && !hiddenIds.has(meter.provider),
    }));
    const picked = await vscode.window.showQuickPick(items, {
      title: "แสดง/ซ่อนหลอด",
      placeHolder: "ติ๊กหลอดที่อยากแสดง — อันที่ไม่มีข้อมูลถูกซ่อนอัตโนมัติ",
      canPickMany: true,
    });
    if (!picked) {
      return;
    }
    hiddenIds.clear();
    for (const id of hiddenFromPicked(all, new Set(picked.map((p) => p.id)))) {
      hiddenIds.add(id);
    }
    await persistHidden();
    applyViews();
  };

  const hideMeter = async (meterId: string) => {
    hiddenIds.add(meterId);
    await persistHidden();
    applyViews();
  };

  const refresh = async (reason: string) => {
    if (refreshing) {
      return;
    }
    refreshing = true;
    try {
      let githubToken: string | undefined;
      try {
        const session = await vscode.authentication.getSession(
          "github",
          ["read:user"],
          { silent: true, createIfNone: false }
        );
        githubToken = session?.accessToken;
      } catch {
        githubToken = undefined;
      }
      const report = await fetchAll({
        githubToken,
        only: selectedProviders(),
      });
      latestReport = report;
      ensureMeterStyles(report);
      provider.setStyles(meterStyles);
      applyViews();
      const visible = visibleProviders(report);
      console.log(`[token-remaining] refreshed (${reason})`, {
        providers: visible.map((p) => p.id),
        meters: report.meters.length,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      provider.setGroups([
        {
          id: "error",
          displayName: "Error",
          skipped: false,
          error: message,
          meters: [],
          fetchedAt: Date.now(),
        },
      ]);
      showFallbackStatus();
    } finally {
      refreshing = false;
    }
  };

  const openColorMenu = async (
    meterId: string,
    meters: MetersViewProvider
  ) => {
    const meter = latestReport?.meters.find((m) => m.id === meterId);
    const label =
      meter?.label ?? (meterId === "_empty" ? "Tokens" : meterId);
    const current = meterStyles.get(meterId) ?? {
      fill: defaultFillFor(meterId, meter?.provider ?? "cursor", 0),
      background: DEFAULT_BACKGROUND,
    };
    await showColorMenu(
      label,
      current.fill,
      current.background,
      async (next) => {
        meterStyles.set(meterId, { ...current, fill: next });
        if (meterId === "cursor.free") {
          await context.globalState.update(COLOR_FREE_KEY, next);
        }
        if (meterId === "cursor.api") {
          await context.globalState.update(COLOR_API_KEY, next);
        }
        await persistStyles();
        meters.setStyles(meterStyles);
        void syncChipBackgrounds().then(() => {
          applyViews();
        });
      },
      async (next) => {
        const value = isTransparent(next) ? "transparent" : next;
        meterStyles.set(meterId, { ...current, background: value });
        if (meterId === "cursor.free") {
          await context.globalState.update(BG_FREE_KEY, value);
          await cursorConfig().update(
            "freeBackground",
            value,
            vscode.ConfigurationTarget.Global
          );
        }
        if (meterId === "cursor.api") {
          await context.globalState.update(BG_API_KEY, value);
          await cursorConfig().update(
            "apiBackground",
            value,
            vscode.ConfigurationTarget.Global
          );
        }
        await persistStyles();
        meters.setStyles(meterStyles);
        void syncChipBackgrounds().then(() => {
          applyViews();
        });
      },
      async () => {
        await runSignIn();
      },
      async () => {
        await checkForUpdate(context, { force: true });
      },
      meterId !== "_empty"
        ? async () => {
            await hideMeter(meterId);
          }
        : undefined,
      async () => {
        await pickVisibility();
      }
    );
  };

  const activeProviderIds = (): string[] =>
    (latestReport?.providers ?? [])
      .filter((p) => !p.skipped)
      .map((p) => p.id);

  const runSignIn = async () => {
    const result = await pickAndSignIn(activeProviderIds());
    if (result === "refreshed") {
      await refresh("signin");
    }
  };
  provider.setOnSignIn(() => {
    void runSignIn();
  });

  const showMeters = async () => {
    await vscode.commands.executeCommand("cursorTokenRemaining.meters.focus");
  };

  context.subscriptions.push(
    vscode.commands.registerCommand("tokenRemaining.refresh", () =>
      refresh("command")
    ),
    vscode.commands.registerCommand("cursorTokenRemaining.refresh", () =>
      refresh("command")
    ),
    vscode.commands.registerCommand("tokenRemaining.showMeters", showMeters),
    vscode.commands.registerCommand(
      "cursorTokenRemaining.showMeters",
      showMeters
    ),
    vscode.commands.registerCommand(
      "tokenRemaining.showColors",
      (meterId?: string) => {
        void openColorMenu(
          typeof meterId === "string" ? meterId : "_empty",
          provider
        );
      }
    ),
    vscode.commands.registerCommand("cursorTokenRemaining.showFreeColors", () =>
      openColorMenu("cursor.free", provider)
    ),
    vscode.commands.registerCommand("cursorTokenRemaining.showApiColors", () =>
      openColorMenu("cursor.api", provider)
    ),
    vscode.commands.registerCommand("tokenRemaining.visibility", () =>
      pickVisibility()
    ),
    vscode.commands.registerCommand("tokenRemaining.signIn", () => runSignIn()),
    vscode.commands.registerCommand("tokenRemaining.checkUpdate", () =>
      checkForUpdate(context, { force: true })
    )
  );

  context.subscriptions.push(
    watchPromptActivity(() => {
      void refresh("prompt-finished");
    })
  );

  const startPoll = () => {
    if (pollTimer) {
      clearInterval(pollTimer);
    }
    pollTimer = setInterval(() => {
      void refresh("poll");
    }, pollIntervalSeconds() * 1000);
  };

  startPoll();
  context.subscriptions.push(
    new vscode.Disposable(() => {
      if (pollTimer) {
        clearInterval(pollTimer);
      }
      for (const item of statusItems.values()) {
        item.dispose();
      }
      statusItems.clear();
    }),
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (
        e.affectsConfiguration("tokenRemaining.pollIntervalSeconds") ||
        e.affectsConfiguration("cursorTokenRemaining.pollIntervalSeconds")
      ) {
        startPoll();
      }
      if (
        e.affectsConfiguration("tokenRemaining.showStatusBar") ||
        e.affectsConfiguration("cursorTokenRemaining.showStatusBar")
      ) {
        applyViews();
      }
      if (
        e.affectsConfiguration("cursorTokenRemaining.freeBackground") ||
        e.affectsConfiguration("cursorTokenRemaining.apiBackground")
      ) {
        const free = meterStyles.get("cursor.free");
        const api = meterStyles.get("cursor.api");
        if (free) {
          meterStyles.set("cursor.free", {
            ...free,
            background: readBackgroundSetting("freeBackground"),
          });
        }
        if (api) {
          meterStyles.set("cursor.api", {
            ...api,
            background: readBackgroundSetting("apiBackground"),
          });
        }
        void persistStyles();
        provider.setStyles(meterStyles);
        void syncChipBackgrounds().then(() => {
          applyViews();
        });
      }
    })
  );

  void refresh("activate");
  setTimeout(() => {
    void checkForUpdate(context, { silent: true });
  }, 4000);

  if (autoReveal()) {
    setTimeout(() => {
      void vscode.commands.executeCommand("cursorTokenRemaining.meters.focus");
    }, 800);
  }

  void syncChipBackgrounds();
}

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

function applyItemColors(
  item: vscode.StatusBarItem,
  meterId: string,
  style: MeterStyle
): void {
  item.color = style.fill;
  if (isTransparent(style.background) || (meterId !== "cursor.free" && meterId !== "cursor.api")) {
    item.backgroundColor = undefined;
    return;
  }
  item.backgroundColor = new vscode.ThemeColor(
    meterId === "cursor.free" ? FREE_CHIP_BG : API_CHIP_BG
  );
}

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

  const free = meterStyles.get("cursor.free");
  const api = meterStyles.get("cursor.api");
  const freeBg = free?.background ?? DEFAULT_BACKGROUND;
  const apiBg = api?.background ?? DEFAULT_BACKGROUND;
  const freeFill = free?.fill ?? DEFAULT_FREE_COLOR;
  const apiFill = api?.fill ?? DEFAULT_API_COLOR;

  if (isTransparent(freeBg)) {
    setKey(FREE_CHIP_BG, null);
    setKey(FREE_CHIP_FG, null);
    setKey(FREE_CHIP_HOVER_BG, null);
    setKey(FREE_CHIP_HOVER_FG, null);
  } else {
    setKey(FREE_CHIP_BG, freeBg);
    setKey(FREE_CHIP_FG, freeFill);
    setKey(FREE_CHIP_HOVER_BG, freeBg);
    setKey(FREE_CHIP_HOVER_FG, freeFill);
  }

  if (isTransparent(apiBg)) {
    setKey(API_CHIP_BG, null);
    setKey(API_CHIP_FG, null);
    setKey(API_CHIP_HOVER_BG, null);
    setKey(API_CHIP_HOVER_FG, null);
  } else {
    setKey(API_CHIP_BG, apiBg);
    setKey(API_CHIP_FG, apiFill);
    setKey(API_CHIP_HOVER_BG, apiBg);
    setKey(API_CHIP_HOVER_FG, apiFill);
  }

  await extensionContext.globalState.update(SAVED_CC_KEY, saved);
  await wb.update(
    "colorCustomizations",
    current,
    vscode.ConfigurationTarget.Global
  );
}

function ensureStatusItem(meterId: string, priority: number): vscode.StatusBarItem {
  const existing = statusItems.get(meterId);
  if (existing) {
    return existing;
  }
  const item = vscode.window.createStatusBarItem(
    vscode.StatusBarAlignment.Right,
    priority
  );
  item.command = {
    command: "tokenRemaining.showColors",
    title: "Change color",
    arguments: [meterId],
  };
  statusItems.set(meterId, item);
  extensionContext?.subscriptions.push(item);
  return item;
}

function showFallbackStatus(): void {
  const item = ensureStatusItem("_empty", 100);
  item.text = "Tokens —";
  item.tooltip = "คลิกเพื่อแสดง/ซ่อนหลอด, ล็อกอิน, หรือเปลี่ยนสี";
  item.color = undefined;
  item.backgroundColor = undefined;
  if (showStatusBar()) {
    item.show();
  } else {
    item.hide();
  }
  for (const [id, other] of statusItems) {
    if (id !== "_empty") {
      other.hide();
    }
  }
}

function renderStatusBar(meters: Meter[]): void {
  const visible = showStatusBar();
  const chips = meters.slice(0, MAX_STATUS_CHIPS);
  const keep = new Set(chips.map((m) => m.id));
  keep.add("_empty");

  if (chips.length === 0) {
    showFallbackStatus();
    return;
  }

  statusItems.get("_empty")?.hide();

  chips.forEach((meter, index) => {
    const item = ensureStatusItem(meter.id, 100 - index);
    const style = styleFor(meter, index);
    item.text = `${meter.label} ${tube(meter.usedPercent)} ${fmtPct(meter.usedPercent)}`;
    item.tooltip = buildMeterTooltip(meter);
    applyItemColors(item, meter.id, style);
    if (visible) {
      item.show();
    } else {
      item.hide();
    }
  });

  for (const [id, item] of statusItems) {
    if (!keep.has(id)) {
      item.hide();
    }
  }
}

export function deactivate(): void {
  if (pollTimer) {
    clearInterval(pollTimer);
  }
  const free = meterStyles.get("cursor.free");
  const api = meterStyles.get("cursor.api");
  if (free) {
    meterStyles.set("cursor.free", { ...free, background: "transparent" });
  }
  if (api) {
    meterStyles.set("cursor.api", { ...api, background: "transparent" });
  }
  void syncChipBackgrounds();
}
