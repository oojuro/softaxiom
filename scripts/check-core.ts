// SPDX-FileCopyrightText: 2026 Soft Axiom contributors
// SPDX-License-Identifier: Apache-2.0
import { readdirSync, readFileSync, lstatSync } from "node:fs";
import { resolve, relative, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
import ts from "typescript";

const root = fileURLToPath(new URL("../", import.meta.url));
export function coreProblems(files: { path: string; text: string }[], dependencies: string[]) {
  const problems: string[] = [];
  for (const { path, text } of files) {
    if (!path.endsWith(".ts") || path.endsWith(".test.ts") || path.includes("/fixtures/")) continue;
    const source = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true);
    const builtins = new Set([
      "node:fs",
      "node:path",
      "node:url",
      "node:crypto",
      "node:async_hooks",
      "node:buffer", "node:os", "node:util", "node:stream/web",
    ]);
    const forbidden =
      /^(?:@sa\/|@aws-sdk\/|@temporalio\/|@supabase\/|@onkernel\/|@e2b\/|e2b$|stripe$|ai$|@ai-sdk\/|posthog-node$|@sentry\/)/;
    function checkImport(specifier: string) {
      if (specifier.startsWith(".")) {
        const target = resolve(root, dirname(path), specifier);
        if (!target.startsWith(resolve(root, "core") + "/"))
          problems.push(`${path}: core import leaves its boundary`);
      } else {
        const name = specifier
          .split("/")
          .slice(0, specifier.startsWith("@") ? 2 : 1)
          .join("/");
        if (forbidden.test(specifier) || !(builtins.has(specifier) || dependencies.includes(name)))
          problems.push(`${path}: undeclared or hosted import ${name}`);
      }
    }
    function visit(node: ts.Node) {
      if (
        (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
        node.moduleSpecifier &&
        ts.isStringLiteral(node.moduleSpecifier)
      ) {
        checkImport(node.moduleSpecifier.text);

      }
      if (
        ts.isCallExpression(node) &&
        (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
          node.expression.getText(source) === "require")
      ) {
        if (
          node.arguments.length !== 1 ||
          !node.arguments[0] ||
          !ts.isStringLiteral(node.arguments[0])
        )
          problems.push(`${path}: nonliteral module loading`);
        else {
          checkImport(node.arguments[0].text);
        }
      }
      if (
        (ts.isPropertyAccessExpression(node) &&
          node.expression.getText(source) === "process" &&
          node.name.text === "env") ||
        (ts.isElementAccessExpression(node) &&
          node.expression.getText(source) === "process" &&
          node.argumentExpression &&
          ts.isStringLiteral(node.argumentExpression) &&
          node.argumentExpression.text === "env")
      )
        problems.push(`${path}: ambient credentials`);
      if (
        (ts.isCallExpression(node) || ts.isNewExpression(node)) &&
        ["eval", "Function"].includes(node.expression.getText(source))
      )
        problems.push(`${path}: dynamic code execution`);
      ts.forEachChild(node, visit);
    }
    visit(source);
  }
  return problems;
}
export function sourceFiles(folder: string): { path: string; text: string }[] {
  return readdirSync(folder).flatMap((name) => {
    const file = resolve(folder, name),
      stat = lstatSync(file);
    assert(!stat.isSymbolicLink(), "Source tree must not contain symlinks");
    return stat.isDirectory()
      ? sourceFiles(file)
      : [{ path: relative(root, file), text: readFileSync(file, "utf8") }];
  });
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const pkg = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8"));
  const problems = coreProblems(sourceFiles(resolve(root, "core")), Object.keys(pkg.dependencies));
  assert.deepEqual(problems, [], problems.join("\n"));
  console.log("Shared core has no private, hosted, ambient-credential or escaped imports.");
}
