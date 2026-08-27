import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseClaudeUsage } from "./providers/claude";
import { parseCodexUsage } from "./providers/codex";
import { parseCopilotQuota } from "./providers/copilot";
import { parseCursorUsage } from "./providers/cursor";
import { parseGeminiQuota } from "./providers/gemini";
import { parseWindsurfStatus } from "./providers/windsurf";
import { isNewerVersion, parseSemver } from "./semver";
import { filterVisible, hiddenFromPicked } from "./visibility";
import {
  claudeAuthorizeUrl,
  createPkce,
  parseClaudePasteCode,
} from "./oauth";
import { chatgptAccountId, parseCodexAuthData } from "./providers/codex";
import { loginCommand } from "../cliTools";
import {
  formatClaudePlan,
  formatCodexPlan,
  formatCopilotPlan,
  titled,
  windowLabelFromSeconds,
} from "./plan";
import { formatResetIn } from "./format";

describe("parseCursorUsage", () => {
  it("maps free/api percents and agent buckets", () => {
    const usage = parseCursorUsage(
      {
        billingCycleEnd: 1_700_000_000_000,
        planUsage: {
          autoPercentUsed: 42.4,
          apiPercentUsed: 10,
          limit: 2000,
        },
        autoBucketModels: ["composer"],
      },
      [
        { modelIntent: "composer", totalCents: 400, tier: 2 },
        { modelIntent: "gpt-4.1", totalCents: 200, tier: 1 },
      ]
    );
    assert.equal(usage.freePercent, 42.4);
    assert.equal(usage.apiPercent, 10);
    assert.equal(usage.freeUsedCents, 848);
    assert.equal(usage.agents[0]?.name, "composer");
    assert.equal(usage.agents[0]?.isFree, true);
    assert.equal(usage.agents[1]?.isFree, false);
  });
});

describe("parseCopilotQuota", () => {
  it("uses percent_remaining and skips unlimited", () => {
    const meters = parseCopilotQuota({
      quota_reset_date: "2026-05-01T00:00:00Z",
      quota_snapshots: {
        chat: {
          unlimited: true,
          percent_remaining: 100,
        },
        premium_interactions: {
          entitlement: 300,
          remaining: 93,
          percent_remaining: 31.17,
        },
      },
    });
    assert.equal(meters.length, 1);
    assert.equal(meters[0]?.id, "copilot.premium_interactions");
    assert.equal(meters[0]?.label, "Premium");
    assert.equal(meters[0]?.usedPercent, 68.83);
    assert.equal(meters[0]?.used, 207);
    assert.equal(meters[0]?.limit, 300);
  });
});

describe("parseClaudeUsage", () => {
  it("reads five_hour / seven_day utilization fractions", () => {
    const meters = parseClaudeUsage({
      five_hour: { utilization: 0.42, resets_at: "2026-02-28T17:00:00Z" },
      seven_day: { utilization: 0.61, resets_at: "2026-03-07T08:00:00Z" },
    });
    assert.equal(meters.length, 2);
    assert.equal(meters[0]?.id, "claude.session");
    assert.equal(meters[0]?.usedPercent, 42);
    assert.equal(meters[1]?.id, "claude.weekly");
    assert.equal(meters[1]?.usedPercent, 61);
  });

  it("prefers structured limits array when present", () => {
    const meters = parseClaudeUsage({
      five_hour: { utilization: 0.1 },
      limits: [
        { kind: "session", percent: 23.5, resets_at: 1738425600 },
        { kind: "weekly_all", percent: 41.2 },
      ],
    });
    assert.equal(meters.length, 2);
    assert.equal(meters[0]?.label, "Session");
    assert.equal(meters[0]?.usedPercent, 23.5);
    assert.equal(meters[1]?.label, "Weekly");
  });
});

describe("parseCodexUsage", () => {
  it("maps primary/secondary windows", () => {
    const meters = parseCodexUsage({
      rate_limit: {
        primary_window: { used_percent: 12, reset_at: 1_800_000_000 },
        secondary_window: { percent_left: 40 },
      },
    });
    assert.equal(meters[0]?.id, "codex.5h");
    assert.equal(meters[0]?.usedPercent, 12);
    assert.equal(meters[1]?.id, "codex.weekly");
    assert.equal(meters[1]?.usedPercent, 60);
  });

  it("labels windows from limit_window_seconds not slot name", () => {
    const meters = parseCodexUsage({
      plan_type: "prolite",
      rate_limit: {
        primary_window: {
          used_percent: 19,
          limit_window_seconds: 604800,
        },
        secondary_window: null,
      },
    });
    assert.equal(meters.length, 1);
    assert.equal(meters[0]?.id, "codex.weekly");
    assert.equal(meters[0]?.label, "Weekly");
    assert.equal(meters[0]?.usedPercent, 19);
  });
});

describe("parseGeminiQuota", () => {
  it("converts remainingFraction to used percent", () => {
    const meters = parseGeminiQuota({
      buckets: [
        { modelId: "gemini-2.5-pro", remainingFraction: 0.7 },
        { modelId: "gemini-2.5-flash", remainingFraction: 0.2 },
      ],
    });
    assert.equal(meters[0]?.usedPercent, 80);
    assert.equal(meters[1]?.usedPercent, 30);
  });
});

describe("parseWindsurfStatus", () => {
  it("divides hundredths into credits", () => {
    const meters = parseWindsurfStatus({
      planStatus: {
        planInfo: {
          monthlyPromptCredits: 50000,
          planEnd: "2026-09-18T00:00:00Z",
        },
        usedPromptCredits: 4700,
        availableFlexCredits: 2679300,
        usedFlexCredits: 15550,
      },
    });
    const prompt = meters.find((m) => m.id === "windsurf.prompt");
    const flex = meters.find((m) => m.id === "windsurf.flex");
    assert.equal(prompt?.limit, 500);
    assert.equal(prompt?.used, 47);
    assert.equal(prompt?.usedPercent, 9.4);
    assert.ok(flex);
    assert.equal(flex?.used, 155.5);
  });
});

describe("semver", () => {
  it("parses v-prefixed tags", () => {
    assert.deepEqual(parseSemver("v0.3.1"), [0, 3, 1]);
    assert.deepEqual(parseSemver("0.2.9"), [0, 2, 9]);
  });

  it("detects newer releases", () => {
    assert.equal(isNewerVersion("0.3.1", "0.3.0"), true);
    assert.equal(isNewerVersion("0.3.0", "0.3.0"), false);
    assert.equal(isNewerVersion("0.2.9", "0.3.0"), false);
    assert.equal(isNewerVersion("v1.0.0", "0.9.9"), true);
  });
});

describe("filterVisible", () => {
  const report = {
    fetchedAt: 1,
    meters: [],
    providers: [
      {
        id: "cursor",
        displayName: "Cursor",
        skipped: false,
        meters: [
          { id: "cursor.free", provider: "cursor", label: "FREE", usedPercent: 10 },
          { id: "cursor.api", provider: "cursor", label: "API", usedPercent: 4 },
        ],
        fetchedAt: 1,
      },
      {
        id: "claude",
        displayName: "Claude",
        skipped: true,
        meters: [],
        fetchedAt: 1,
      },
      {
        id: "copilot",
        displayName: "Copilot",
        skipped: false,
        error: "401",
        meters: [],
        fetchedAt: 1,
      },
    ],
  };

  it("hides skipped and error-only providers", () => {
    const { groups, meters } = filterVisible(report, new Set());
    assert.equal(groups.length, 1);
    assert.equal(groups[0]?.id, "cursor");
    assert.equal(meters.length, 2);
  });

  it("hides providers that have credentials but no meters", () => {
    const emptyMeters = {
      ...report,
      providers: [
        {
          id: "gemini",
          displayName: "Gemini",
          skipped: false,
          meters: [],
          fetchedAt: 1,
        },
      ],
    };
    const { groups, meters } = filterVisible(emptyMeters, new Set());
    assert.equal(groups.length, 0);
    assert.equal(meters.length, 0);
  });

  it("hides manually hidden meters", () => {
    const { meters } = filterVisible(report, new Set(["cursor.api"]));
    assert.deepEqual(
      meters.map((m) => m.id),
      ["cursor.free"]
    );
  });

  it("builds hidden set from unpicked meters", () => {
    const all = report.providers[0]!.meters;
    const hidden = hiddenFromPicked(all, new Set(["cursor.free"]));
    assert.equal(hidden.has("cursor.api"), true);
    assert.equal(hidden.has("cursor.free"), false);
  });
});

describe("oauth helpers", () => {
  it("builds a Claude authorize URL with PKCE state=verifier", () => {
    const pkce = createPkce();
    const url = new URL(claudeAuthorizeUrl(pkce));
    assert.equal(url.searchParams.get("code"), "true");
    assert.equal(url.searchParams.get("code_challenge_method"), "S256");
    assert.equal(url.searchParams.get("state"), pkce.verifier);
    assert.equal(url.searchParams.get("code_challenge"), pkce.challenge);
  });

  it("parses Claude paste codes from hash, raw, or URL", () => {
    const verifier = "verifier";
    assert.deepEqual(parseClaudePasteCode("abc#verifier", verifier), {
      code: "abc",
      state: "verifier",
    });
    assert.deepEqual(parseClaudePasteCode("abc", verifier), {
      code: "abc",
      state: verifier,
    });
    assert.deepEqual(
      parseClaudePasteCode(
        "https://console.anthropic.com/oauth/code/callback?code=xyz%23verifier",
        verifier
      ),
      { code: "xyz", state: "verifier" }
    );
  });

  it("reads Codex access/accountId aliases", () => {
    const parsed = parseCodexAuthData({
      access: "tok",
      accountId: "acct",
    });
    assert.equal(parsed?.token, "tok");
    assert.equal(parsed?.accountId, "acct");
  });

  it("extracts ChatGPT account id from JWT", () => {
    const payload = Buffer.from(
      JSON.stringify({ chatgpt_account_id: "acct_9" })
    ).toString("base64url");
    assert.equal(chatgptAccountId(`x.${payload}.y`), "acct_9");
  });

  it("quotes CLI login commands", () => {
    assert.equal(loginCommand("claude", "/opt/homebrew/bin/claude"), '"/opt/homebrew/bin/claude" auth login');
    assert.equal(loginCommand("codex", "/usr/local/bin/codex"), '"/usr/local/bin/codex" login');
  });
});

describe("plan labels", () => {
  it("maps Codex plan_type including prolite", () => {
    assert.equal(formatCodexPlan("prolite"), "Pro");
    assert.equal(formatCodexPlan("plus"), "Plus");
    assert.equal(titled("Codex", formatCodexPlan("prolite")), "Codex · Pro");
  });

  it("labels windows from seconds", () => {
    assert.equal(windowLabelFromSeconds(604800, "5h"), "Weekly");
    assert.equal(windowLabelFromSeconds(18000, "Weekly"), "5h");
    assert.equal(windowLabelFromSeconds(undefined, "5h"), "5h");
  });

  it("maps Copilot and Claude plans", () => {
    assert.equal(formatCopilotPlan("individual"), "Individual");
    assert.equal(
      formatClaudePlan({
        organization: { rate_limit_tier: "default_claude_max_20x" },
      }),
      "Max 20x"
    );
  });
});

describe("formatResetIn", () => {
  const now = Date.parse("2026-08-27T10:00:00Z");

  it("formats remaining as days and hours", () => {
    const later = Date.parse("2026-08-29T15:00:00Z");
    assert.equal(formatResetIn(later, now), "Reset in 2 days 5 hours");
  });

  it("formats same-day remaining as 0 days", () => {
    const later = Date.parse("2026-08-27T13:30:00Z");
    assert.equal(formatResetIn(later, now), "Reset in 0 days 3 hours");
  });

  it("formats past timestamps as Reset now", () => {
    assert.equal(formatResetIn(now - 1, now), "Reset now");
  });
});
