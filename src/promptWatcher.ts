import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import * as vscode from "vscode";

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
            name.endsWith(".json") ||
            name.includes("agent-transcript") ||
            name.includes("transcript") ||
            name.includes("session")
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
  roots.add(path.join(home, ".claude", "projects"));
  roots.add(path.join(home, ".codex"));
  roots.add(path.join(home, ".gemini"));

  for (const folder of vscode.workspace.workspaceFolders ?? []) {
    roots.add(path.join(folder.uri.fsPath, ".cursor"));
    roots.add(path.join(folder.uri.fsPath, ".claude"));
    roots.add(path.join(folder.uri.fsPath, ".codex"));
    roots.add(path.join(folder.uri.fsPath, ".gemini"));
  }

  return [...roots];
}
