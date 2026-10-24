// SPDX-FileCopyrightText: 2026 Soft Axiom contributors
// SPDX-License-Identifier: Apache-2.0
import * as fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import assert from "node:assert/strict";
import ts from "typescript";

// Maintainer-only source regeneration. It neither installs nor executes upstream source.
const revision = "15ae101a0d854480cfb500a5e241055450da39da";
const root = fileURLToPath(new URL("../", import.meta.url));
const upstream = path.resolve(process.argv[2] ?? "");
assert(process.argv[2], "Usage: node scripts/import-upstream.ts <reviewed-upstream-checkout> [--write]");
assert.equal(execFileSync("git", ["-C", upstream, "rev-parse", "HEAD"], { encoding: "utf8" }).trim(), revision);
assert.equal(execFileSync("git", ["-C", upstream, "status", "--porcelain", "--untracked-files=all"], { encoding: "utf8" }).trim(), "", "Use a clean upstream checkout");
const base = "core/upstream/openclaw";
const destination = (source: string) => `${base}/${source.replace(/^packages\//, "")}`;
const digest = (text: string | Uint8Array) => createHash("sha256").update(text).digest("hex");
type PackageExports = { name: string; folder: string; exports: Record<string, string | { import?: string; default?: string; types?: string }> };
const packages = new Map<string, PackageExports>();
for (const name of fs.readdirSync(path.join(upstream, "packages"))) {
  const folder = path.join(upstream, "packages", name), manifest = path.join(folder, "package.json");
  if (fs.existsSync(manifest)) {
    const pkg = JSON.parse(fs.readFileSync(manifest, "utf8")) as PackageExports;
    packages.set(pkg.name, { ...pkg, folder });
  }
}
function resolve(from: string, specifier: string): string | undefined {
  let target: string;
  if (specifier.startsWith(".")) target = path.resolve(path.dirname(from), specifier.replace(/\.(?:m?js)$/, ".ts"));
  else if (specifier.startsWith("@openclaw/")) {
    const name = specifier.split("/").slice(0, 2).join("/"), pkg = packages.get(name);
    assert(pkg, `Missing upstream package: ${name}`);
    const value = pkg.exports[specifier === name ? "." : `.${specifier.slice(name.length)}`];
    const exported = typeof value === "string" ? value : value?.import ?? value?.default ?? value?.types;
    assert(exported, `Missing upstream export: ${specifier}`);
    target = path.resolve(pkg.folder, exported.replace("./dist/", "./src/").replace(/\.d\.(?:m?ts)$/, ".ts").replace(/\.(?:m?js)$/, ".ts"));
    if (specifier === "@openclaw/ai/diagnostics") target = path.join(pkg.folder, "src/utils/diagnostics.ts");
  } else return;
  assert(target.startsWith(path.join(upstream, "packages") + path.sep), "Upstream import escaped its source boundary");
  assert(fs.existsSync(target), `Missing upstream source: ${target}`);
  return target;
}
function focusedImports(source: string, text: string) {
  if (source === "packages/agent-core/src/agent-stream-response.ts")
    text = text.replace(/import \{[\s\S]*?createEmptyTransportUsage,[\s\S]*?replaceCompactionReplayOwnerContent,[\s\S]*?\} from "@openclaw\/ai\/transports";/,
      'import { isResponsesOutputLimitToolCallError } from "../../ai/src/providers/openai-responses-terminal-usage.js";\nimport { createEmptyTransportUsage } from "../../ai/src/transports/transport-stream-shared.js";\nimport { replaceCompactionReplayOwnerContent } from "../../ai/src/transports/provider-compaction-replay.js";');
  if (source.endsWith("/harness/compaction/summarization-completion.ts"))
    text = text.replace('"@openclaw/ai/transports"', '"../../../../ai/src/transports/anthropic-transport-options.js"')
      .replace('"@openclaw/ai/internal/runtime"', '"../../../../ai/src/utils/overflow.js"');
  return text;
}
const pending = ["agent-core/src/agent.ts", "agent-core/src/harness/session/session.ts", "agent-core/src/harness/compaction/compaction.ts",
  "ai/src/providers/openai-completions.ts", "ai/src/providers/openai-responses.ts", "ai/src/providers/anthropic.ts", "ai/src/host.ts"]
  .map(source => path.join(upstream, "packages", source));
const files = new Map<string, { source: string; original: string; text: string; imports: Map<string, string> }>();
while (pending.length) {
  const file = pending.pop()!;
  if (files.has(file)) continue;
  const source = path.relative(upstream, file), original = fs.readFileSync(file, "utf8"), text = focusedImports(source, original);
  const tree = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true), imports = new Map<string, string>();
  function include(specifier: string) {
    const target = resolve(file, specifier);
    if (target) { imports.set(specifier, target); pending.push(target); }
  }
  function visit(node: ts.Node) {
    if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) include(node.moduleSpecifier.text);
    if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
      assert(node.arguments[0] && ts.isStringLiteral(node.arguments[0]), "Review nonliteral upstream module loading");
      include(node.arguments[0].text);
    }
    if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument) && ts.isStringLiteral(node.argument.literal)) include(node.argument.literal.text);
    ts.forEachChild(node, visit);
  }
  visit(tree); files.set(file, { source, original, text, imports });
}
assert.equal(files.size, 229, "Upstream closure changes require review");
if (!process.argv.includes("--write")) {
  console.log(JSON.stringify({ revision, modules: files.size, writes: false }));
} else {
  fs.rmSync(path.join(root, base), { recursive: true, force: true });
  const manifest = [];
  for (const file of [...files.values()].sort((a, b) => a.source.localeCompare(b.source))) {
    let text = file.text;
    for (const [specifier, target] of file.imports) {
      let relative = path.relative(path.dirname(destination(file.source)), destination(path.relative(upstream, target))).replace(/\.ts$/, ".js");
      if (!relative.startsWith(".")) relative = `./${relative}`;
      text = text.split(`"${specifier}"`).join(`"${relative}"`).split(`'${specifier}'`).join(`"${relative}"`);
    }
    if (file.source === "packages/ai/src/env-api-keys.ts")
      text = "export function findEnvKeys(_provider: string): string[] | undefined { return undefined; }\nexport function getEnvApiKey(_provider: string): string | undefined { return undefined; }\n";
    if (text.includes("ReadableStreamReadResult")) text = 'import type { ReadableStreamReadResult } from "node:stream/web";\n' + text;
    const tree = ts.createSourceFile(file.source, text, ts.ScriptTarget.Latest, true);
    const transformed = ts.transform(tree, [context => node => {
      function visit(current: ts.Node): ts.VisitResult<ts.Node> {
        if (ts.isPropertyAccessExpression(current) && current.expression.getText(tree) === "process" && current.name.text === "env")
          return context.factory.createAsExpression(context.factory.createObjectLiteralExpression(), context.factory.createTypeReferenceNode("NodeJS.ProcessEnv"));
        if (ts.isNewExpression(current) && ts.isIdentifier(current.expression) && ["OpenAI", "Anthropic"].includes(current.expression.text)) {
          const fields = current.expression.text === "OpenAI"
            ? ["adminAPIKey", "organization", "project", "webhookSecret"] : ["webhookKey"];
          const properties: ts.ObjectLiteralElementLike[] = [context.factory.createSpreadAssignment(current.arguments?.[0] ?? context.factory.createObjectLiteralExpression()),
            ...fields.map(name => context.factory.createPropertyAssignment(name, context.factory.createNull())),
            context.factory.createPropertyAssignment("logLevel", context.factory.createStringLiteral("off"))];
          return context.factory.updateNewExpression(current, current.expression, current.typeArguments, [context.factory.createObjectLiteralExpression(properties, true)]);
        }
        return ts.visitEachChild(current, visit, context);
      }
      return ts.visitNode(node, visit) as ts.SourceFile;
    }]);
    text = "// SPDX-FileCopyrightText: 2026 OpenClaw Foundation; 2026 Soft Axiom contributors\n// SPDX-License-Identifier: MIT\n" + ts.createPrinter().printFile(transformed.transformed[0]!);
    transformed.dispose();
    const target = destination(file.source);
    fs.mkdirSync(path.dirname(path.join(root, target)), { recursive: true }); fs.writeFileSync(path.join(root, target), text);
    manifest.push({ source: file.source, path: target, upstreamSha256: digest(file.original), sha256: digest(text) });
  }
  const manifestPath = path.join(root, "docs/OPENCLAW_PROVENANCE.json");
  const previous = JSON.parse(fs.readFileSync(manifestPath, "utf8")) as Record<string, unknown>;
  fs.writeFileSync(manifestPath, JSON.stringify({ ...previous, revision, files: manifest }, null, 2) + "\n");
  console.log(JSON.stringify({ revision, modules: files.size, writes: true }));
}
