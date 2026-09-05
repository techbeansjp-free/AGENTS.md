import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { run } from "../lib/process.js";
import { isRecord } from "../types.js";
/**
 * merge方式をgh CLIのflagへ写す。
 *
 * **未知値は例外にする。既定値を持たせない。** 以前は`merge`と`rebase`以外を
 * すべて`--squash`へ倒しており、値を解決できなかった場合に取り込み先branch上の
 * commitの親が1個になって`audit:check`の2区間導出が壊れる事象が、診断なしで
 * 起きていた。
 *
 * **squashの受理可否はここで決めない。** 方式の許可は`resolveMergeMethod`が
 * project policyの`merge.methods`と長命branchペア判定で決める。adapterが
 * 宣言済みの方式を上書きすると、policyで許可した構成が実行段で不能になる。
 */
function mergeMethodFlag(method) {
    if (method === "merge")
        return "--merge";
    if (method === "rebase")
        return "--rebase";
    if (method === "squash")
        return "--squash";
    throw new Error(`merge方式を解決できません: ${method}。merge、rebase、squashのいずれかを指定してください`);
}
function requireFullOid(value, label) {
    if (typeof value !== "string" || !/^[a-f0-9]{40}$/iu.test(value))
        throw new Error(`${label}は40桁の完全OIDでなければなりません`);
    return value;
}
function parseObject(source, label) {
    const parsed = JSON.parse(source);
    if (!isRecord(parsed))
        throw new Error(`${label}がobjectではありません`);
    return parsed;
}
export function canonicalProviderInstant(value, label) {
    if (typeof value !== "string")
        throw new Error(`${label}が不正です`);
    const parsed = Date.parse(value);
    if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/u.test(value) ||
        !Number.isFinite(parsed))
        throw new Error(`${label}が不正です`);
    return new Date(parsed).toISOString();
}
export class GitHubProviderUnavailableError extends Error {
    code = "ASC_GITHUB_PROVIDER_UNAVAILABLE";
    constructor(message) {
        super(message);
        this.name = "GitHubProviderUnavailableError";
    }
}
/** Compare the immutable policy-authority observation tuple. */
export function samePolicyAuthorityObservation(left, right) {
    const keys = [
        "repository",
        "prNumber",
        "defaultBranch",
        "defaultBranchTipOid",
        "baseRefName",
        "baseRefOid",
        "headRefOid",
    ];
    return keys.every((key) => left[key] === right[key]);
}
function observePolicyAuthority(repository, prNumber, cwd) {
    try {
        run("gh", ["auth", "status"], cwd);
    }
    catch {
        throw new GitHubProviderUnavailableError("GitHub providerの認証状態を観測できません");
    }
    let observedRepository;
    let observedPr;
    let defaultBranchTipOid;
    try {
        observedRepository = parseObject(run("gh", [
            "repo",
            "view",
            repository,
            "--json",
            "nameWithOwner,defaultBranchRef",
        ], cwd).stdout, "repository観測");
        observedPr = parseObject(run("gh", [
            "pr",
            "view",
            String(prNumber),
            "--repo",
            repository,
            "--json",
            "number,baseRefName,baseRefOid,headRefOid",
        ], cwd).stdout, "PR観測");
        const defaultBranch = observedRepository?.defaultBranchRef?.name;
        if (typeof defaultBranch !== "string")
            throw new Error("default branchが不明です");
        defaultBranchTipOid = run("gh", [
            "api",
            `repos/${repository}/commits/${encodeURIComponent(defaultBranch)}`,
            "--jq",
            ".sha",
        ], cwd).stdout.trim();
    }
    catch {
        throw new GitHubProviderUnavailableError("GitHub providerのrepositoryまたはPR観測を取得できません");
    }
    const complete = typeof observedRepository.nameWithOwner === "string" &&
        typeof observedRepository.defaultBranchRef?.name === "string" &&
        /^[a-f0-9]{40}$/iu.test(defaultBranchTipOid) &&
        typeof observedPr.number === "number" &&
        Number.isInteger(observedPr.number) &&
        typeof observedPr.baseRefName === "string" &&
        typeof observedPr.baseRefOid === "string" &&
        /^[a-f0-9]{40}$/iu.test(observedPr.baseRefOid) &&
        typeof observedPr.headRefOid === "string" &&
        /^[a-f0-9]{40}$/iu.test(observedPr.headRefOid);
    if (!complete)
        throw new GitHubProviderUnavailableError("GitHub providerのauthority観測が不完全です");
    if (typeof observedRepository.nameWithOwner !== "string" ||
        typeof observedRepository.defaultBranchRef?.name !== "string" ||
        typeof observedPr.number !== "number" ||
        typeof observedPr.baseRefName !== "string" ||
        typeof observedPr.baseRefOid !== "string" ||
        typeof observedPr.headRefOid !== "string")
        throw new GitHubProviderUnavailableError("GitHub providerのauthority観測を型付けできません");
    return {
        provenance: { source: "github", repository, prNumber },
        repository: observedRepository.nameWithOwner,
        defaultBranch: observedRepository.defaultBranchRef.name,
        defaultBranchTipOid,
        prNumber: observedPr.number,
        baseRefName: observedPr.baseRefName,
        baseRefOid: observedPr.baseRefOid,
        headRefOid: observedPr.headRefOid,
    };
}
function observeRepositoryAuthority(repository, cwd) {
    try {
        run("gh", ["auth", "status"], cwd);
    }
    catch {
        throw new GitHubProviderUnavailableError("GitHub providerの認証状態を観測できません");
    }
    try {
        const observed = parseObject(run("gh", [
            "repo",
            "view",
            repository,
            "--json",
            "nameWithOwner,defaultBranchRef",
        ], cwd).stdout, "repository authority観測");
        if (observed.nameWithOwner !== repository ||
            typeof observed.defaultBranchRef?.name !== "string")
            throw new Error("repository authorityのidentityが不完全です");
        const defaultBranchTipOid = requireFullOid(run("gh", [
            "api",
            `repos/${repository}/commits/${encodeURIComponent(observed.defaultBranchRef.name)}`,
            "--jq",
            ".sha",
        ], cwd).stdout.trim(), "provider default branch tip");
        return {
            provenance: { source: "github", repository },
            repository: observed.nameWithOwner,
            defaultBranch: observed.defaultBranchRef.name,
            defaultBranchTipOid,
        };
    }
    catch (error) {
        if (error instanceof GitHubProviderUnavailableError)
            throw error;
        throw new GitHubProviderUnavailableError(`GitHub providerのrepository authorityを観測できません: ${error instanceof Error ? error.message : String(error)}`);
    }
}
const EXACT_PULL_REQUEST_QUEUE_QUERY = `query ExactPullRequestQueue($owner:String!,$repo:String!,$number:Int!){repository(owner:$owner,name:$repo){nameWithOwner pullRequest(number:$number){number headRefOid mergeQueueEntry{id state enqueuedAt headCommit{oid} baseCommit{oid} pullRequest{number}}}}}`;
/**
 * PR creation recovery must prove exact absence before it may consume a dispatch
 * claim. `gh pr list --limit N` cannot prove absence because a matching historic
 * PR may exist after the client-side limit. Keep the cursor and pageInfo in this
 * query so `gh api --paginate --slurp` exhausts the provider connection.
 */
const EXACT_PULL_REQUESTS_QUERY = `query ExactPullRequests($owner:String!,$repo:String!,$head:String!,$base:String!,$endCursor:String){repository(owner:$owner,name:$repo){nameWithOwner pullRequests(first:100,after:$endCursor,headRefName:$head,baseRefName:$base,states:[OPEN,CLOSED,MERGED]){nodes{number url title body state mergedAt headRefName baseRefName headRefOid baseRefOid headRepository{nameWithOwner} isCrossRepository closingIssuesReferences(first:100){nodes{number url}}}pageInfo{hasNextPage endCursor}}}}`;
function observePullRequestQueue(repository, prNumber, cwd) {
    verifyRepository(repository, cwd, "read");
    const [owner, name, ...rest] = repository.split("/");
    if (!owner || !name || rest.length > 0)
        throw new Error("merge queue観測のrepositoryが不正です");
    const response = parseObject(run("gh", [
        "api",
        "graphql",
        "-f",
        `query=${EXACT_PULL_REQUEST_QUEUE_QUERY}`,
        "-f",
        `owner=${owner}`,
        "-f",
        `repo=${name}`,
        "-F",
        `number=${prNumber}`,
    ], cwd).stdout, "merge queue観測");
    const observedRepository = response.data?.repository;
    const observedPr = observedRepository?.pullRequest;
    if (observedRepository?.nameWithOwner !== repository ||
        observedPr?.number !== prNumber)
        throw new Error("merge queue観測のrepositoryまたはPRが一致しません");
    const headRefOid = requireFullOid(observedPr.headRefOid, "merge queue観測のPR HEAD");
    const entry = observedPr.mergeQueueEntry;
    if (entry === null)
        return { repository, prNumber, headRefOid, entry: null };
    if (!isRecord(entry))
        throw new Error("merge queue entryを決定的に観測できません");
    const states = new Set([
        "AWAITING_CHECKS",
        "LOCKED",
        "MERGEABLE",
        "QUEUED",
        "UNMERGEABLE",
    ]);
    if (typeof entry.id !== "string" ||
        entry.id.trim() === "" ||
        !states.has(entry.state) ||
        entry.pullRequest?.number !== prNumber)
        throw new Error("merge queue entryのidentityが不完全です");
    const headCommitOid = requireFullOid(entry.headCommit?.oid, "merge queue entryのHEAD");
    if (headCommitOid !== headRefOid)
        throw new Error("merge queue entryのHEADがPR HEADと一致しません");
    return {
        repository,
        prNumber,
        headRefOid,
        entry: {
            id: entry.id,
            state: entry.state,
            enqueuedAt: canonicalProviderInstant(entry.enqueuedAt, "merge queue entryのenqueuedAt"),
            headCommitOid,
            baseCommitOid: requireFullOid(entry.baseCommit?.oid, "merge queue entryのbase commit"),
        },
    };
}
function verifyRepository(repository, cwd, access) {
    run("gh", ["auth", "status"], cwd);
    let observed;
    try {
        observed = parseObject(run("gh", [
            "repo",
            "view",
            repository,
            "--json",
            "nameWithOwner,viewerPermission",
        ], cwd).stdout, "repository観測");
    }
    catch {
        throw new Error("GitHubリポジトリと権限の観測結果を検証できません");
    }
    if (observed.nameWithOwner !== repository)
        throw new Error(`GitHubリポジトリが一致しません: 期待値=${repository} 観測値=${observed.nameWithOwner || "不明"}`);
    const levels = ["READ", "TRIAGE", "WRITE", "MAINTAIN", "ADMIN"];
    const observedLevel = levels.indexOf(observed.viewerPermission ?? "");
    const requiredLevel = access === "write" ? levels.indexOf("WRITE") : levels.indexOf("READ");
    if (observedLevel < requiredLevel)
        throw new Error(`対象GitHubリポジトリの${access === "write" ? "書き込み" : "読み取り"}権限が不足しています`);
}
export function github(operation, supplied, cwd) {
    const input = supplied;
    if (operation === "issue.read") {
        /**
         * **更新前のIssue本文を読む唯一の経路である。**
         *
         * `issue.sync`は本文を全面置換する。既存のチェックリストや進捗記録を保全
         * するには更新前の本文が要るが、skillは`gh`の直接呼び出しを禁じている
         * （`step-04-issue-sync/SKILL.md`）。読み取り経路が無いと、この2つを
         * 同時に満たせない。
         *
         * 書き込みを行わないため`repository read`で足りる。
         */
        verifyRepository(input.repository, cwd, "read");
        const body = run("gh", [
            "issue",
            "view",
            String(input.issue),
            "--repo",
            input.repository,
            "--json",
            "body",
            "--jq",
            ".body",
        ], cwd).stdout.replace(/\r\n/g, "\n");
        return {
            repository: input.repository,
            issue: input.issue,
            body,
            bodySha256: crypto
                .createHash("sha256")
                .update(body, "utf8")
                .digest("hex"),
        };
    }
    if (operation === "issue.sync") {
        verifyRepository(input.repository, cwd, "write");
        const args = [
            "issue",
            "edit",
            String(input.issue),
            "--repo",
            input.repository,
            "--body-file",
            input.bodyFile,
        ];
        run("gh", args, cwd);
        const expected = fs
            .readFileSync(input.bodyFile, "utf8")
            .replace(/\r\n/g, "\n")
            .trimEnd();
        const observed = run("gh", [
            "issue",
            "view",
            String(input.issue),
            "--repo",
            input.repository,
            "--json",
            "body",
            "--jq",
            ".body",
        ], cwd)
            .stdout.replace(/\r\n/g, "\n")
            .trimEnd();
        if (observed !== expected)
            throw new Error("Issue同期後の読み取り検証に失敗しました");
        return {
            url: `https://github.com/${input.repository}/issues/${input.issue}`,
        };
    }
    if (operation === "repository.assert-write") {
        verifyRepository(input.repository, cwd, "write");
        return { repository: input.repository, writable: true };
    }
    if (operation === "repository.authority") {
        return observeRepositoryAuthority(input.repository, cwd);
    }
    if (operation === "issue.create") {
        verifyRepository(input.repository, cwd, "write");
        const result = run("gh", [
            "issue",
            "create",
            "--repo",
            input.repository,
            "--title",
            input.title,
            "--body-file",
            input.bodyFile,
        ], cwd);
        return { url: result.stdout.trim() };
    }
    if (operation === "pr.create") {
        verifyRepository(input.repository, cwd, "write");
        if (!/^[a-f0-9]{40}$/i.test(input.headSha ?? ""))
            throw new Error("PR対象HEAD SHAが不正です");
        const expectedBaseSha = requireFullOid(input.baseSha, "PR対象base SHA");
        const remoteHead = run("gh", [
            "api",
            `repos/${input.repository}/commits/${encodeURIComponent(input.head)}`,
            "--jq",
            ".sha",
        ], cwd).stdout.trim();
        if (remoteHead !== input.headSha)
            throw new Error("PR作成前にremote branchのHEAD SHAが証拠と一致しません");
        const remoteBase = run("gh", [
            "api",
            `repos/${input.repository}/commits/${encodeURIComponent(input.base)}`,
            "--jq",
            ".sha",
        ], cwd).stdout.trim();
        if (!/^[a-f0-9]{40}$/iu.test(remoteBase))
            throw new Error("PR作成前にremote base branchを固定commitへ解決できません");
        if (remoteBase !== expectedBaseSha)
            throw new Error("PR作成前にremote base branchのHEAD SHAが準備済み証拠と一致しません");
        /**
         * **本文はfile経由で渡す。** argvの上限は約131KBで、template構造を満たす本文は
         * 改行と記号を多く含む。`--body`へ直接載せると上限と引用の扱いに依存する。
         */
        const bodyDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "asc-pr-body-"));
        const composedBodyFile = path.join(bodyDirectory, "body.md");
        fs.writeFileSync(composedBodyFile, `${input.body}\n`);
        /**
         * **成功時も例外時も一時fileを残さない。** `gh`はfileを同期的に読み切るため、
         * 呼び出し直後に消してよい。残すと`pr create`のたびにtmpへ本文が蓄積する。
         */
        let created;
        try {
            /**
             * **claimはprovider要求の直前でだけ消費する**（Issue #1157）。
             *
             * 以前はCLIがclaimを消費してからこのadapterを呼び、adapterの第1文の
             * `verifyRepository`（内部で`gh auth status`）で落ちていた。**変更要求を1度も
             * 送っていないのに「成否を断定できない」としてstagingが恒久的に停止していた。**
             *
             * `01_開発ワークフロー.md`はprovider call直前のclaimを定めている。ここが
             * 「最終再検証に成功した同じ呼び出しだけが一度実行できる」境界である。
             * **`onDispatch`を任意にしない。** 任意にすると、claimを取らずに変更要求を
             * 送れるprimitiveが公開され、並行実行で重複PRを作れる。
             *
             * **型で必須にしたうえで実行時も確かめる。** overloadは`pr.create`へ
             * `onDispatch`を必須にしているが、実装signatureは全operation共通のため
             * 省略が型で止まらない経路が残る。**fail-closedで拒否する。**
             *
             * **本文を書いた後・`gh`を起動する前に置く。** `try`の外へ出すと、gateが
             * 拒否したときにPR本文を含む一時領域が残る（外部reviewer指摘）。前へ出すと、
             * 本文書き込みの失敗がclaim消費後に起きて同じ欠陥を再現する。
             */
            if (typeof input.onDispatch !== "function")
                throw new Error("PR createにはdispatch claimの受け渡しが必要です");
            if (!input.onDispatch())
                throw new Error("PR create dispatch claimは既に消費済みのためprovider createを再送しません");
            created = run("gh", [
                "pr",
                "create",
                "--repo",
                input.repository,
                "--head",
                input.head,
                "--base",
                input.base,
                "--title",
                input.title,
                "--body-file",
                composedBodyFile,
            ], cwd);
        }
        finally {
            fs.rmSync(bodyDirectory, { recursive: true, force: true });
        }
        const result = created;
        const url = result.stdout.trim();
        const urlMatch = new RegExp(`^https://github\\.com/${input.repository.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}/pull/([1-9]\\d*)$`, "iu").exec(url);
        if (!urlMatch)
            throw new Error("PR作成結果のURLが対象リポジトリと一致しません");
        let observed;
        try {
            observed = parseObject(run("gh", [
                "pr",
                "view",
                url,
                "--repo",
                input.repository,
                "--json",
                "number,url,title,body,headRefName,baseRefName,headRefOid,baseRefOid,headRepository,isCrossRepository,closingIssuesReferences",
            ], cwd).stdout, "PR観測");
        }
        catch (error) {
            return {
                state: "rollback_required",
                url,
                reason: `PR作成後の読み取り検証に失敗しました。作成済みPRを確認してcloseまたは修正してください: ${error instanceof Error ? error.message : String(error)}`,
            };
        }
        const expectedBody = input.body.replace(/\r\n/g, "\n").trimEnd();
        const observedBody = observed.body?.replace(/\r\n/g, "\n").trimEnd();
        if (observed.number !== Number(urlMatch[1]) ||
            observed.url !== url ||
            observed.title !== input.title ||
            observedBody !== expectedBody ||
            observed.headRefName !== input.head ||
            observed.baseRefName !== input.base ||
            observed.headRefOid !== input.headSha ||
            observed.baseRefOid !== remoteBase ||
            observed.headRepository?.nameWithOwner?.toLowerCase() !==
                input.repository.toLowerCase() ||
            observed.isCrossRepository !== false) {
            return {
                state: "rollback_required",
                url,
                reason: "PR作成後の読み取り検証に失敗しました。作成済みPRを確認してcloseまたは修正してください",
                observation: observed,
            };
        }
        return { state: "created", url, observation: observed };
    }
    if (operation === "pr.inspect") {
        verifyRepository(input.repository, cwd, "read");
        const result = run("gh", [
            "pr",
            "view",
            String(input.pr),
            "--repo",
            input.repository,
            "--json",
            "number,url,title,body,state,mergedAt,mergeCommit,autoMergeRequest,author,isDraft,headRefName,baseRefName,headRefOid,baseRefOid,headRepository,isCrossRepository,mergeStateStatus,reviewDecision,statusCheckRollup,closingIssuesReferences",
        ], cwd);
        return parseObject(result.stdout, "PR観測");
    }
    if (operation === "pr.find") {
        verifyRepository(input.repository, cwd, "read");
        if (typeof input.head !== "string" ||
            typeof input.base !== "string" ||
            input.head.trim() === "" ||
            input.base.trim() === "" ||
            input.head.startsWith("-") ||
            input.base.startsWith("-") ||
            input.head.includes("..") ||
            input.base.includes(".."))
            throw new Error("pr.findのheadまたはbase branch名が不正です");
        const [owner, name, ...rest] = input.repository.split("/");
        if (!owner || !name || rest.length > 0)
            throw new Error("pr.findのrepositoryが不正です");
        const parsed = JSON.parse(run("gh", [
            "api",
            "graphql",
            "--paginate",
            "--slurp",
            "-f",
            `query=${EXACT_PULL_REQUESTS_QUERY}`,
            "-f",
            `owner=${owner}`,
            "-f",
            `repo=${name}`,
            "-f",
            `head=${input.head}`,
            "-f",
            `base=${input.base}`,
        ], cwd).stdout);
        if (!Array.isArray(parsed) || parsed.length === 0)
            throw new Error("PR検索結果がpage配列ではありません");
        const observations = [];
        for (const [pageIndex, rawPage] of parsed.entries()) {
            if (!isRecord(rawPage) || !isRecord(rawPage.data))
                throw new Error(`PR検索結果page ${pageIndex + 1}が不正です`);
            const repository = rawPage.data.repository;
            if (!isRecord(repository) ||
                repository.nameWithOwner !== input.repository ||
                !isRecord(repository.pullRequests) ||
                !Array.isArray(repository.pullRequests.nodes))
                throw new Error(`PR検索結果page ${pageIndex + 1}のrepositoryが不正です`);
            const pageInfo = repository.pullRequests.pageInfo;
            const finalPage = pageIndex === parsed.length - 1;
            if (!isRecord(pageInfo) ||
                typeof pageInfo.hasNextPage !== "boolean" ||
                (pageInfo.endCursor !== null &&
                    (typeof pageInfo.endCursor !== "string" ||
                        pageInfo.endCursor === "")) ||
                pageInfo.hasNextPage === finalPage ||
                (pageInfo.hasNextPage && typeof pageInfo.endCursor !== "string"))
                throw new Error(`PR検索結果page ${pageIndex + 1}のpaginationが完結していません`);
            for (const rawNode of repository.pullRequests.nodes) {
                if (!isRecord(rawNode))
                    throw new Error("PR検索結果nodeがobjectではありません");
                if (!Number.isSafeInteger(rawNode.number) ||
                    Number(rawNode.number) < 1 ||
                    typeof rawNode.url !== "string" ||
                    typeof rawNode.title !== "string" ||
                    typeof rawNode.body !== "string" ||
                    (rawNode.state !== "OPEN" &&
                        rawNode.state !== "CLOSED" &&
                        rawNode.state !== "MERGED") ||
                    (rawNode.mergedAt !== null && typeof rawNode.mergedAt !== "string") ||
                    typeof rawNode.headRefName !== "string" ||
                    rawNode.headRefName === "" ||
                    typeof rawNode.baseRefName !== "string" ||
                    rawNode.baseRefName === "" ||
                    !isRecord(rawNode.headRepository) ||
                    typeof rawNode.headRepository.nameWithOwner !== "string" ||
                    rawNode.headRepository.nameWithOwner === "" ||
                    typeof rawNode.isCrossRepository !== "boolean")
                    throw new Error("PR検索結果nodeの必須fieldが不正です");
                requireFullOid(rawNode.headRefOid, "PR検索結果nodeのhead OID");
                requireFullOid(rawNode.baseRefOid, "PR検索結果nodeのbase OID");
                if (typeof rawNode.mergedAt === "string")
                    canonicalProviderInstant(rawNode.mergedAt, "PR検索結果nodeのmergedAt");
                const closingConnection = rawNode.closingIssuesReferences;
                if (!isRecord(closingConnection) ||
                    !Array.isArray(closingConnection.nodes) ||
                    closingConnection.nodes.some((item) => !isRecord(item) ||
                        !Number.isSafeInteger(item.number) ||
                        Number(item.number) < 1 ||
                        typeof item.url !== "string" ||
                        item.url === ""))
                    throw new Error("PR検索結果のclosing Issue接続が不正です");
                observations.push({
                    ...rawNode,
                    closingIssuesReferences: closingConnection.nodes,
                });
            }
        }
        return observations;
    }
    if (operation === "pr.queue") {
        return observePullRequestQueue(input.repository, input.pr, cwd);
    }
    if (operation === "pr.reviews") {
        verifyRepository(input.repository, cwd, "read");
        const pages = JSON.parse(run("gh", [
            "api",
            "--paginate",
            "--slurp",
            `repos/${input.repository}/pulls/${input.pr}/reviews?per_page=100`,
        ], cwd).stdout);
        if (!Array.isArray(pages) || pages.some((page) => !Array.isArray(page)))
            throw new Error("GitHub review観測がpage配列ではありません");
        const reviews = pages.flat();
        if (reviews.some((review) => !isRecord(review)))
            throw new Error("GitHub review観測にobjectでないeventがあります");
        return reviews.flatMap((review) => {
            const typed = review;
            // REST exposes draft reviews as PENDING with submitted_at=null. They
            // are not review-state events and cannot grant or revoke approval.
            if (typed.state === "PENDING")
                return [];
            return [
                {
                    state: typed.state,
                    commitSha: typed.commit_id,
                    actorId: typed.user?.node_id,
                    submittedAt: typed.submitted_at,
                    reviewId: String(typed.id ?? ""),
                },
            ];
        });
    }
    if (operation === "pr.ci-runs") {
        verifyRepository(input.repository, cwd, "read");
        const headSha = requireFullOid(input.headSha, "pr.ci-runsのHEAD SHA");
        const pages = JSON.parse(run("gh", [
            "api",
            "--paginate",
            "--slurp",
            `repos/${input.repository}/actions/runs?event=pull_request&head_sha=${headSha}&status=success&per_page=100`,
        ], cwd).stdout);
        if (!Array.isArray(pages))
            throw new Error("GitHub Actions run観測がpage object配列ではありません");
        const pageRecords = pages.filter(isRecord);
        if (pageRecords.length !== pages.length)
            throw new Error("GitHub Actions run観測がpage object配列ではありません");
        const runs = pageRecords.flatMap((page) => {
            const observed = page.workflow_runs;
            if (!Array.isArray(observed))
                throw new Error("GitHub Actions run観測のworkflow_runsが配列ではありません");
            return observed;
        });
        if (runs.some((run) => !isRecord(run)))
            throw new Error("GitHub Actions run観測にobjectでないrunがあります");
        return runs.map((rawRun) => {
            const run = rawRun;
            if (!isRecord(run.repository) ||
                typeof run.repository.full_name !== "string" ||
                !Array.isArray(run.pull_requests) ||
                run.pull_requests.some((pullRequest) => !isRecord(pullRequest) ||
                    !Number.isSafeInteger(pullRequest.number) ||
                    Number(pullRequest.number) < 1))
                throw new Error("GitHub Actions run観測のidentityが不正です");
            return {
                repository: run.repository.full_name,
                runId: String(run.id ?? ""),
                event: String(run.event ?? ""),
                headSha: String(run.head_sha ?? ""),
                conclusion: String(run.conclusion ?? "").toLowerCase(),
                pullRequestNumbers: run.pull_requests.map((pullRequest) => Number(pullRequest.number)),
            };
        });
    }
    if (operation === "commit.inspect") {
        verifyRepository(input.repository, cwd, "read");
        const requestedSha = requireFullOid(input.sha, "commit.inspectのSHA");
        const commit = parseObject(run("gh", ["api", `repos/${input.repository}/commits/${requestedSha}`], cwd).stdout, "commit観測");
        if (commit.sha !== requestedSha)
            throw new Error("commit.inspectの応答OIDが要求OIDと一致しません");
        return { sha: commit.sha, authorActorId: commit.author?.node_id };
    }
    if (operation === "commit.topology") {
        verifyRepository(input.repository, cwd, "read");
        const sha = requireFullOid(input.sha, "commit.topologyのSHA");
        const observed = parseObject(run("gh", ["api", `repos/${input.repository}/commits/${sha}`], cwd)
            .stdout, "merge commit topology観測");
        if (observed.sha !== sha ||
            typeof observed.commit?.tree?.sha !== "string" ||
            !/^[a-f0-9]{40}$/u.test(observed.commit.tree.sha) ||
            !Array.isArray(observed.parents) ||
            observed.parents.some((parent) => typeof parent.sha !== "string" || !/^[a-f0-9]{40}$/u.test(parent.sha)))
            throw new Error("merge commit topologyのOID観測が不完全です");
        return {
            repository: input.repository,
            sha,
            treeSha: observed.commit.tree.sha,
            parentShas: observed.parents.map((parent) => parent.sha),
        };
    }
    if (operation === "commit.ancestry") {
        verifyRepository(input.repository, cwd, "read");
        const ancestorSha = requireFullOid(input.sha, "commit.ancestryのancestor");
        const descendantSha = requireFullOid(input.descendantSha, "commit.ancestryのdescendant");
        const observed = parseObject(run("gh", [
            "api",
            `repos/${input.repository}/compare/${ancestorSha}...${descendantSha}`,
        ], cwd).stdout, "commit ancestry観測");
        if (observed.base_commit?.sha !== ancestorSha ||
            observed.merge_base_commit?.sha !== ancestorSha ||
            (observed.status !== "ahead" && observed.status !== "identical"))
            return {
                repository: input.repository,
                ancestorSha,
                descendantSha,
                status: String(observed.status ?? "unknown"),
                isAncestor: false,
            };
        return {
            repository: input.repository,
            ancestorSha,
            descendantSha,
            status: observed.status,
            isAncestor: true,
        };
    }
    if (operation === "ref.inspect") {
        verifyRepository(input.repository, cwd, "read");
        if (typeof input.branch !== "string" ||
            input.branch.trim() === "" ||
            input.branch.startsWith("-") ||
            input.branch.includes(".."))
            throw new Error("ref.inspectのbranch名が不正です");
        const sha = requireFullOid(run("gh", [
            "api",
            `repos/${input.repository}/commits/${encodeURIComponent(input.branch)}`,
            "--jq",
            ".sha",
        ], cwd).stdout.trim(), "ref.inspectのSHA");
        return { branch: input.branch, sha };
    }
    if (operation === "policy.authority") {
        return observePolicyAuthority(input.repository, input.pr, cwd);
    }
    if (operation === "review.evidence") {
        verifyRepository(input.repository, cwd, "read");
        const implementationCommitSha = requireFullOid(input.implementationCommitSha, "review.evidenceの実装SHA");
        const pr = parseObject(run("gh", [
            "pr",
            "view",
            String(input.pr),
            "--repo",
            input.repository,
            "--json",
            "number,headRefOid,author",
        ], cwd).stdout, "PR観測");
        const implementation = parseObject(run("gh", ["api", `repos/${input.repository}/commits/${implementationCommitSha}`], cwd).stdout, "commit観測");
        if (implementation.sha !== implementationCommitSha)
            throw new Error("review.evidenceの実装commit OIDが要求OIDと一致しません");
        const ci = parseObject(run("gh", ["api", `repos/${input.repository}/actions/runs/${input.runId}`], cwd).stdout, "CI観測");
        const review = parseObject(run("gh", [
            "api",
            `repos/${input.repository}/pulls/${input.pr}/reviews/${input.reviewId}`,
        ], cwd).stdout, "review観測");
        return {
            provenance: {
                source: "github",
                repository: input.repository,
                prNumber: input.pr,
                runId: String(input.runId),
                reviewId: String(input.reviewId),
            },
            implementation: {
                repository: input.repository,
                commitSha: implementation.sha,
                authorActorId: implementation.author?.node_id,
            },
            pr: {
                repository: input.repository,
                number: pr.number,
                headSha: pr.headRefOid,
                authorActorId: pr.author?.id,
            },
            ci: {
                repository: ci.repository?.full_name,
                runId: String(ci.id ?? ""),
                event: ci.event,
                headSha: ci.head_sha,
                conclusion: String(ci.conclusion ?? "").toLowerCase(),
                pullRequestNumbers: Array.isArray(ci.pull_requests)
                    ? ci.pull_requests.map((item) => item.number)
                    : [],
            },
            review: {
                repository: input.repository,
                prNumber: pr.number,
                reviewId: String(review.id ?? ""),
                commitSha: review.commit_id,
                actorId: review.user?.node_id,
                submittedAt: review.submitted_at,
                verdict: String(review.state ?? "").toLowerCase(),
            },
        };
    }
    if (operation === "branch.protection") {
        verifyRepository(input.repository, cwd, "read");
        const result = run("gh", [
            "api",
            `repos/${input.repository}/branches/${encodeURIComponent(input.branch)}/protection`,
        ], cwd, { allowFailure: true });
        if (result.status === 0)
            return {
                known: true,
                protected: true,
                value: JSON.parse(result.stdout),
            };
        if (result.status === 1 &&
            /404|Branch not protected/i.test(result.stderr)) {
            const rulesResult = run("gh", [
                "api",
                "--paginate",
                "--slurp",
                `repos/${input.repository}/rules/branches/${encodeURIComponent(input.branch)}?per_page=100`,
            ], cwd, { allowFailure: true });
            if (rulesResult.status !== 0)
                return {
                    known: false,
                    protected: false,
                    error: rulesResult.stderr,
                };
            try {
                const pages = JSON.parse(rulesResult.stdout);
                if (!Array.isArray(pages) || pages.some((page) => !Array.isArray(page)))
                    throw new Error("ruleset応答がpage配列ではありません");
                const rules = pages.flat();
                if (rules.some((rule) => !isRecord(rule)))
                    throw new Error("ruleset応答にobject以外が含まれます");
                const protectingRuleTypes = new Set([
                    "pull_request",
                    "required_status_checks",
                    "required_signatures",
                    "non_fast_forward",
                    "required_linear_history",
                ]);
                const protectingRules = rules.filter((rule) => isRecord(rule) &&
                    typeof rule.type === "string" &&
                    protectingRuleTypes.has(rule.type));
                return protectingRules.length > 0
                    ? {
                        known: true,
                        protected: true,
                        value: { source: "ruleset", rules: protectingRules },
                    }
                    : {
                        known: true,
                        protected: false,
                        value: rules.length > 0
                            ? { source: "ruleset", rules }
                            : { source: "ruleset" },
                    };
            }
            catch (error) {
                return {
                    known: false,
                    protected: false,
                    error: error instanceof Error ? error.message : String(error),
                };
            }
        }
        return { known: false, protected: false, error: result.stderr };
    }
    if (operation === "pr.merge") {
        verifyRepository(input.repository, cwd, "write");
        const expectedHeadSha = requireFullOid(input.headSha, "merge対象の再認可済みHEAD SHA");
        /**
         * **既定をsquashへ倒さない。**
         *
         * squashは取り込み先branch上のcommitの親を1個にするため、`audit:check`が
         * `比較基点..H_impl`と`H_impl..H_final`の2区間を導出できなくなる。未知値を
         * 黙ってsquashにすると、その破壊が診断なしで起きる。
         */
        const methodFlag = mergeMethodFlag(input.method);
        run("gh", [
            "pr",
            "merge",
            String(input.pr),
            "--repo",
            input.repository,
            methodFlag,
            "--auto",
            "--match-head-commit",
            expectedHeadSha,
        ], cwd);
        return { state: "merge_or_native_auto_merge_requested" };
    }
    throw new Error(`未対応のGitHub操作です: ${operation}`);
}
//# sourceMappingURL=github.js.map