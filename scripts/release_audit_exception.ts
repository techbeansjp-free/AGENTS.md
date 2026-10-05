import fs from "node:fs";

/** 手動releaseの工程監査だけに適用する、対象SHAに固定した明示例外。 */
export function releaseAuditException(
  environment: NodeJS.ProcessEnv,
  head: string,
): { sha: string; reason: string; actor: string; run: string } | undefined {
  const sha = environment.RELEASE_AUDIT_EXCEPTION_SHA ?? "";
  const reason = (environment.RELEASE_AUDIT_EXCEPTION_REASON ?? "").trim();
  if (!sha && !reason) return undefined;
  if (
    environment.GITHUB_ACTIONS !== "true" ||
    environment.GITHUB_EVENT_NAME !== "workflow_dispatch" ||
    !/^[a-f0-9]{40}$/u.test(sha) ||
    sha !== head ||
    sha !== environment.GITHUB_SHA ||
    !reason ||
    !environment.GITHUB_ACTOR ||
    !environment.GITHUB_RUN_ID ||
    !environment.GITHUB_STEP_SUMMARY
  ) {
    throw new Error(
      "工程監査例外には手動Actions実行・一致する対象SHA・理由・実行者・記録先が必要です",
    );
  }
  return {
    sha,
    reason,
    actor: environment.GITHUB_ACTOR,
    run: environment.GITHUB_RUN_ID,
  };
}

/** 元の監査結果は不合格のまま保存し、品質検査の成功に置き換えない。 */
export function recordReleaseAuditException(
  exception: NonNullable<ReturnType<typeof releaseAuditException>>,
  result: unknown,
  summary: string,
): void {
  const record = { state: "audit-exception", ...exception, audit: result };
  const serialized = JSON.stringify(record, null, 2);
  fs.writeFileSync("release-audit-exception.json", `${serialized}\n`, {
    flag: "wx",
  });
  fs.appendFileSync(
    summary,
    `\n## 工程証跡監査の明示例外\n\n${serialized
      .split("\n")
      .map((line) => `    ${line}`)
      .join("\n")}\n`,
  );
  process.stdout.write(`${serialized}\n`);
}
