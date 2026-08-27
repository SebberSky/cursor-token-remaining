import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { fetchAll, PROVIDER_IDS } from "./core/fetchAll";
import { formatReportJson } from "./core/format";

const server = new McpServer({
  name: "token-remaining",
  version: "0.3.0",
});

async function getUsage(args: { provider?: string }) {
  const report = await fetchAll({
    only: args.provider ? [args.provider] : undefined,
  });
  return {
    content: [{ type: "text" as const, text: formatReportJson(report) }],
  };
}

// @ts-expect-error MCP SDK Zod generics exceed TS instantiation depth
server.tool(
  "get_usage",
  "Fetch remaining usage for signed-in AI providers (Cursor, Copilot, Claude, Codex, Gemini, Windsurf).",
  {
    provider: z
      .string()
      .optional()
      .describe(`Optional provider id. One of: ${PROVIDER_IDS.join(", ")}`),
  },
  getUsage as never
);

async function main(): Promise<void> {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err: unknown) => {
  const message = err instanceof Error ? err.message : String(err);
  process.stderr.write(`${message}\n`);
  process.exit(1);
});
