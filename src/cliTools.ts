import { execFile } from "child_process";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { promisify } from "util";

const execFileAsync = promisify(execFile);

export type CliTool = "claude" | "codex" | "gemini";

const NPM_PACKAGES: Record<CliTool, string> = {
  claude: "@anthropic-ai/claude-code",
  codex: "@openai/codex",
  gemini: "@google/gemini-cli",
};

const EXTRA_DIRS = [
  "/opt/homebrew/bin",
  "/usr/local/bin",
  path.join(os.homedir(), ".local", "bin"),
  path.join(os.homedir(), ".npm-global", "bin"),
];

function loginShell(): string {
  if (process.platform === "win32") {
    return process.env.ComSpec || "cmd.exe";
  }
  return process.env.SHELL || "/bin/zsh";
}

function binFileName(name: string): string {
  return process.platform === "win32" ? `${name}.cmd` : name;
}

export async function findBinary(name: string): Promise<string | null> {
  const shell = loginShell();
  try {
    if (process.platform === "win32") {
      const { stdout } = await execFileAsync(shell, ["/c", `where ${name}`], {
        timeout: 8000,
      });
      const first = stdout
        .split(/\r?\n/)
        .map((line) => line.trim())
        .find((line) => line.length > 0);
      if (first && fs.existsSync(first)) {
        return first;
      }
    } else {
      const { stdout } = await execFileAsync(
        shell,
        ["-lic", `command -v ${name}`],
        { timeout: 8000 }
      );
      const found = stdout.trim().split("\n").pop()?.trim();
      if (found && fs.existsSync(found)) {
        return found;
      }
    }
  } catch {
    // keep looking in well-known dirs
  }
  for (const dir of EXTRA_DIRS) {
    const candidate = path.join(dir, binFileName(name));
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }
  return null;
}

export async function ensureCli(tool: CliTool): Promise<string> {
  const existing = await findBinary(tool);
  if (existing) {
    return existing;
  }
  const npmBin = await findBinary("npm");
  if (!npmBin) {
    throw new Error(
      `ไม่พบคำสั่ง ${tool} และไม่พบ npm สำหรับติดตั้ง — ติดตั้ง Node.js ก่อน`
    );
  }
  const pkg = NPM_PACKAGES[tool];
  const shell = loginShell();
  if (process.platform === "win32") {
    await execFileAsync(shell, ["/c", `"${npmBin}" install -g ${pkg}`], {
      timeout: 180_000,
    });
  } else {
    await execFileAsync(shell, ["-lic", `"${npmBin}" install -g ${pkg}`], {
      timeout: 180_000,
    });
  }
  const installed = await findBinary(tool);
  if (!installed) {
    throw new Error(`ติดตั้ง ${pkg} แล้ว แต่ยังหาคำสั่ง ${tool} ไม่เจอ`);
  }
  return installed;
}

export function loginCommand(tool: CliTool, binPath: string): string {
  const quoted = `"${binPath}"`;
  if (tool === "claude") {
    return `${quoted} auth login`;
  }
  if (tool === "codex") {
    return `${quoted} login`;
  }
  return `${quoted} auth login`;
}
