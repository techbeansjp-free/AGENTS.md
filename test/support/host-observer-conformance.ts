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
 * `hook-event`・`foreign-reference`・`open-flag`・`exit-code`・`reflective-member`の
 * 13種である。
 */

/**
 * 使ってよいNode標準moduleと、そのbindingから参照してよいmember。
 *
 * observerの実使用から決めた。`node:fs`は読取系だけである。`openSync`と`constants`は
 * 書込にも使えるため、member名の許可に加えて使い方を`inspectOpenFlag`等で限る
 * （`constants`は`O_RDONLY`・`O_NONBLOCK`の参照だけ、`openSync`は読取専用flagの
 * 2引数呼出しだけ）。`node:path`へ`resolve`を含めないのは、相対pathを
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

/**
 * 代入・増減してよいproperty。仕事量budgetの3欄、`process.exitCode`、配列の`length`だけである。
 * `process.exitCode`は更に`= 0`の形だけに限る（`exit-code`）。
 */
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

/** `fs.constants`から参照してよいmember。読取専用openのflagだけである。 */
const FS_CONSTANTS = new Set(["O_NONBLOCK", "O_RDONLY"]);

/**
 * named importでは取り込めないmember。`constants`・`openSync`・`exitCode`は使い方を
 * `fs.`・`process.`経由の構文で検査するため、裸の識別子として取り込むと検査を迂回する。
 */
const NAMED_IMPORT_FORBIDDEN = new Set(["constants", "exitCode", "openSync"]);

/**
 * どの深さでも参照してはならないproperty名。許可したmemberからでも`.constructor`連鎖で
 * `Function`へ、`call`・`apply`・`bind`で`this`の差し替えへ到達できるためである。
 */
const REFLECTIVE_MEMBERS = new Set([
  "__proto__",
  "apply",
  "bind",
  "call",
  "constructor",
  "prototype",
]);

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

/**
 * 文字列の内部にJSON key形（`"<key>"`）またはobject key形（`<key>:`）で現れる制御keyを返す。
 * 大文字小文字を区別しない（template分割の後半piece`Decision":`も捕える）。
 */
function controlKeysInText(text: string): string[] {
  const found: string[] = [];
  for (const key of CONTROL_KEYS) {
    const quoted = new RegExp(`"${key}"`, "iu");
    const colon = new RegExp(`(?:^|[^A-Za-z0-9_$])${key}"?\\s*:`, "iu");
    if (quoted.test(text) || colon.test(text)) found.push(key);
  }
  return found;
}

/**
 * 文字列literal・template・`+`連結を、非literalの部分を区切り文字に置き換えて連結した
 * 字面を返す。literal片へ分割した制御keyを連結後の字面で捕えるためである。
 */
function staticText(node: ts.Expression): string {
  if (ts.isParenthesizedExpression(node)) return staticText(node.expression);
  const text = literalText(node);
  if (text !== undefined) return text;
  if (ts.isTemplateExpression(node))
    return (
      node.head.text +
      node.templateSpans
        .map((span) => staticText(span.expression) + span.literal.text)
        .join("")
    );
  if (
    ts.isBinaryExpression(node) &&
    node.operatorToken.kind === ts.SyntaxKind.PlusToken
  )
    return staticText(node.left) + staticText(node.right);
  return "\u0000";
}

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

/** `fs.constants.<member>`の形か。`fsNames`はnode:fsのdefault・namespace bindingである。 */
function isFsConstant(
  node: ts.Expression,
  fsNames: ReadonlySet<string>,
  member: string,
): boolean {
  return (
    ts.isPropertyAccessExpression(node) &&
    node.name.text === member &&
    ts.isPropertyAccessExpression(node.expression) &&
    node.expression.name.text === "constants" &&
    ts.isIdentifier(node.expression.expression) &&
    fsNames.has(node.expression.expression.text)
  );
}

/**
 * `O_RDONLY`へ加えてよいflag式か。`fs.constants.O_NONBLOCK`、数値`0`、両枝がそれである
 * 条件式、初期値がそれである`const`（file内で同名宣言が1つだけ）に限る。observerは
 * `O_NONBLOCK`が無いOSで`0`へ倒す`const nonblocking`を`O_RDONLY | nonblocking`で使う。
 */
function isNonblockFlag(
  node: ts.Expression,
  fsNames: ReadonlySet<string>,
  constants: ReadonlyMap<string, ts.Expression | null>,
  depth = 0,
): boolean {
  if (depth > 8) return false;
  if (ts.isParenthesizedExpression(node))
    return isNonblockFlag(node.expression, fsNames, constants, depth + 1);
  if (isFsConstant(node, fsNames, "O_NONBLOCK")) return true;
  if (ts.isNumericLiteral(node)) return node.text === "0";
  if (ts.isConditionalExpression(node))
    return (
      isNonblockFlag(node.whenTrue, fsNames, constants, depth + 1) &&
      isNonblockFlag(node.whenFalse, fsNames, constants, depth + 1)
    );
  if (ts.isIdentifier(node)) {
    const initializer = constants.get(node.text);
    return (
      initializer !== undefined &&
      initializer !== null &&
      isNonblockFlag(initializer, fsNames, constants, depth + 1)
    );
  }
  return false;
}

/**
 * `fs.openSync`の呼出しを検査する。flag（第2引数）は`fs.constants.O_RDONLY`単独か
 * `fs.constants.O_RDONLY | <isNonblockFlag>`だけを許す。文字列flagは書込・作成・追記の
 * 字面（`"w"`・`"wx"`・`"a+"`等）を許可listで判別する利点が無いため一律に不可とし、
 * 省略（既定`"r"`）も不可とする（observerは明示しており、明示を要求すれば形の検査だけで済む）。
 * mode（第3引数）は作成時にしか意味が無いため不可とする。
 */
function inspectOpenFlag(
  call: ts.CallExpression,
  fsNames: ReadonlySet<string>,
  constants: ReadonlyMap<string, ts.Expression | null>,
): string | undefined {
  if (call.arguments.length !== 2)
    return `open-flag: openSyncの引数が${call.arguments.length}個（pathとflagの2個だけを許す）`;
  const flag = call.arguments[1]!;
  if (isFsConstant(flag, fsNames, "O_RDONLY")) return undefined;
  if (
    ts.isBinaryExpression(flag) &&
    flag.operatorToken.kind === ts.SyntaxKind.BarToken &&
    isFsConstant(flag.left, fsNames, "O_RDONLY") &&
    isNonblockFlag(flag.right, fsNames, constants)
  )
    return undefined;
  return `open-flag: ${flag.getText()}`;
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
  /** node:fsのdefault・namespace binding名。 */
  const fsNames = new Set<string>();
  /** `process`（globalとnode:processのbinding）の名前。 */
  const processNames = new Set<string>(["process"]);

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
    const named = clause.namedBindings;
    const locals = [
      clause.name,
      named && ts.isNamespaceImport(named) ? named.name : undefined,
    ];
    for (const local of locals) {
      if (local === undefined) continue;
      bindings.set(local.text, members);
      if (specifier === "node:fs") fsNames.add(local.text);
      if (specifier === "node:process") processNames.add(local.text);
    }
    if (named && ts.isNamedImports(named))
      for (const element of named.elements) {
        const imported = (element.propertyName ?? element.name).text;
        if (!members.includes(imported) || NAMED_IMPORT_FORBIDDEN.has(imported))
          violations.push(`module-member: ${specifier} ${imported}`);
      }
  }

  /** `const`宣言の名前 → 初期値。同名宣言が複数あれば`null`（解決しない）。 */
  const constants = new Map<string, ts.Expression | null>();
  const collect = (node: ts.Node): void => {
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      ts.isVariableDeclarationList(node.parent) &&
      (node.parent.flags & ts.NodeFlags.Const) !== 0 &&
      node.initializer !== undefined
    )
      constants.set(
        node.name.text,
        constants.has(node.name.text) ? null : node.initializer,
      );
    else if (
      (ts.isVariableDeclaration(node) ||
        ts.isBindingElement(node) ||
        ts.isParameter(node) ||
        ts.isFunctionDeclaration(node)) &&
      node.name !== undefined &&
      ts.isIdentifier(node.name)
    )
      constants.set(node.name.text, null);
    ts.forEachChild(node, collect);
  };
  collect(file);

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
      if (REFLECTIVE_MEMBERS.has(name))
        violations.push(`reflective-member: ${name}`);
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
      for (const key of controlKeysInText(text))
        violations.push(`control-key: 文字列内の${key}`);
      if (
        REFLECTIVE_MEMBERS.has(text) &&
        ((ts.isElementAccessExpression(node.parent) &&
          node.parent.argumentExpression === node) ||
          ts.isBindingElement(node.parent))
      )
        violations.push(`reflective-member: ${text}`);
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

    // literal片へ分割した制御keyを、連結後の字面で捕える（template・`+`連鎖の最上位）。
    if (
      (ts.isTemplateExpression(node) ||
        (ts.isBinaryExpression(node) &&
          node.operatorToken.kind === ts.SyntaxKind.PlusToken &&
          !(
            ts.isBinaryExpression(node.parent) &&
            node.parent.operatorToken.kind === ts.SyntaxKind.PlusToken
          ))) &&
      !ts.isTemplateSpan(node.parent)
    )
      for (const key of controlKeysInText(staticText(node)))
        violations.push(`control-key: 文字列内の${key}`);

    // `fs.constants`は`O_RDONLY`・`O_NONBLOCK`の参照だけを許す（別変数への束縛・分割代入も不可）。
    if (
      ts.isPropertyAccessExpression(node) &&
      node.name.text === "constants" &&
      ts.isIdentifier(node.expression) &&
      fsNames.has(node.expression.text)
    ) {
      const parent = node.parent;
      if (
        !ts.isPropertyAccessExpression(parent) ||
        parent.expression !== node ||
        !FS_CONSTANTS.has(parent.name.text)
      )
        violations.push(
          `open-flag: ${ts.isPropertyAccessExpression(parent) && parent.expression === node ? parent.getText() : `${node.getText()}を値として参照`}`,
        );
    }
    // `fs.openSync`は呼出しの形でだけ参照でき、flagとmodeを検査する。
    if (
      ts.isPropertyAccessExpression(node) &&
      node.name.text === "openSync" &&
      ts.isIdentifier(node.expression) &&
      fsNames.has(node.expression.text)
    ) {
      const parent = node.parent;
      const finding =
        ts.isCallExpression(parent) && parent.expression === node
          ? inspectOpenFlag(parent, fsNames, constants)
          : `open-flag: ${node.getText()}を値として参照`;
      if (finding !== undefined) violations.push(finding);
    }
    // `process.exitCode`は`= 0`の代入の左辺としてだけ現れてよい。
    if (
      ts.isPropertyAccessExpression(node) &&
      node.name.text === "exitCode" &&
      ts.isIdentifier(node.expression) &&
      processNames.has(node.expression.text)
    ) {
      const parent = node.parent;
      if (
        !ts.isBinaryExpression(parent) ||
        parent.left !== node ||
        parent.operatorToken.kind !== ts.SyntaxKind.EqualsToken ||
        !ts.isNumericLiteral(parent.right) ||
        parent.right.text !== "0"
      )
        violations.push(
          `exit-code: ${ts.isBinaryExpression(parent) && parent.left === node ? parent.getText() : node.getText()}`,
        );
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
