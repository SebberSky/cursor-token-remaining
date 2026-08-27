import * as vscode from "vscode";
import type { Meter, ProviderSnapshot } from "./core/types";
import { deepen, isTransparent } from "./colors";
import { buildMeterPlain } from "./breakdown";

export type MeterStyle = {
  fill: string;
  background: string;
};

export class MetersViewProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = "cursorTokenRemaining.meters";

  private view?: vscode.WebviewView;
  private groups: ProviderSnapshot[] = [];
  private styles = new Map<string, MeterStyle>();
  private onTubeClick?: (meterId: string) => void;
  private onSignIn?: () => void;

  setOnTubeClick(handler: (meterId: string) => void): void {
    this.onTubeClick = handler;
  }

  setOnSignIn(handler: () => void): void {
    this.onSignIn = handler;
  }

  setStyle(meterId: string, style: MeterStyle): void {
    this.styles.set(meterId, style);
    this.pushState(false);
  }

  setStyles(styles: Map<string, MeterStyle>): void {
    this.styles = styles;
    this.pushState(false);
  }

  resolveWebviewView(
    webviewView: vscode.WebviewView,
    _context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken
  ): void {
    this.view = webviewView;
    webviewView.webview.options = { enableScripts: true };
    webviewView.webview.html = this.renderHtml();
    this.pushState(true);

    webviewView.webview.onDidReceiveMessage((msg) => {
      if (msg?.type === "ready") {
        this.pushState(true);
        return;
      }
      if (msg?.type === "click" && typeof msg.id === "string") {
        this.onTubeClick?.(msg.id);
        return;
      }
      if (msg?.type === "signin") {
        this.onSignIn?.();
      }
    });
  }

  setGroups(groups: ProviderSnapshot[]): void {
    this.groups = groups;
    this.pushState(false);
  }

  private viewMeters(group: ProviderSnapshot) {
    return group.meters.map((meter) => this.serializeMeter(meter));
  }

  private serializeMeter(meter: Meter) {
    const style = this.styles.get(meter.id);
    const fill = style?.fill ?? "#3ecf8e";
    const background = style?.background ?? "transparent";
    return {
      id: meter.id,
      label: meter.label,
      usedPercent: meter.usedPercent,
      color: fill,
      deep: deepen(fill),
      background: isTransparent(background) ? "transparent" : background,
      tip: buildMeterPlain(meter),
    };
  }

  private pushState(force: boolean): void {
    if (!this.view) {
      return;
    }
    const visible = this.groups.filter((g) => !g.skipped);
    void this.view.webview.postMessage({
      type: "update",
      force,
      groups: visible.map((group) => ({
        id: group.id,
        displayName: group.displayName,
        error: group.error ?? null,
        meters: this.viewMeters(group),
      })),
    });
  }

  private renderHtml(): string {
    const csp = [
      "default-src 'none'",
      "style-src 'unsafe-inline'",
      "script-src 'unsafe-inline'",
    ].join("; ");

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta http-equiv="Content-Security-Policy" content="${csp}" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <style>
    :root {
      --label: var(--vscode-descriptionForeground);
      --text: var(--vscode-foreground);
    }
    * { box-sizing: border-box; }
    html, body {
      margin: 0;
      padding: 0;
      background: transparent;
      color: var(--text);
      font-family: var(--vscode-font-family);
      font-size: 11px;
      overflow: hidden;
    }
    .wrap {
      display: flex;
      flex-direction: column;
      gap: 10px;
      padding: 8px 12px 10px;
      max-height: 100vh;
      overflow-y: auto;
    }
    .group-title {
      color: var(--label);
      font-size: 10px;
      letter-spacing: 0.04em;
      text-transform: uppercase;
      padding: 2px 6px 0;
    }
    .row {
      display: grid;
      grid-template-columns: 88px 1fr;
      align-items: center;
      gap: 10px;
      padding: 4px 6px;
      border-radius: 8px;
    }
    .title {
      color: var(--label);
      font-size: 10px;
      letter-spacing: 0.02em;
      line-height: 1.2;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .title strong {
      color: var(--text);
      font-weight: 600;
    }
    .tube {
      position: relative;
      height: 22px;
      border-radius: 999px;
      background: transparent;
      border: 1px solid color-mix(in srgb, var(--text) 12%, transparent);
      overflow: hidden;
      box-shadow: inset 0 1px 2px rgba(0,0,0,0.25);
      cursor: pointer;
    }
    .fill {
      position: absolute;
      inset: 0 auto 0 0;
      width: 0%;
      border-radius: inherit;
      transition: width 700ms cubic-bezier(0.22, 1, 0.36, 1);
      overflow: hidden;
    }
    .liquid {
      position: absolute;
      inset: -40% -30%;
      background:
        radial-gradient(ellipse 40% 55% at 20% 40%, rgba(255,255,255,0.35), transparent 60%),
        radial-gradient(ellipse 50% 60% at 70% 60%, rgba(255,255,255,0.18), transparent 65%),
        linear-gradient(90deg, transparent, rgba(255,255,255,0.22), transparent);
      opacity: 0.85;
      transform: translateX(-25%);
      pointer-events: none;
    }
    .fill.ripple .liquid { animation: ripple 900ms ease-out; }
    @keyframes ripple {
      0% { transform: translateX(-35%) translateY(8%) skewX(-8deg); opacity: 0.95; }
      45% { transform: translateX(8%) translateY(-4%) skewX(4deg); opacity: 0.8; }
      100% { transform: translateX(28%) translateY(2%) skewX(-2deg); opacity: 0.55; }
    }
    .wave {
      position: absolute;
      right: -2px;
      top: -20%;
      width: 18px;
      height: 140%;
      border-radius: 50%;
      background: rgba(255,255,255,0.22);
      filter: blur(1px);
      opacity: 0;
      pointer-events: none;
    }
    .fill.ripple .wave { animation: crest 900ms ease-out; }
    @keyframes crest {
      0% { opacity: 0; transform: scaleY(0.6) translateX(0); }
      35% { opacity: 0.9; transform: scaleY(1.15) translateX(-2px); }
      100% { opacity: 0; transform: scaleY(0.8) translateX(6px); }
    }
    .pct {
      position: absolute;
      inset: 0;
      display: flex;
      align-items: center;
      justify-content: center;
      font-variant-numeric: tabular-nums;
      font-weight: 700;
      font-size: 11px;
      letter-spacing: 0.02em;
      color: var(--text);
      text-shadow:
        0 0 3px var(--vscode-editor-background),
        0 1px 2px rgba(0,0,0,0.55);
      z-index: 2;
      pointer-events: none;
    }
    .err {
      color: var(--vscode-errorForeground);
      padding: 2px 6px 0;
      font-size: 11px;
    }
    .empty {
      color: var(--label);
      padding: 8px 6px;
      cursor: pointer;
    }
  </style>
</head>
<body>
  <div class="wrap" id="root"></div>
  <script>
    const vscode = acquireVsCodeApi();
    const root = document.getElementById('root');
    const last = {};

    function fmt(n) {
      if (n == null || Number.isNaN(n)) return '—';
      return Math.round(n) + '%';
    }

    function setBar(el, pctEl, value, prev, force) {
      const next = value == null ? 0 : Math.max(0, Math.min(100, value));
      const changed = prev !== next;
      pctEl.textContent = fmt(value);
      el.style.width = next + '%';
      if (!force && changed) {
        el.classList.remove('ripple');
        void el.offsetWidth;
        el.classList.add('ripple');
        window.setTimeout(() => el.classList.remove('ripple'), 950);
      }
      return next;
    }

    function ensureRow(groupEl, meter) {
      let row = groupEl.querySelector('[data-meter="' + meter.id + '"]');
      if (row) return row;
      row = document.createElement('div');
      row.className = 'row';
      row.dataset.meter = meter.id;
      row.innerHTML =
        '<div class="title"><strong></strong></div>' +
        '<div class="tube">' +
          '<div class="fill"><div class="liquid"></div><div class="wave"></div></div>' +
          '<div class="pct">—</div>' +
        '</div>';
      const tube = row.querySelector('.tube');
      tube.addEventListener('click', () => {
        vscode.postMessage({ type: 'click', id: meter.id });
      });
      groupEl.appendChild(row);
      return row;
    }

    function render(groups, force) {
      if (!groups || groups.length === 0) {
        root.innerHTML = '<div class="empty" id="emptyClick">ไม่มีหลอดให้แสดง<br/>คลิกเพื่อแสดง/ซ่อน หรือล็อกอิน</div>';
        document.getElementById('emptyClick')?.addEventListener('click', () => {
          vscode.postMessage({ type: 'click', id: '_empty' });
        });
        return;
      }
      const empty = root.querySelector('.empty');
      if (empty) empty.remove();
      const keepGroups = new Set(groups.map((g) => g.id));
      for (const el of [...root.querySelectorAll('[data-group]')]) {
        if (!keepGroups.has(el.dataset.group)) el.remove();
      }
      for (const group of groups) {
        let groupEl = root.querySelector('[data-group="' + group.id + '"]');
        if (!groupEl) {
          groupEl = document.createElement('div');
          groupEl.dataset.group = group.id;
          groupEl.innerHTML = '<div class="group-title"></div><div class="err" hidden></div>';
          root.appendChild(groupEl);
        }
        groupEl.querySelector('.group-title').textContent = group.displayName;
        const err = groupEl.querySelector('.err');
        if (group.error) {
          err.hidden = false;
          err.textContent = group.error;
        } else {
          err.hidden = true;
        }
        const keepMeters = new Set(group.meters.map((m) => m.id));
        for (const row of [...groupEl.querySelectorAll('[data-meter]')]) {
          if (!keepMeters.has(row.dataset.meter)) row.remove();
        }
        for (const meter of group.meters) {
          const row = ensureRow(groupEl, meter);
          row.querySelector('.title strong').textContent = meter.label;
          const fill = row.querySelector('.fill');
          const tube = row.querySelector('.tube');
          const pct = row.querySelector('.pct');
          fill.style.background =
            'linear-gradient(180deg, color-mix(in srgb, ' + meter.color + ' 88%, #fff), ' + meter.deep + ')';
          tube.style.background = meter.background || 'transparent';
          tube.title = meter.tip || '';
          last[meter.id] = setBar(fill, pct, meter.usedPercent, last[meter.id], force);
        }
      }
    }

    window.addEventListener('message', (event) => {
      const msg = event.data;
      if (!msg || msg.type !== 'update') return;
      render(msg.groups || [], !!msg.force);
    });

    vscode.postMessage({ type: 'ready' });
  </script>
</body>
</html>`;
  }
}
