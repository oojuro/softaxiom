// SPDX-FileCopyrightText: 2026 Soft Axiom contributors
// SPDX-License-Identifier: Apache-2.0
// Builds the request for one model round. The layout is the cache's (gateway/prompt.ts): the
// system text and tools never change from round to round; the history only ever grows at its end;
// whatever is new this round (the time, what memory recalls) comes last, after every breakpoint.
import type { OperationId } from "../../contracts/ids.ts";
import { codeOf, report } from "../../telemetry/report.ts";
import type { ModelMessage } from "ai";
import type { ModelRole } from "../gateway/catalog.ts";
import type { ModelRequest, ToolDefinition } from "../gateway/prompt.ts";
import { readPrompt } from "../harness/prompts.ts";
import { type TimelineDeps, timelineBlock } from "../timeline/block.ts";
import { compactTail } from "./compact.ts";
import { outside } from "./outside.ts";
import type {
  ConnectedRoutes,
  ContextCompactor,
  PersonProfile,
  Retrieval,
  StoredLine,
  SummarySource,
  TranscriptReader,
} from "./ports.ts";
import { readTail, taskPath } from "./tail.ts";
import { toMessages, type ViewLine } from "./view.ts";

/** Summaries shown ahead of the recent transcript. */
const summaryCount = 3;

export interface ContextDeps {
  prompt?: typeof readPrompt;
  transcript: TranscriptReader;
  retrieval: Retrieval;
  summaries: SummarySource;
  compactor?: ContextCompactor;
  profile: PersonProfile;
  connectedRoutes?: ConnectedRoutes;
  tools: { definitions(role: ModelRole): ToolDefinition[] };
  // The always-on skills index (one line per skill) and the folder it points into.
  skills: { root: string; index: string };
  // Whether a tool's results are outside content. Everything is, unless the tool says otherwise.
  isOutside?: (tool: string) => boolean;
  // The person's own picture of their time and place, shown in the conversation's rounds. Without
  // it the context has no Timeline block.
  timeline?: Omit<TimelineDeps, "transcript">;
  now?: () => Date;
}

export interface AssembleInput {
  personId: string;
  runId: string;
  operationId: OperationId;
  role: ModelRole;
  replyChannel: string;
  // Set for a work task's round, which reads the task's own transcript instead of the conversation.
  taskId?: string;
  // The retry the platform pays for: it asks memory nothing, so it costs the person nothing.
  platformFunded?: boolean;
  compact?: true;
}

const promptOf = { chat: "CHAT", work: "WORK" } as const;

// The prompt's last line is the one that names the person, so the skills index goes before it.
function systemText(
  role: ModelRole,
  name: string | undefined,
  skills: ContextDeps["skills"],
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

const latestPersonText = (lines: StoredLine[]) =>
  lines.findLast((line) => line.kind === "message" && line.provenance === "person");

// The window moves along a task's file, but its first line is the job, so that is always shown.
async function withJob(
  reader: TranscriptReader,
  personId: string,
  taskId: string,
  tail: ViewLine[],
): Promise<ViewLine[]> {
  if (tail.length === 0 || tail[0]?.seq === 1) return tail;
  const path = taskPath(taskId);
  const [job] = await reader.read(personId, path, { from: 1, to: 1 });
  return job ? [{ ...job, path }, ...tail] : tail;
}

export function createContextAssembler(deps: ContextDeps) {
  const isOutside = deps.isOutside ?? (() => true);
  const now = deps.now ?? (() => new Date());

  async function recall(input: AssembleInput, lines: StoredLine[]) {
    const asked = input.taskId
      ? lines.findLast(
          (line) =>
            line.kind === "message" &&
            line.role === "user" &&
            (line.op === `task:${input.taskId}:brief` || line.op.startsWith("control:")),
        )
      : latestPersonText(lines);
    const words = (asked?.body as { text?: unknown } | undefined)?.text;
    if (input.platformFunded || typeof words !== "string" || words === "") return undefined;
    try {
      return await deps.retrieval.retrieve(input.personId, {
        text: words,
        operation: input.operationId,
        ...(input.taskId && { skillsOnly: true }),
      });
    } catch (error) {
      // Memory is a help, not a need: the round goes on with the recent transcript alone.
      report("agent", "recall", "failed", codeOf(error));
      return undefined;
    }
  }

  // A help like memory: when it cannot be read the round goes on without it.
  async function timeline(input: AssembleInput, timeZone: string) {
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

  return {
    async assemble(input: AssembleInput): Promise<ModelRequest> {
      const { personId, role, taskId } = input;
      const [profile, summaries, lines] = await Promise.all([
        deps.profile.get(personId),
        // A task's job is self-contained: it is not given the conversation's summaries.
        taskId ? [] : deps.summaries.latest(personId, summaryCount),
        readTail(deps.transcript, personId, input.runId, taskId).then((tail) =>
          taskId ? withJob(deps.transcript, personId, taskId, tail) : tail,
        ),
      ]);
      const compacted = input.compact
        ? await compactTail(deps.compactor, personId, lines, taskId, input.platformFunded)
        : { summaries: [], lines };
      const shownSummaries = [...summaries, ...compacted.summaries];
      const [recalled, picture, native] = await Promise.all([
        recall(input, lines),
        timeline(input, profile.timeZone),
        connectedRoutes(personId),
      ]);

      const earlier: ModelMessage[] =
        shownSummaries.length === 0
          ? []
          : [
              {
                role: "user",
                content: shownSummaries
                  .map(({ path, text }) => `[summary ${path}]\n${outside("summary", path, text)}`)
                  .join("\n\n"),
              },
            ];
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
        history: [
          ...earlier,
          ...toMessages(compacted.lines, { isOutside, allowAssistantStart: earlier.length > 0 }),
        ],
        context,
      };
    },
  };
}
