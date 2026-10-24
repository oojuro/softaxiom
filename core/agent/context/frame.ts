// SPDX-FileCopyrightText: 2026 Soft Axiom contributors
// SPDX-License-Identifier: Apache-2.0
// Host framing for an engine-selected context. OpenClaw owns history windows, tool-result
// pairing and compaction; this adapter contributes product prompts and bounded outside data.
import type { OperationId } from "../../contracts/ids.ts";
import { codeOf, report } from "../../telemetry/report.ts";
import type { Message } from "../provider.ts";
import type { ModelRole } from "../gateway/catalog.ts";
import type { ModelRequest, ToolDefinition } from "../gateway/prompt.ts";
import { readPrompt } from "../harness/prompts.ts";
import { type TimelineDeps, timelineBlock } from "../timeline/block.ts";
import { outside } from "./outside.ts";
import type {
  ConnectedRoutes,
  PersonProfile,
  Retrieval,
  SummarySource,
  TranscriptReader,
} from "./ports.ts";

/** Summaries shown ahead of the recent transcript. */
const summaryCount = 3;

export interface FrameDeps {
  prompt?: typeof readPrompt;
  transcript: TranscriptReader;
  retrieval: Retrieval;
  summaries: SummarySource;
  profile: PersonProfile;
  connectedRoutes?: ConnectedRoutes;
  tools: { definitions(role: ModelRole): ToolDefinition[] };
  // The always-on skills index (one line per skill) and the folder it points into.
  skills: { root: string; index: string };
  // The person's own picture of their time and place, shown in the conversation's rounds. Without
  // it the context has no Timeline block.
  timeline?: Omit<TimelineDeps, "transcript">;
  now?: () => Date;
}

export interface FrameInput {
  personId: string;
  runId: string;
  operationId: OperationId;
  role: ModelRole;
  replyChannel: string;
  // Set for a work task's round, which reads the task's own transcript instead of the conversation.
  taskId?: string;
  // The retry the platform pays for: it asks memory nothing, so it costs the person nothing.
  platformFunded?: boolean;
  history: Message[];
  // Extracted by trusted ingress; never inferred from tool results or specialist reports.
  ask: string;
}

const promptOf = { chat: "CHAT", work: "WORK" } as const;

// The prompt's last line is the one that names the person, so the skills index goes before it.
function systemText(
  role: ModelRole,
  name: string | undefined,
  skills: FrameDeps["skills"],
  agentName?: string,
  prompt = readPrompt,
) {
  if (role !== "chat" && role !== "work") throw new Error(`${role} calls are not assembled here`);
  const lines = prompt(promptOf[role], name, undefined, agentName).trimEnd().split("\n");
  const last = lines.pop();
  const index = skills.index ? ["Skills:", skills.index, ""] : [];
  return [...lines, "", ...index, last].join("\n");
}

function timeLine(now: Date, timeZone: string) {
  const at = (options: Intl.DateTimeFormatOptions, locale: string) =>
    new Intl.DateTimeFormat(locale, { timeZone, ...options }).format(now);
  const offset = at({ timeZoneName: "longOffset" }, "en-US").split("GMT")[1] || "+00:00";
  const clock = at({ hour: "2-digit", minute: "2-digit", hourCycle: "h23" }, "en-GB");
  const weekday = at({ weekday: "long" }, "en-US");
  return `Now: ${weekday} ${at({}, "en-CA")} ${clock} ${timeZone} (UTC${offset})`;
}

export function createRequestFrame(deps: FrameDeps) {
  const now = deps.now ?? (() => new Date());

  async function recall(input: FrameInput) {
    if (input.platformFunded || input.ask === "") return undefined;
    try {
      return await deps.retrieval.retrieve(input.personId, {
        text: input.ask, operation: input.operationId,
        ...(input.taskId && { skillsOnly: true }),
      });
    } catch (error) {
      report("agent", "recall", "failed", codeOf(error));
      return undefined;
    }
  }

  // A help like memory: when it cannot be read the round goes on without it.
  async function timeline(input: FrameInput, timeZone: string) {
    if (!deps.timeline || input.taskId || input.platformFunded) return "";
    try {
      const reader = { ...deps.timeline, transcript: deps.transcript };
      return await timelineBlock(reader, input.personId, now(), timeZone);
    } catch (error) {
      report("agent", "timeline", "failed", codeOf(error));
      return "";
    }
  }

  async function connectedRoutes(personId: string) {
    if (!deps.connectedRoutes) return "";
    try {
      const routes = await deps.connectedRoutes.index(personId);
      return routes.length
        ? `Connected routes (notes, not proof of live access):\n${outside("connected_routes", "connected routes", JSON.stringify(routes))}`
        : "";
    } catch (error) {
      report("agent", "connected_routes", "failed", codeOf(error));
      return "Connected routes could not be loaded; their connection state is unknown.";
    }
  }

  return async function frame(input: FrameInput): Promise<ModelRequest> {
    const { personId, role, taskId } = input;
    const [profile, summaries] = await Promise.all([
      deps.profile.get(personId),
      taskId ? [] : deps.summaries.latest(personId, summaryCount),
    ]);
    const [recalled, picture, native] = await Promise.all([
      recall(input), timeline(input, profile.timeZone), connectedRoutes(personId),
    ]);
    const earlier = summaries.map(({path, text}) =>
      `[summary ${path}]\n${outside("summary", path, text)}`).join("\n\n");
    const matches = (recalled?.matches ?? [])
      .slice(0, 8)
      .map(
        ({ reference, kind, excerpt }) =>
          `- ${reference} (${kind})\n${outside("memory", reference, excerpt)}`,
      );
    const skills = (recalled?.skills ?? []).map(
      ({ folder }) => `${deps.skills.root}/${folder}/SKILL.md (source: shipped)`,
    );
    const context = [
      timeLine(now(), profile.timeZone),
      ...(taskId ? [] : [`Reply on: ${input.replyChannel}`]),
      ...(earlier ? [earlier] : []),
      ...(picture ? [picture] : []),
      ...(native ? [native] : []),
      ...(matches.length > 0 ? ["Matches:", ...matches] : []),
      ...(skills.length > 0 ? [`Skills that may fit: ${skills.join(", ")}`] : []),
    ].join("\n");

    return {
      operationId: input.operationId,
      role,
      system: systemText(role, profile.name, deps.skills, profile.agentName, deps.prompt),
      tools: deps.tools.definitions(role),
      history: [],
      engineHistory: input.history,
      context,
    };
  };
}
