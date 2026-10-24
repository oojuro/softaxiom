// SPDX-FileCopyrightText: 2026 Soft Axiom contributors
// SPDX-License-Identifier: Apache-2.0
// Stored-record compatibility only. Live state and provider protocols belong to OpenClaw.
type Options = { providerOptions?: Record<string, Record<string, unknown>> };
type Text = Options & { type: "text"; text: string };
type ToolCall = Options & { type: "tool-call"; toolCallId: string; toolName: string; input: unknown };
type Output = { type: "text" | "error-text"; value: string }
  | { type: "json" | "error-json"; value: unknown }
  | { type: "content"; value: unknown[] };
type ToolResult = Options & { type: "tool-result"; toolCallId: string; toolName: string; output: Output };
export type SystemModelMessage = Options & { role: "system"; content: string };
export type ToolModelMessage = Options & { role: "tool"; content: ToolResult[] };
export type ModelMessage = SystemModelMessage | ToolModelMessage
  | (Options & { role: "user"; content: string | (Text
      | { type: "image"; image: unknown } | { type: "file"; data: unknown; mediaType: string })[] })
  | (Options & { role: "assistant"; content: string | (Text | ToolCall
      | (Options & { type: "reasoning"; text: string })
      | { type: "file"; data: unknown; mediaType: string })[] });
