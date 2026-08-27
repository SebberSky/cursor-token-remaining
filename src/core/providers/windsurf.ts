import * as fs from "fs";
import { postJson, rethrowRateLimit } from "../http";
import { firstExisting, vscodeStateDb } from "../paths";
import { readItemTableValue } from "../sqlite";
import { errorMessage, ratioToUsedPercent, toMs } from "../percent";
import { titled } from "../plan";
import {
  failedSnapshot,
  okSnapshot,
  type FetchContext,
  type Meter,
  type Provider,
  type ProviderSnapshot,
} from "../types";

export const WINDSURF_ID = "windsurf";
export const WINDSURF_DISPLAY = "Windsurf";

type PlanStatus = {
  planInfo?: {
    planName?: string;
    monthlyPromptCredits?: number;
    monthlyFlexCreditPurchaseAmount?: number;
    planStart?: string;
    planEnd?: string;
  };
  availablePromptCredits?: number;
  usedPromptCredits?: number;
  availableFlexCredits?: number;
  usedFlexCredits?: number;
};

export type WindsurfStatusResponse = {
  planStatus?: PlanStatus;
};

function dbCandidates(): string[] {
  return [
    vscodeStateDb("Windsurf"),
    vscodeStateDb("Windsurf - Next"),
    vscodeStateDb("Windsurf-Next"),
  ];
}

function parseApiKey(raw: string | null): string | null {
  if (!raw) {
    return null;
  }
  try {
    const parsed = JSON.parse(raw) as { apiKey?: string; api_key?: string };
    const key = parsed.apiKey ?? parsed.api_key;
    return key && key.length > 0 ? key : null;
  } catch {
    return raw.length > 0 ? raw : null;
  }
}

export async function getWindsurfApiKey(): Promise<string | null> {
  const dbPath = firstExisting(dbCandidates().filter((p) => fs.existsSync(p)));
  if (!dbPath) {
    return null;
  }
  const raw = await readItemTableValue(dbPath, "windsurfAuthStatus");
  return parseApiKey(raw);
}

function hundredths(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return undefined;
  }
  return value / 100;
}

export function parseWindsurfStatus(data: WindsurfStatusResponse): Meter[] {
  const status = data.planStatus;
  if (!status) {
    return [];
  }
  const info = status.planInfo ?? {};
  const resetsAt = toMs(info.planEnd ?? null) ?? undefined;
  const meters: Meter[] = [];

  const promptLimit =
    hundredths(info.monthlyPromptCredits) ??
    hundredths(status.availablePromptCredits);
  const promptUsed = hundredths(status.usedPromptCredits) ?? 0;
  if (promptLimit != null) {
    meters.push({
      id: "windsurf.prompt",
      provider: WINDSURF_ID,
      label: "Prompt",
      usedPercent: ratioToUsedPercent(promptUsed, promptLimit),
      used: promptUsed,
      limit: promptLimit,
      unit: "credits",
      resetsAt,
    });
  }

  const flexLimit =
    hundredths(info.monthlyFlexCreditPurchaseAmount) ??
    hundredths(status.availableFlexCredits);
  const flexUsed = hundredths(status.usedFlexCredits);
  if (flexLimit != null && flexLimit > 0) {
    meters.push({
      id: "windsurf.flex",
      provider: WINDSURF_ID,
      label: "Flex",
      usedPercent: ratioToUsedPercent(flexUsed ?? 0, flexLimit),
      used: flexUsed,
      limit: flexLimit,
      unit: "credits",
      resetsAt,
    });
  } else if (status.availableFlexCredits != null) {
    const available = hundredths(status.availableFlexCredits) ?? 0;
    meters.push({
      id: "windsurf.flex",
      provider: WINDSURF_ID,
      label: "Flex",
      usedPercent: 0,
      used: 0,
      limit: available,
      unit: "credits",
      resetsAt,
    });
  }

  return meters;
}

async function detect(_ctx: FetchContext): Promise<boolean> {
  return (await getWindsurfApiKey()) != null;
}

async function fetchSnapshot(_ctx: FetchContext): Promise<ProviderSnapshot> {
  try {
    const apiKey = await getWindsurfApiKey();
    if (!apiKey) {
      return failedSnapshot(
        WINDSURF_ID,
        WINDSURF_DISPLAY,
        "Windsurf API key not found."
      );
    }
    const data = (await postJson(
      "https://server.codeium.com/exa.seat_management_pb.SeatManagementService/GetUserStatus",
      { "Connect-Protocol-Version": "1" },
      {
        metadata: {
          apiKey,
          api_key: apiKey,
          ideName: "windsurf",
          ide_name: "windsurf",
        },
      }
    )) as WindsurfStatusResponse;
    const meters = parseWindsurfStatus(data);
    const planName = data.planStatus?.planInfo?.planName;
    return okSnapshot(
      WINDSURF_ID,
      titled(WINDSURF_DISPLAY, planName),
      meters
    );
  } catch (err) {
    rethrowRateLimit(err);
    return failedSnapshot(WINDSURF_ID, WINDSURF_DISPLAY, errorMessage(err));
  }
}

export const windsurfProvider: Provider = {
  id: WINDSURF_ID,
  displayName: WINDSURF_DISPLAY,
  detect,
  fetch: fetchSnapshot,
};
