import { execFile } from "child_process";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { promisify } from "util";
import * as vscode from "vscode";
import { isNewerVersion, normalizeTag } from "./core/semver";

const execFileAsync = promisify(execFile);

const REPO = "SebberSky/cursor-token-remaining";
const LATEST_API = `https://api.github.com/repos/${REPO}/releases/latest`;
const VSIX_LATEST = `https://github.com/${REPO}/releases/latest/download/extension.vsix`;
const SKIP_KEY = "tokenRemaining.skippedVersion";
const LAST_CHECK_KEY = "tokenRemaining.lastCheckAt";

type GithubRelease = {
  tag_name?: string;
  html_url?: string;
  body?: string;
  assets?: { name?: string; browser_download_url?: string }[];
};

export type LatestRelease = {
  version: string;
  tag: string;
  htmlUrl: string;
  vsixUrl: string;
  notes: string;
};

function headers(): Record<string, string> {
  return {
    Accept: "application/vnd.github+json",
    "User-Agent": "token-remaining",
    "X-GitHub-Api-Version": "2022-11-28",
  };
}

function vsixUrlFrom(release: GithubRelease): string {
  const assets = release.assets ?? [];
  const named =
    assets.find((a) => a.name === "extension.vsix") ??
    assets.find((a) => a.name?.endsWith(".vsix"));
  return named?.browser_download_url || VSIX_LATEST;
}

export async function fetchLatestRelease(): Promise<LatestRelease> {
  const res = await fetch(LATEST_API, { headers: headers() });
  if (!res.ok) {
    throw new Error(`GitHub releases ${res.status}`);
  }
  const data = (await res.json()) as GithubRelease;
  const tag = data.tag_name?.trim();
  if (!tag) {
    throw new Error("Latest GitHub release has no tag.");
  }
  return {
    version: tag.replace(/^v/i, ""),
    tag: normalizeTag(tag),
    htmlUrl: data.html_url || `https://github.com/${REPO}/releases/latest`,
    vsixUrl: vsixUrlFrom(data),
    notes: (data.body ?? "").trim(),
  };
}

function cliName(): string {
  const app = vscode.env.appName.toLowerCase();
  if (app.includes("cursor")) {
    return "cursor";
  }
  if (app.includes("windsurf")) {
    return "windsurf";
  }
  if (app.includes("insiders")) {
    return "code-insiders";
  }
  return "code";
}

function findIdeCli(): string | undefined {
  const name = cliName();
  const fromApp = path.join(
    vscode.env.appRoot,
    "bin",
    process.platform === "win32" ? `${name}.cmd` : name
  );
  if (fs.existsSync(fromApp)) {
    return fromApp;
  }
  return undefined;
}

async function downloadVsix(url: string): Promise<string> {
  const res = await fetch(url, {
    headers: { "User-Agent": "token-remaining", Accept: "application/octet-stream" },
    redirect: "follow",
  });
  if (!res.ok) {
    throw new Error(`Download VSIX ${res.status}`);
  }
  const dest = path.join(
    os.tmpdir(),
    `token-remaining-${Date.now()}.vsix`
  );
  fs.writeFileSync(dest, Buffer.from(await res.arrayBuffer()));
  return dest;
}

async function installVsix(vsixPath: string): Promise<void> {
  const uri = vscode.Uri.file(vsixPath);
  try {
    await vscode.commands.executeCommand(
      "workbench.extensions.installExtension",
      uri
    );
    return;
  } catch {
    // fall through to CLI
  }
  const cli = findIdeCli();
  if (!cli) {
    throw new Error("Could not find IDE CLI to install the VSIX.");
  }
  await execFileAsync(cli, ["--install-extension", vsixPath, "--force"], {
    timeout: 120_000,
  });
}

async function promptReload(version: string): Promise<void> {
  const pick = await vscode.window.showInformationMessage(
    `Token Remaining updated to ${version}. Reload window to use it.`,
    "Reload"
  );
  if (pick === "Reload") {
    await vscode.commands.executeCommand("workbench.action.reloadWindow");
  }
}

export async function installLatest(
  latest: LatestRelease,
  progress: vscode.Progress<{ message?: string }>
): Promise<void> {
  progress.report({ message: `Downloading ${latest.tag}…` });
  const vsix = await downloadVsix(latest.vsixUrl);
  try {
    progress.report({ message: "Installing…" });
    await installVsix(vsix);
  } finally {
    try {
      fs.unlinkSync(vsix);
    } catch {
      // ignore
    }
  }
  await promptReload(latest.version);
}

type CheckOptions = {
  silent?: boolean;
  force?: boolean;
};

export async function checkForUpdate(
  context: vscode.ExtensionContext,
  options: CheckOptions = {}
): Promise<void> {
  const cfg = vscode.workspace.getConfiguration("tokenRemaining");
  const checkEnabled = cfg.get<boolean>("checkUpdates", true);
  const autoUpdate = cfg.get<boolean>("autoUpdate", true);
  const hours = Math.max(1, cfg.get<number>("updateCheckHours", 24));
  const current = String(context.extension.packageJSON.version ?? "0.0.0");
  const skipped = context.globalState.get<string>(SKIP_KEY);
  const lastCheck = context.globalState.get<number>(LAST_CHECK_KEY, 0);

  if (!options.force && !checkEnabled) {
    return;
  }
  if (
    !options.force &&
    options.silent &&
    Date.now() - lastCheck < hours * 3600_000
  ) {
    return;
  }

  let latest: LatestRelease;
  try {
    latest = await fetchLatestRelease();
    await context.globalState.update(LAST_CHECK_KEY, Date.now());
  } catch (err) {
    if (!options.silent) {
      const message = err instanceof Error ? err.message : String(err);
      void vscode.window.showErrorMessage(`Check for updates failed: ${message}`);
    }
    return;
  }

  if (!isNewerVersion(latest.version, current)) {
    if (!options.silent) {
      void vscode.window.showInformationMessage(
        `Token Remaining ${current} is up to date.`
      );
    }
    return;
  }

  if (!options.force && options.silent && skipped === latest.version) {
    return;
  }

  if (options.silent && autoUpdate) {
    try {
      await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: `Token Remaining ${latest.version}`,
        },
        (progress) => installLatest(latest, progress)
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      void vscode.window.showErrorMessage(
        `Auto-update failed: ${message}`,
        "Open release"
      ).then((pick) => {
        if (pick === "Open release") {
          void vscode.env.openExternal(vscode.Uri.parse(latest.htmlUrl));
        }
      });
    }
    return;
  }

  const pick = await vscode.window.showInformationMessage(
    `Token Remaining ${latest.version} is available (you have ${current}).`,
    "Update",
    "Later",
    "Skip"
  );
  if (pick === "Skip") {
    await context.globalState.update(SKIP_KEY, latest.version);
    return;
  }
  if (pick !== "Update") {
    return;
  }
  try {
    await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: `Token Remaining ${latest.version}`,
      },
      (progress) => installLatest(latest, progress)
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const open = await vscode.window.showErrorMessage(
      `Update failed: ${message}`,
      "Open release"
    );
    if (open === "Open release") {
      await vscode.env.openExternal(vscode.Uri.parse(latest.htmlUrl));
    }
  }
}
