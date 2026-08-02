# PLAN: bugfix: gate workflowが未レビュー状態をジョブ失敗として扱い全PRのCIを恒常的に赤くしている

- Issue: `ISSUE-349`
- 対応する DESIGN: `DESIGN.md`

## 実装順序・変更単位

| # | 変更単位 | 内容 | 対応 AC-ID | 依存する変更単位 |
|---|---|---|---|---|
| 1 | `verify.ts: gate-reportのpending/otherErrors分離とexit code 2導入` | `src/commands/verify.ts`の`gateReport()`（D1）を、`conformance`/`falsification`/`final`のpending検出を`pendingErrors`へ、スキーマ検証・target_sha検証・approved_artifacts検証の違反を`otherErrors`へ分離するよう改修する。`otherErrors.length > 0`なら`otherErrors`（+参考情報としてpendingErrorsも併記可）を出力しexit 1。`otherErrors.length === 0 && pendingErrors.length > 0`なら`pendingErrors`をstderrへ出力しexit 2。両方0件ならexit 0。`GATE_REPORT_USAGE`の説明文に「2=pendingのみ（違反ではない）」を追記する。`test/integration/verify.test.ts`の「pendingのまま検証する」ケース（既存で`assert.equal(pending.status, 1)`）を`status, 2`へ更新する（メッセージのstderr出力先・文言は変更しないため、当該assert.match群はそのまま維持できる）。 | `AC-1, AC-2, AC-3` | なし |
| 2 | `agent-skill-chain-gate.yml: pending時action_required Check Run発行` | `verify-and-publish`ジョブの`Verify gate report schema`ステップ（D2）へ`id: schema`を付与し、`GH_TOKEN`/`GATE_ID`(`matrix.gate`)/`HEAD_SHA`(`needs.detect-segments.outputs.target_sha`)環境変数を追加する。`set +e`で`verify-gate-report.sh`のexit codeを捕捉し、`CODE -eq 2`の場合のみ`Verify local-review evidence`ステップと同型の`node -e`＋`gh api -X POST repos/{owner}/{repo}/check-runs`で`name: agent-skill-chain/${GATE_ID}-gate`, `conclusion: action_required`のCheck Runを発行してから`exit 0`する。それ以外は`exit "$CODE"`のまま（0はステップ成功・1はジョブ失敗という既存挙動を維持）。 | `AC-1, AC-2, AC-3` | `#1` |
| 3 | `agent-skill-chain-gate.yml: detect-segmentsへdependabotスキップ分岐追加` | `detect-segments`ジョブの`Resolve immutable context`ステップ（id: context）へ`ACTOR: ${{ github.event.pull_request.user.login }}`環境変数を追加し、Issue ID抽出失敗時の既存`exit 1`分岐の前に`elif [[ "$ACTOR" == "dependabot[bot]" && "$BRANCH" == dependabot/* ]]; then echo "issue_id=" >> "$GITHUB_OUTPUT"; echo "skip_checks=true" >> "$GITHUB_OUTPUT"`を挿入する（`agent-skill-chain-ci.yml`の既存分岐と同型）。成功分岐（Issue ID抽出成功時）にも`echo "skip_checks=false" >> "$GITHUB_OUTPUT"`を追加する。`Detect started segments`ステップ（id: segments）へ`if: steps.context.outputs.skip_checks != 'true'`を追加する。ジョブ出力定義の`matrix: ${{ steps.segments.outputs.matrix }}`を`matrix: ${{ steps.segments.outputs.matrix || '[]' }}`へ変更し、ステップ未実行時でも`verify-and-publish`ジョブの`if`条件（`needs.detect-segments.outputs.matrix != '[]'`）が有効な空配列JSONとして評価されるようにする。 | `AC-4, AC-5` | なし |
| 4 | `配布テンプレートへの同期` | `.agent-skill-chain/templates/github/.github/workflows/agent-skill-chain-gate.yml`へ変更単位2・3と同一の差分を反映し、`.agent-skill-chain/scripts/verify-template-sync.sh`（CI: `agent-skill-chain-ci.yml`の`verify-template-sync`相当ステップ）をgreenに保つ。 | `AC-6` | `#2, #3` |
| 5 | `実機確認` | 変更単位1〜4がmainへマージされた後、実装時点でオープンだったIssue駆動PR（pendingゲートを持つもの、SPEC.md記載の#345等）へ対し`verify-and-publish`を再実行または新規pushで再評価し、SUCCESS化とCheck Run（action_required）発行を目視確認する。結果は`VALIDATION.md`（manual検証記録）へ記載する。 | `AC-7` | `#1, #2, #3, #4` |

## 実装順序の見直しについて

実装中に作業順序（上記の変更単位の並び）のみを見直す場合は、本ファイルのみを更新すればよい。設計要素・責務・境界そのものを変更する場合は、DESIGN.md の更新（および設計ゲートの再通過）が必要になる点に注意する。
