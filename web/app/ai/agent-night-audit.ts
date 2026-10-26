import type { GameState } from "../../../modernization/runtime/state/game-state.js";
import type {
  AgentNightAuditResponseV1,
  AgentNightDraft,
} from "../../../modernization/runtime/agent/types.js";
import type { AiCompletionRequest, AiSettings } from "./types.js";
import { jsonBody } from "./response-validator.js";
import { parseAgentInterestingEvent } from "./agent-night-validator.js";

export function buildAgentNightAuditCompletion(input: {
  state: Readonly<GameState>;
  dayIndex: number;
  contextHash: string;
  drafts: readonly AgentNightDraft[];
  phase: "initial" | "recheck";
  settings: AiSettings;
}): AiCompletionRequest {
  const ledgerDay = input.state.agentRuntime?.dailyLedger.days.find((day) => day.dayIndex === input.dayIndex);
  const facts = Object.values(ledgerDay?.characters ?? {}).map((record) => ({
    charaNum: record.charaNum,
    activities: record.activities,
    visitedLocations: record.visitedLocations,
    encounters: record.encounters,
  }));
  const stories = input.drafts.filter((draft) => draft.response.interestingEvent).map((draft) => ({
    charaNum: draft.charaNum,
    interestingEvent: draft.response.interestingEvent,
  }));
  const actions = input.phase === "initial" ? "accept、rewrite 或 delete" : "accept 或 delete（禁止再次 rewrite）";
  return {
    system: [
      "你是独立的批量故事一致性核查器。",
      "区分主观理解不同与客观冲突；只检查人物、地点、时间、行动和同场事实。",
      "不得修改态度或倾向，不得增加状态、物品、关系或结算。只输出严格 JSON。",
    ].join("\n"),
    user: [
      `阶段：${input.phase}；每项只能 ${actions}。`,
      `全局确定性账本：${JSON.stringify(facts)}`,
      `待核查自由故事：${JSON.stringify(stories)}`,
      `输出：{"schemaVersion":1,"dayIndex":${input.dayIndex},"contextHash":"${input.contextHash}","decisions":[{"charaNum":1,"action":"accept"}]}`,
      "rewrite 时必须附 interestingEvent（结构与原稿相同）；accept/delete 时不得附带。每个输入故事恰好一项决定，不得有额外字段。",
    ].join("\n\n"),
    temperature: 0.1,
    maxTokens: 1200,
    jsonMode: true,
  };
}

function objectValue(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} must be an object`);
  return value as Record<string, unknown>;
}

function exactKeys(value: Record<string, unknown>, allowed: readonly string[], label: string): void {
  const set = new Set(allowed);
  const extras = Object.keys(value).filter((key) => !set.has(key));
  if (extras.length > 0) throw new Error(`${label} contains extra keys: ${extras.join(",")}`);
}

export function parseAgentNightAuditResponse(
  raw: string,
  expected: { dayIndex: number; contextHash: string; charaNums: readonly number[]; allowRewrite: boolean },
): AgentNightAuditResponseV1 {
  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonBody(raw));
  } catch {
    throw new Error("Agent night audit response is not valid JSON");
  }
  const obj = objectValue(parsed, "audit");
  exactKeys(obj, ["schemaVersion", "dayIndex", "contextHash", "decisions"], "audit");
  if (obj.schemaVersion !== 1 || obj.dayIndex !== expected.dayIndex || obj.contextHash !== expected.contextHash) {
    throw new Error("audit envelope mismatch");
  }
  if (!Array.isArray(obj.decisions) || obj.decisions.length !== expected.charaNums.length) {
    throw new Error("audit decisions must cover every story exactly once");
  }
  const expectedSet = new Set(expected.charaNums);
  const seen = new Set<number>();
  const decisions = obj.decisions.map((value, index) => {
    const decision = objectValue(value, `decisions[${index}]`);
    exactKeys(decision, ["charaNum", "action", "interestingEvent"], `decisions[${index}]`);
    if (!Number.isSafeInteger(decision.charaNum) || !expectedSet.has(Number(decision.charaNum)) || seen.has(Number(decision.charaNum))) {
      throw new Error("audit decision has unknown or duplicate charaNum");
    }
    const charaNum = Number(decision.charaNum);
    seen.add(charaNum);
    const action = decision.action;
    if (action !== "accept" && action !== "delete" && action !== "rewrite") throw new Error("invalid audit action");
    if (action === "rewrite") {
      if (!expected.allowRewrite) throw new Error("rewrite is forbidden during recheck");
      const interestingEvent = parseAgentInterestingEvent(decision.interestingEvent, `decisions[${index}].interestingEvent`);
      if (!interestingEvent) throw new Error("rewrite requires interestingEvent");
      return { charaNum, action, interestingEvent } as const;
    }
    if (decision.interestingEvent !== undefined) throw new Error("accept/delete must not include interestingEvent");
    return { charaNum, action } as const;
  });
  return { schemaVersion: 1, dayIndex: expected.dayIndex, contextHash: expected.contextHash, decisions };
}
