import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import * as vscode from "vscode";

/**
 * Refresh when an agent/transcript file settles after writes —
 * a practical signal that a prompt turn finished.
 */
export function watchPromptActivity(
  onPromptSettled: () => void
): vscode.Disposable {
  const roots = collectWatchRoots();
  const watchers: fs.FSWatcher[] = [];
  let timer: NodeJS.Timeout | undefined;
  let disposed = false;

  const schedule = () => {
    if (disposed) {
      return;
    }
    if (timer) {
      clearTimeout(timer);
    }
    // Wait for the turn to finish writing transcripts/tools.
    timer = setTimeout(() => {
      if (!disposed) {
        onPromptSettled();
      }
    }, 1800);
  };

  for (const root of roots) {
    try {
      if (!fs.existsSync(root)) {
        continue;
      }
      const watcher = fs.watch(
        root,
        { recursive: true },
        (_event, filename) => {
          if (!filename) {
            schedule();
            return;
          }
          const name = filename.toString();
          if (
            name.endsWith(".jsonl") ||
            name.includes("agent-transcript") ||
            name.includes("transcript")
          ) {
            schedule();
          }
        }
      );
      watchers.push(watcher);
    } catch {
      // Ignore roots we cannot watch.
    }
  }

  return new vscode.Disposable(() => {
    disposed = true;
    if (timer) {
      clearTimeout(timer);
    }
    for (const w of watchers) {
      try {
        w.close();
      } catch {
        // ignore
      }
    }
  });
}

function collectWatchRoots(): string[] {
  const roots = new Set<string>();
  const home = os.homedir();
  roots.add(path.join(home, ".cursor", "projects"));

  for (const folder of vscode.workspace.workspaceFolders ?? []) {
    roots.add(path.join(folder.uri.fsPath, ".cursor"));
  }

  return [...roots];
}
