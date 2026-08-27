import { fetchAll, PROVIDER_IDS } from "./core/fetchAll";
import { formatReportJson, formatReportText } from "./core/format";

function printHelp(): void {
  process.stdout.write(`token-remaining — usage meters for Cursor, Copilot, Claude, Codex, Gemini, Windsurf

Usage:
  token-remaining
  token-remaining --json
  token-remaining --provider <id>

Providers: ${PROVIDER_IDS.join(", ")}
`);
}

async function main(argv: string[]): Promise<void> {
  let json = false;
  let provider: string | undefined;
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--help" || arg === "-h") {
      printHelp();
      return;
    }
    if (arg === "--json") {
      json = true;
      continue;
    }
    if (arg === "--provider" || arg === "-p") {
      provider = argv[i + 1];
      i += 1;
      continue;
    }
    if (arg.startsWith("--provider=")) {
      provider = arg.slice("--provider=".length);
      continue;
    }
    process.stderr.write(`Unknown argument: ${arg}\n`);
    printHelp();
    process.exitCode = 1;
    return;
  }

  if (provider && !PROVIDER_IDS.includes(provider)) {
    process.stderr.write(
      `Unknown provider "${provider}". Use one of: ${PROVIDER_IDS.join(", ")}\n`
    );
    process.exitCode = 1;
    return;
  }

  const report = await fetchAll({
    only: provider ? [provider] : undefined,
  });
  process.stdout.write(
    json ? formatReportJson(report) : `${formatReportText(report)}\n`
  );
}

main(process.argv.slice(2)).catch((err: unknown) => {
  const message = err instanceof Error ? err.message : String(err);
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
});
