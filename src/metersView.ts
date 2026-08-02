import * as vscode from "vscode";
import type { TokenUsage } from "./usage";
import { deepen, isTransparent, type MeterKind } from "./colors";
import { buildBreakdownPlain } from "./breakdown";

export class MetersViewProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = "cursorTokenRemaining.meters";

  private view?: vscode.WebviewView;
  private latest?: TokenUsage;
  private error?: string;
  private freeColor = "#3ecf8e";
  private apiColor = "#5b9cff";
  private freeBackground = "transparent";
  private apiBackground = "transparent";
  private onTubeClick?: (kind: MeterKind) => void;

  setOnTubeClick(handler: (kind: MeterKind) => void): void {
    this.onTubeClick = handler;
  }

  setColors(
    freeColor: string,
    apiColor: string,
    freeBackground = this.freeBackground,
    apiBackground = this.apiBackground
  ): void {
    this.freeColor = freeColor;
    this.apiColor = apiColor;
    this.freeBackground = freeBackground;
    this.apiBackground = apiBackground;
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
      if (msg?.type === "click" && (msg.kind === "free" || msg.kind === "api")) {
        this.onTubeClick?.(msg.kind);
      }
    });
  }

  setUsage(usage: TokenUsage): void {
    this.latest = usage;
    this.error = undefined;
    this.pushState(false);
  }

  setError(message: string): void {
    this.error = message;
    this.pushState(false);
  }

  private pushState(force: boolean): void {
    if (!this.view) {
      return;
    }
    void this.view.webview.postMessage({
      type: "update",
      force,
      error: this.error ?? null,
      free: this.latest?.freePercent ?? null,
      api: this.latest?.apiPercent ?? null,
      freeColor: this.freeColor,
      apiColor: this.apiColor,
      freeDeep: deepen(this.freeColor),
      apiDeep: deepen(this.apiColor),
      freeBackground: isTransparent(this.freeBackground)
        ? "transparent"
        : this.freeBackground,
      apiBackground: isTransparent(this.apiBackground)
        ? "transparent"
        : this.apiBackground,
      freeTip: this.latest
        ? buildBreakdownPlain("free", this.latest)
        : "FREE — คลิกเพื่อเปลี่ยนสี",
      apiTip: this.latest
        ? buildBreakdownPlain("api", this.latest)
        : "API — คลิกเพื่อเปลี่ยนสี",
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
      --free: #3ecf8e;
      --free-deep: #1f8f5f;
      --api: #5b9cff;
      --api-deep: #2f6fd6;
      --track: transparent;
      --track-free: transparent;
      --track-api: transparent;
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
      gap: 8px;
      padding: 8px 12px 10px;
    }
    .row {
      display: grid;
      grid-template-columns: 88px 1fr;
      align-items: center;
      gap: 10px;
      padding: 4px 6px;
      border-radius: 8px;
      background: transparent;
      transition: background 180ms ease;
    }
    .row.free-row { background: var(--track-free); }
    .row.api-row { background: var(--track-api); }
    .title {
      color: var(--label);
      font-size: 10px;
      letter-spacing: 0.02em;
      line-height: 1.2;
      white-space: nowrap;
    }
    .title strong {
      color: var(--text);
      font-weight: 600;
    }
    .tube {
      position: relative;
      height: 22px;
      border-radius: 999px;
      background: var(--track);
      border: 1px solid color-mix(in srgb, var(--text) 12%, transparent);
      overflow: hidden;
      box-shadow: inset 0 1px 2px rgba(0,0,0,0.25);
      cursor: pointer;
    }
    #freeTube { background: var(--track-free); }
    #apiTube { background: var(--track-api); }
    .fill {
      position: absolute;
      inset: 0 auto 0 0;
      width: 0%;
      border-radius: inherit;
      transition: width 700ms cubic-bezier(0.22, 1, 0.36, 1);
      overflow: hidden;
    }
    .fill.free {
      background: linear-gradient(180deg, color-mix(in srgb, var(--free) 88%, #fff), var(--free-deep));
    }
    .fill.api {
      background: linear-gradient(180deg, color-mix(in srgb, var(--api) 88%, #fff), var(--api-deep));
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
      padding: 4px 2px 0;
      font-size: 11px;
    }
    .hidden { display: none; }
  </style>
</head>
<body>
  <div class="wrap">
    <div class="row free-row">
      <div class="title"><strong>FREE token</strong> (free)</div>
      <div class="tube" id="freeTube" title="ชี้ดู breakdown · คลิกเปลี่ยนสี">
        <div class="fill free" id="freeFill"><div class="liquid"></div><div class="wave"></div></div>
        <div class="pct" id="freePct">—</div>
      </div>
    </div>
    <div class="row api-row">
      <div class="title"><strong>API token</strong> (api)</div>
      <div class="tube" id="apiTube" title="ชี้ดู breakdown · คลิกเปลี่ยนสี">
        <div class="fill api" id="apiFill"><div class="liquid"></div><div class="wave"></div></div>
        <div class="pct" id="apiPct">—</div>
      </div>
    </div>
    <div class="err hidden" id="err"></div>
  </div>
  <script>
    const vscode = acquireVsCodeApi();
    const freeFill = document.getElementById('freeFill');
    const apiFill = document.getElementById('apiFill');
    const freePct = document.getElementById('freePct');
    const apiPct = document.getElementById('apiPct');
    const freeTube = document.getElementById('freeTube');
    const apiTube = document.getElementById('apiTube');
    const err = document.getElementById('err');
    let last = { free: null, api: null };

    freeTube.addEventListener('click', () => {
      vscode.postMessage({ type: 'click', kind: 'free' });
    });
    apiTube.addEventListener('click', () => {
      vscode.postMessage({ type: 'click', kind: 'api' });
    });

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

    window.addEventListener('message', (event) => {
      const msg = event.data;
      if (!msg || msg.type !== 'update') return;
      if (msg.freeColor) {
        document.documentElement.style.setProperty('--free', msg.freeColor);
        document.documentElement.style.setProperty('--free-deep', msg.freeDeep || msg.freeColor);
      }
      if (msg.apiColor) {
        document.documentElement.style.setProperty('--api', msg.apiColor);
        document.documentElement.style.setProperty('--api-deep', msg.apiDeep || msg.apiColor);
      }
      document.documentElement.style.setProperty(
        '--track-free',
        msg.freeBackground || 'transparent'
      );
      document.documentElement.style.setProperty(
        '--track-api',
        msg.apiBackground || 'transparent'
      );
      if (msg.freeTip) freeTube.title = msg.freeTip;
      if (msg.apiTip) apiTube.title = msg.apiTip;
      if (msg.error) {
        err.textContent = msg.error;
        err.classList.remove('hidden');
      } else {
        err.classList.add('hidden');
      }
      last.free = setBar(freeFill, freePct, msg.free, last.free, msg.force);
      last.api = setBar(apiFill, apiPct, msg.api, last.api, msg.force);
    });

    vscode.postMessage({ type: 'ready' });
  </script>
</body>
</html>`;
  }
}
