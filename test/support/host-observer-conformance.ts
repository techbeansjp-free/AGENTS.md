import ts from "typescript";

/**
 * host observer（Issue #1566、HOOK-001）のsourceを構文木で検査し、advisory・statelessの
 * 禁止事項（OWN-04）への違反を返す。
 *
 * **字面grepにしない。** 別名import・namespace経由のmember・computed key・動的key付与は
 * 文字列一致では素通しになる。TypeScript compiler APIでJavaScriptとしてparseし、
 * 参照位置と構文種別で判定する。**許可list方式である。** 列挙したもの以外は違反とし、
 * 新しいAPIを使うには本fileの許可listを根拠付きで広げる変更が要る。
 *
 * 違反は`観点: 詳細`の文字列で返す。観点は`syntax`・`import`・`module-member`・
 * `forbidden-global`・`output-key`・`dynamic-key`・`control-key`・`state-symbol`・
 * `hook-event`・`foreign-reference`の10種である。
 */

/**
 * 使ってよいNode標準moduleと、そのbindingから参照してよいmember。
 *
 * observerの実使用から決めた。`node:fs`は読取系だけである（`constants`は`O_RDONLY`・
 * `O_NONBLOCK`のopen flag）。`node:path`へ`resolve`を含めないのは、相対pathを
 * cwd基準で解決し他worktreeを参照する経路になるためである。`node:process`は
 * stdin・stdout・`exitCode`・`on`（未捕捉例外の`{}`化）だけであり、`cwd`・`env`・
 * `exit`・`binding`・`dlopen`・`chdir`・`nextTick`等は許可list外である。
 */
const MODULE_MEMBERS: Readonly<Record<string, readonly string[]>> = {
  "node:fs": [
    "closeSync",
    "constants",
    "fstatSync",
    "lstatSync",
    "openSync",
    "readSync",
  ],
  "node:path": ["dirname", "isAbsolute", "join"],
  "node:process": ["exitCode", "on", "stdin", "stdout"],
};

/**
 * importしなくても参照できるglobalのうち、member参照だけを許すものと許すmember。
 *
 * `process`はimportを消してglobalとして使っても同じ制約を受ける。`Object`から
 * `assign`・`defineProperty`・`fromEntries`等の動的key付与を除く。
 */
const GLOBAL_MEMBERS: Readonly<Record<string, readonly string[]>> = {
  Array: ["isArray"],
  Buffer: ["alloc", "concat"],
  JSON: ["parse", "stringify"],
  Object: ["freeze", "keys"],
  process: MODULE_MEMBERS["node:process"]!,
};

/** 参照そのものを禁じる識別子（module loader・動的評価・timer・待機・時計・global object）。 */
const FORBIDDEN_GLOBALS = new Set([
  "Atomics",
  "Date",
  "Function",
  "Reflect",
  "SharedArrayBuffer",
  "WebAssembly",
  "Worker",
  "eval",
  "exports",
  "fetch",
  "global",
  "globalThis",
  "module",
  "performance",
  "queueMicrotask",
  "require",
  "setImmediate",
  "setInterval",
  "setTimeout",
]);

/** object literalに書いてよいkey。出力（警告）と内部の判定結果・仕事量budgetの実使用である。 */
const OBJECT_KEYS = new Set([
  "additionalContext",
  "agentId",
  "candidates",
  "fresh",
  "hookEventName",
  "hookSpecificOutput",
  "kind",
  "nodes",
  "reuseForbidden",
  "steps",
  "systemMessage",
  "terminal",
  "workUnitId",
]);

/** 代入・増減してよいproperty。仕事量budgetの3欄、`process.exitCode`、配列の`length`だけである。 */
const ASSIGNABLE_MEMBERS = new Set([
  "candidates",
  "exitCode",
  "length",
  "nodes",
  "steps",
]);

/** hostへtoolの許可・拒否・保留・入力書換えを伝えるkey。識別子・文字列のどこにも現れてはならない。 */
const CONTROL_KEYS = new Set(
  [
    "behavior",
    "continue",
    "decision",
    "permissionDecision",
    "permissionDecisionReason",
    "reason",
    "stopReason",
    "suppressOutput",
    "updatedInput",
  ].map((key) => key.toLowerCase()),
);

/** 状態・予約・排他・生存管理を表す語。識別子を小文字化し`_`・`-`・`$`を除いた形へ含まれてはならない。 */
const STATE_WORDS = [
  "alive",
  "cleanup",
  "expire",
  "heartbeat",
  "inflight",
  "lease",
  "liveness",
  "lock",
  "mutex",
  "owner",
  "pendingdispatch",
  "registry",
  "reserv",
  "semaphore",
  "stale",
  "ttl",
];

/**
 * 状態語を含むが状態管理ではない識別子（誤検知の明示的除外）。
 *
 * - `block`: transcriptの`message.content`配列の要素（content block）。`lock`を含む。
 * - `nonblocking`・`O_NONBLOCK`: FIFOへ差し替えられた末端をopenで待たないためのopen flag。
 *   排他制御ではない。
 */
const STATE_WORD_EXCEPTIONS = new Set(["block", "nonblocking", "O_NONBLOCK"]);

/** `PreToolUse`以外のClaude Code hook event名。observerは分岐条件にも文字列にも持たない。 */
const OTHER_EVENTS = [
  "Notification",
  "PermissionDenied",
  "PermissionRequest",
  "PostCompact",
  "PostToolUse",
  "PreCompact",
  "SessionEnd",
  "SessionStart",
  "Stop",
  "SubagentStart",
  "SubagentStop",
  "UserPromptSubmit",
];

/** 他session・他worktree・固定temp path・shellを指す文字列。 */
const FOREIGN_TEXTS = [
  ".agent-skill-chain",
  ".worktrees",
  "/bin/sh",
  "/tmp",
  "CLAUDE_PROJECT_DIR",
  "cmd.exe",
  "powershell",
];

function normalized(name: string): string {
  return name.toLowerCase().replace(/[_$-]/gu, "");
}

/** 識別子が値の参照として現れているか（property名・宣言名・import指定子ではないか）。 */
function isReference(node: ts.Identifier): boolean {
  const parent = node.parent;
  if (ts.isPropertyAccessExpression(parent) && parent.name === node)
    return false;
  if (
    (ts.isPropertyAssignment(parent) ||
      ts.isMethodDeclaration(parent) ||
      ts.isGetAccessorDeclaration(parent) ||
      ts.isSetAccessorDeclaration(parent) ||
      ts.isPropertyDeclaration(parent)) &&
    parent.name === node
  )
    return false;
  if (
    ts.isImportClause(parent) ||
    ts.isNamespaceImport(parent) ||
    ts.isImportSpecifier(parent)
  )
    return false;
  return true;
}

function literalText(node: ts.Node): string | undefined {
  if (
    ts.isStringLiteral(node) ||
    ts.isNoSubstitutionTemplateLiteral(node) ||
    ts.isTemplateHead(node) ||
    ts.isTemplateMiddle(node) ||
    ts.isTemplateTail(node)
  )
    return node.text;
  return undefined;
}

function propertyKey(name: ts.PropertyName): string | undefined {
  if (
    ts.isIdentifier(name) ||
    ts.isStringLiteral(name) ||
    ts.isNumericLiteral(name) ||
    ts.isPrivateIdentifier(name)
  )
    return name.text;
  return undefined;
}

function isAssignmentTarget(node: ts.Expression): boolean {
  const parent = node.parent;
  if (
    ts.isBinaryExpression(parent) &&
    parent.left === node &&
    parent.operatorToken.kind >= ts.SyntaxKind.FirstAssignment &&
    parent.operatorToken.kind <= ts.SyntaxKind.LastAssignment
  )
    return true;
  if (
    (ts.isPrefixUnaryExpression(parent) ||
      ts.isPostfixUnaryExpression(parent)) &&
    (parent.operator === ts.SyntaxKind.PlusPlusToken ||
      parent.operator === ts.SyntaxKind.MinusMinusToken)
  )
    return true;
  return ts.isDeleteExpression(parent);
}

/** observer sourceの禁止事項違反を返す。空配列なら合格である。 */
export function inspectHostObserverSource(source: string): string[] {
  const violations: string[] = [];
  const file = ts.createSourceFile(
    "asc-host-observer.mjs",
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.JS,
  );
  const diagnostics = (
    file as unknown as { parseDiagnostics?: readonly ts.Diagnostic[] }
  ).parseDiagnostics;
  if (diagnostics === undefined || diagnostics.length > 0)
    violations.push("syntax: 構文解析に失敗した");
  /** local名 → 許可member。import由来とglobal由来を合わせる。 */
  const bindings = new Map<string, readonly string[]>(
    Object.entries(GLOBAL_MEMBERS),
  );

  for (const statement of file.statements) {
    if (ts.isImportEqualsDeclaration(statement))
      violations.push(`import: ${statement.name.text} = require`);
    if (
      ts.isExportDeclaration(statement) &&
      statement.moduleSpecifier !== undefined
    )
      violations.push(
        `import: export from ${statement.moduleSpecifier.getText()}`,
      );
    if (!ts.isImportDeclaration(statement)) continue;
    const specifier = ts.isStringLiteral(statement.moduleSpecifier)
      ? statement.moduleSpecifier.text
      : statement.moduleSpecifier.getText();
    const members = MODULE_MEMBERS[specifier];
    if (members === undefined) {
      violations.push(`import: ${specifier}`);
      continue;
    }
    const clause = statement.importClause;
    if (clause === undefined) continue;
    if (clause.name) bindings.set(clause.name.text, members);
    const named = clause.namedBindings;
    if (named && ts.isNamespaceImport(named))
      bindings.set(named.name.text, members);
    if (named && ts.isNamedImports(named))
      for (const element of named.elements) {
        const imported = (element.propertyName ?? element.name).text;
        if (!members.includes(imported))
          violations.push(`module-member: ${specifier} ${imported}`);
      }
  }

  const visit = (node: ts.Node): void => {
    if (
      ts.isCallExpression(node) &&
      node.expression.kind === ts.SyntaxKind.ImportKeyword
    )
      violations.push("import: dynamic import()");
    if (ts.isMetaProperty(node))
      violations.push(`forbidden-global: ${node.getText()}`);

    if (ts.isIdentifier(node)) {
      const name = node.text;
      const lower = normalized(name);
      if (isReference(node) && FORBIDDEN_GLOBALS.has(name))
        violations.push(`forbidden-global: ${name}`);
      const members = bindings.get(name);
      if (isReference(node) && members !== undefined) {
        const parent = node.parent;
        if (
          !ts.isPropertyAccessExpression(parent) ||
          parent.expression !== node ||
          !members.includes(parent.name.text)
        )
          violations.push(
            `module-member: ${ts.isPropertyAccessExpression(parent) && parent.expression === node ? `${name}.${parent.name.text}` : `${name}を値として参照`}`,
          );
      }
      if (CONTROL_KEYS.has(name.toLowerCase()))
        violations.push(`control-key: ${name}`);
      if (
        !STATE_WORD_EXCEPTIONS.has(name) &&
        STATE_WORDS.some((word) => lower.includes(word))
      )
        violations.push(`state-symbol: ${name}`);
      if (lower.includes("cwd") || /(?:^|[^a-z])git(?:[^a-z]|$)/iu.test(name))
        violations.push(`foreign-reference: ${name}`);
    }

    const text = literalText(node);
    if (text !== undefined) {
      if (CONTROL_KEYS.has(text.toLowerCase()))
        violations.push(`control-key: "${text}"`);
      for (const event of OTHER_EVENTS)
        if (
          new RegExp(`(?:^|[^A-Za-z])${event}(?:[^A-Za-z]|$)`, "u").test(text)
        )
          violations.push(`hook-event: ${event}`);
      for (const foreign of FOREIGN_TEXTS)
        if (text.includes(foreign))
          violations.push(`foreign-reference: "${foreign}"`);
      if (/(?:^|[^a-z])git(?:[^a-z]|$)/iu.test(text))
        violations.push(`foreign-reference: "${text}"`);
    }

    if (ts.isObjectLiteralExpression(node))
      for (const property of node.properties) {
        if (ts.isSpreadAssignment(property)) {
          violations.push("dynamic-key: object spread");
          continue;
        }
        if (ts.isComputedPropertyName(property.name)) {
          violations.push(
            `dynamic-key: [${property.name.expression.getText()}]`,
          );
          continue;
        }
        const key = propertyKey(property.name);
        if (key === undefined || !OBJECT_KEYS.has(key))
          violations.push(`output-key: ${key ?? property.name.getText()}`);
      }

    if (ts.isElementAccessExpression(node) && isAssignmentTarget(node))
      violations.push(`dynamic-key: ${node.getText()}への代入`);
    if (
      ts.isPropertyAccessExpression(node) &&
      isAssignmentTarget(node) &&
      !ASSIGNABLE_MEMBERS.has(node.name.text)
    )
      violations.push(`dynamic-key: ${node.getText()}への代入`);

    ts.forEachChild(node, visit);
  };
  visit(file);
  return [...new Set(violations)];
}
