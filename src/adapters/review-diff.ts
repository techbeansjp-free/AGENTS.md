import crypto from "node:crypto";

import { git } from "../lib/process.js";
import { isEvidenceOnlyPath } from "../domain/review.js";

export const GIT_ENV = {
  PATH: process.env.PATH ?? "/usr/bin:/bin",
  LANG: "C",
  LC_ALL: "C",
  GIT_CONFIG_GLOBAL: "/dev/null",
  GIT_CONFIG_NOSYSTEM: "1",
  GIT_NO_REPLACE_OBJECTS: "1",
  GIT_OPTIONAL_LOCKS: "0",
} as const;

export function observeReviewDiff(
  root: string,
  baseSha: string,
  headSha: string,
): { digest: string; changedPaths: readonly string[] } {
  for (const [label, oid] of [
    ["base", baseSha],
    ["head", headSha],
  ] as const) {
    const observed = git(["rev-parse", "--verify", `${oid}^{commit}`], root, {
      env: GIT_ENV,
    }).stdout.trim();
    if (observed !== oid)
      throw new Error(`review diff ${label} SHAをexact commitへ解決できません`);
  }
  if (
    git(["merge-base", "--is-ancestor", baseSha, headSha], root, {
      env: GIT_ENV,
      allowFailure: true,
    }).status !== 0
  )
    throw new Error("review diff baseがcandidate HEADのancestorではありません");
  const source = git(
    [
      "diff",
      "--binary",
      "--full-index",
      "--no-ext-diff",
      "--no-textconv",
      "--no-renames",
      baseSha,
      headSha,
      "--",
    ],
    root,
    { env: GIT_ENV },
  ).stdout;
  const names = git(
    ["diff", "--name-only", "-z", "--no-renames", baseSha, headSha, "--"],
    root,
    { env: GIT_ENV },
  )
    .stdout.split("\0")
    .filter(Boolean)
    .sort();
  if (new Set(names).size !== names.length)
    throw new Error("review diff path観測に重複があります");
  return {
    digest: crypto.createHash("sha256").update(source).digest("hex"),
    changedPaths: Object.freeze(names),
  };
}

/**
 * 2つのcommitから実際の`merge-base`を一意に解決する（Issue #1495、
 * TERM-ASC-1495）。
 *
 * **audit baseを利用者入力・申告値から決めない。** `git merge-base --all`を
 * Git objectへ直接問い合わせ、結果が0件・複数件・非0終了のいずれかなら
 * fail-closedで拒否する（INV-03）。`pr merge`（`inspectAuthorizedPullRequestMerge`）と
 * review round 1作成時の`--base`検証（`buildReviewRoundDraft`）の両方が使う
 * 共通実装であり、どちらも同じfail-closed規約を共有する。
 */
export function resolveUniqueMergeBase(
  root: string,
  a: string,
  b: string,
): string {
  const result = git(["merge-base", "--all", a, b], root, {
    env: GIT_ENV,
    allowFailure: true,
  });
  const bases = result.stdout
    .trim()
    .split(/\r?\n/u)
    .filter((value) => /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/u.test(value));
  if (result.status !== 0 || bases.length !== 1)
    throw new Error(
      `実際のmerge-baseを一意に解決できません（exit ${result.status}、候補${bases.length}件、対象: ${a}, ${b}）`,
    );
  return bases[0]!;
}

/** exact commitが持つ唯一の親をworktreeへ触れずに観測する。 */
export function observeSingleCommitParent(
  root: string,
  headSha: string,
): string {
  const observed = git(["rev-parse", "--verify", `${headSha}^{commit}`], root, {
    env: GIT_ENV,
  }).stdout.trim();
  if (observed !== headSha)
    throw new Error("review suffix HEADをexact commitへ解決できません");
  const parents = git(["show", "-s", "--format=%P", headSha], root, {
    env: GIT_ENV,
  })
    .stdout.trim()
    .split(/\s+/u)
    .filter(Boolean);
  if (parents.length !== 1)
    throw new Error("review suffix HEADは単一親commitでなければなりません");
  return parents[0]!;
}

/**
 * commit時点のblobをtextとして読む。存在しなければ`undefined`。
 *
 * **作業treeを読まない。** 再固定の判定はGit objectだけを根拠にする（Issue #1172）。
 */
export function readBlobAtCommit(
  root: string,
  commit: string,
  filePath: string,
): string | undefined {
  const shown = git(["show", `${commit}:${filePath}`], root, {
    env: GIT_ENV,
    allowFailure: true,
  });
  return shown.status === 0 ? shown.stdout : undefined;
}

/**
 * evidence-only suffixとcanonical H_impl resolverが共有する遡り上限（Issue #1532）。
 * `evidenceOnlySuffix`は既知の境界（`fromSha`）へ到達できるかを検証し、
 * `resolveImplementationHead`は境界未知のまま同じ条件でどこまで遡れるかを探索する。
 * 上限は両者で同じ値でなければならない（二重規範を作らない）。
 */
const MAX_EVIDENCE_ONLY_SUFFIX_COMMITS = 8;

/**
 * `commit`とその唯一の親の間が、evidence-only allowlist配下のmode `100644`の
 * 通常file 1件を追加（元mode `000000`）または変更（元mode `100644`）するだけの
 * 1 stepかを判定する。該当すれば`{parent, path}`、非該当（親が複数・0個、raw diffが
 * 複数path・削除・rename・type変更・実行権限・allowlist外を含む）は`undefined`。
 *
 * `evidenceOnlySuffix`（既知の境界までの検証）と`resolveImplementationHead`
 * （境界未知の探索）はこの1 step判定だけを共有し、raw diff解析を重複させない。
 *
 * exportする。呼び出し元（`scripts/check_file_audit.ts`）が、遡りを固定する
 * pathを`resolveImplementationHead`へ渡す前に`head`自身の1 stepを覗くために使う
 * （Issue #1532 round 1指摘、HIGH-1）。
 */
export function evidenceOnlyStep(
  root: string,
  commit: string,
): { parent: string; path: string } | undefined {
  const parents = git(["rev-list", "--parents", "-n", "1", commit], root, {
    env: GIT_ENV,
    allowFailure: true,
  });
  const parts = parents.stdout.trim().split(/\s+/u);
  if (parents.status !== 0 || parts.length !== 2 || parts[0] !== commit)
    return undefined;
  const parent = parts[1]!;
  // 各commit単位でraw change type・mode・pathを検査する。net diffだけでは
  // 中間commitの削除・rename・製品変更を見逃す。
  const raw = git(
    ["diff", "--raw", "--no-renames", "--no-abbrev", "-z", parent, commit],
    root,
    { env: GIT_ENV, allowFailure: true },
  );
  if (raw.status !== 0) return undefined;
  const fields = raw.stdout.split("\0").filter((item) => item.length > 0);
  if (fields.length !== 2) return undefined;
  const [meta, only] = fields;
  const matched =
    /^:(?<srcMode>[0-7]{6}) (?<dstMode>[0-7]{6}) [0-9a-f]+ [0-9a-f]+ (?<status>[AM])$/u.exec(
      meta ?? "",
    );
  if (!matched?.groups || !only || !isEvidenceOnlyPath(only)) return undefined;
  const { srcMode, dstMode, status } = matched.groups;
  if (
    dstMode !== "100644" ||
    (status === "A" && srcMode !== "000000") ||
    (status === "M" && srcMode !== "100644")
  )
    return undefined;
  return { parent, path: only };
}

/**
 * **evidence-only suffix**: `fromSha`から`toSha`までの第1親chainの各commitが
 * 同じreview artifact 1 fileだけを追加・変更する場合にそのpathを返す。
 *
 * review artifactをcommitするとHEADが`H_impl`から`H_final`へ動く。reviewerが
 * 確認した内容とPR・mergeされる内容の一致という性質は、artifact 1 fileの追加では
 * 破れない。従来はこの移動にも「取り直しround」を要求し、製品差分の無いroundで
 * 収束後の別枠を毎Issue消費していた。**受理するのはこの形だけで、空差分・
 * 2 path以上・allowlist外・非ancestorはundefinedにし、呼び出し側が従来と同じ
 * 文言で拒否する。**
 */
export function evidenceOnlySuffix(
  root: string,
  fromSha: string,
  toSha: string,
): string | undefined {
  if (fromSha === toSha) return undefined;
  let cursor = toSha;
  let artifactPath: string | undefined;
  // 初回artifactと前進是正を有限個だけ受理する。途中の製品変更は通さない。
  for (
    let count = 0;
    count < MAX_EVIDENCE_ONLY_SUFFIX_COMMITS && cursor !== fromSha;
    count++
  ) {
    const step = evidenceOnlyStep(root, cursor);
    if (!step || (artifactPath !== undefined && artifactPath !== step.path))
      return undefined;
    artifactPath = step.path;
    cursor = step.parent;
  }
  return cursor === fromSha ? artifactPath : undefined;
}

/**
 * **canonical H_impl resolver**（Issue #1532）: `head`から第1親chainを遡り、
 * `artifactPath`だけを追加・変更するevidence-only trailing commit（mode `100644`・
 * A/M限定、最大`MAX_EVIDENCE_ONLY_SUFFIX_COMMITS`個）を除いた実装commitを返す。
 *
 * **`artifactPath`は呼び出し元が明示する必須引数である。** 遡る対象pathを
 * 「最初に見つかったevidence-only path」に暗黙で固定すると、`head`自身が
 * （このresolver呼び出しとは無関係な）別のreview記録を編集する正当な実装commit
 * だった場合に、そのcommit自身を誤ってevidence-only commitとして遡り越してしまう
 * （Issue #1532 round 1指摘、HIGH-1。実repository履歴のIssue #1165・#1254で
 * 実際に発生する形）。呼び出し元は「この呼び出しが関心を持つ証跡pathはこれである」
 * を明示し、それ以外のpathを変えるcommitは（allowlist配下であっても）1歩目から
 * 遡りの対象にしない。
 *
 * **H_implの定義はこの関数1箇所に置く。** `audit:check`
 * （`scripts/check_file_audit.ts`の`withoutTrailingAuditCommits`。`head`自身の
 * 1 stepを`evidenceOnlyStep`で覗いてそのpathを渡す）・`review export`
 * （`exportReviewEvidence`。自身が書き込むartifact pathを渡す）が、いずれも
 * この関数の戻り値を経由してH_implを決める。個別に実装を一致させる場当たり的な
 * 修正を行わない。
 *
 * `evidenceOnlySuffix`と同じ`evidenceOnlyStep`判定を使うが、`fromSha`という既知の
 * 境界を要求しない探索である点が異なる。trailing evidence-only commitが0個なら
 * `head`をそのまま返す（この関数は「境界の直前が必ずevidence commitである」と
 * 仮定しない）。上限に達した場合は、そこまで遡れた分だけを返し（全体を拒否しない）、
 * `artifactPath`と異なるpath・mode変更・削除・rename・merge commit・2 path以上に
 * 当たった時点で、それ以上遡らずその手前を返す。
 */
export function resolveImplementationHead(
  root: string,
  head: string,
  artifactPath: string,
): string {
  const resolved = git(["rev-parse", "--verify", `${head}^{commit}`], root, {
    env: GIT_ENV,
    allowFailure: true,
  });
  if (resolved.status !== 0 || resolved.stdout.trim() !== head)
    throw new Error(
      `H_impl解決対象のheadをexact commitへ解決できません: ${head}`,
    );
  let cursor = head;
  for (let count = 0; count < MAX_EVIDENCE_ONLY_SUFFIX_COMMITS; count++) {
    const step = evidenceOnlyStep(root, cursor);
    if (!step || step.path !== artifactPath) break;
    cursor = step.parent;
  }
  return cursor;
}
