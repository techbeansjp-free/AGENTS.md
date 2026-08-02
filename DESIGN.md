# DESIGN: bugfix: gate workflowが未レビュー状態をジョブ失敗として扱い全PRのCIを恒常的に赤くしている

- Issue: `ISSUE-349`
- 対応する SPEC: `SPEC.md`

## 要件 → 設計要素の対応表

| 要件 / AC-ID | 対応する設計要素 | 備考 |
|---|---|---|
| `AC-1`（pendingでSUCCESS化+action_required発行） | D1: `verify.ts gateReport()` の exit code分離、D2: `agent-skill-chain-gate.yml` の `Verify gate report schema` ステップ改修＋`Publish Check Run`ステップのpending時skip | D1がpendingのみを検出可能にし、D2が`Verify gate report schema`ステップでCheck Runを発行したうえで、後続`Publish Check Run`ステップ（`gate publish`が`final=pending`を拒否し非0終了する）を同一ジョブ内のstep output経由でskipし、ジョブ全体をSUCCESSで完了させる |
| `AC-2`（rejectedは引き続き失敗表現） | D1 | pending以外の理由で`conformance`/`falsification`/`final`が確定していれば従来通りexit 0で後続の`gate publish`（無変更）へ進む |
| `AC-3`（pending以外の不合格は引き続きジョブ失敗） | D1 | schema違反・digest不一致・target_sha不正は「pending以外の理由」として無条件にexit 1を維持する |
| `AC-4`（dependabotでdetect-segments skip） | D3: `detect-segments`ジョブへのdependabotスキップ分岐追加 | `agent-skill-chain-ci.yml`と同型のPR作成者判定を移植する |
| `AC-5`（抽出不能ブランチは引き続き拒否） | D3 | 既存のelse節（exit 1）をそのまま維持する |
| `AC-6`（配布テンプレート同期） | D4: `.agent-skill-chain/templates/github/.github/workflows/agent-skill-chain-gate.yml`へのD2・D3同期 | `verify-template-sync`検査の対象 |
| `AC-7`（実機確認） | D5: 実機検証手順（VALIDATION.mdでmanual実行） | 設計要素ではなく、D1〜D4マージ後の運用確認事項 |

## 責務・境界

### コンポーネント構成

- `src/commands/verify.ts` の `gateReport()`（D1）: gate-reportの検証結果を「pending以外の理由による違反（otherErrors）」と「pendingであること自体（pendingErrors）」に分離して集計する責務のみを持つ。`otherErrors`が1件でもあればexit 1（従来通り）。`otherErrors`が0件で`pendingErrors`が1件以上ならexit 2（新設、pending専用）。両方0件ならexit 0。スキーマ検証・target_sha検証・approved_artifacts検証のロジック自体は変更しない。
- `.agent-skill-chain/ci/verify-gate-report.sh`: `verify gate-report`への薄いラッパーのまま変更しない（`exec`によりexit code 2もそのまま伝播する）。usageコメントのみ更新対象。
- `.github/workflows/agent-skill-chain-gate.yml` の `verify-and-publish`ジョブ内`Verify gate report schema`ステップ（`id: schema`、D2）: `set +e`でexit codeを捕捉し、code=2の場合のみ既存の`Verify local-review evidence`ステップと同じ形式（`node -e` + `gh api check-runs`）で`agent-skill-chain/<gate>-gate`という名前のaction_required Check Runを`target_sha`へ発行したうえで`echo "pending=true" >> "$GITHUB_OUTPUT"`してからexit 0する。code=0の場合は`echo "pending=false" >> "$GITHUB_OUTPUT"`してから現状どおり素通りする。code=1はそのまま`exit "$CODE"`でジョブが停止する（pending出力は書かれないが、ジョブ自体が停止するため後続ステップは実行されず無関係）。
- `.github/workflows/agent-skill-chain-gate.yml` の `verify-and-publish`ジョブ内`Publish Check Run`ステップ（D2）: 現状の無条件実行（if条件なし）を`if: steps.schema.outputs.pending != 'true'`へ変更する。pendingの場合は直前の`Verify gate report schema`ステップが既にaction_required Check Runを発行済みであり、かつ`gate publish`（`src/commands/gate.ts`の`publish()`関数）は`report.gate.final === 'pending'`を「真に未レビュー」として明示的に拒否し非0で終了する実装になっているため、このステップ自体をskipして二重発行・後続ジョブ失敗を防ぐ。`publish()`関数のpending拒否ガード自体（および他の分岐）は変更しない——本Issueのスコープは「pending判定結果をworkflow側でどう扱うか」のみであり、`gate.ts`の集約規則・ガード実装そのものの変更はSPEC.mdのスコープ外事項に該当するため対象としない。
- `.github/workflows/agent-skill-chain-gate.yml` の `detect-segments`ジョブ（D3）: `Resolve immutable context`ステップに`ACTOR`環境変数（`github.event.pull_request.user.login`）を追加し、Issue ID抽出失敗時に`ACTOR == 'dependabot[bot]' && BRANCH == dependabot/*`ならスキップ（`skip_checks=true`、`issue_id`空）とする分岐を、既存の抽出失敗時exit 1のelse節の**前**に挿入する。`Detect started segments`ステップに`if: steps.context.outputs.skip_checks != 'true'`を追加し、ジョブ出力`matrix`の参照式を`${{ steps.segments.outputs.matrix || '[]' }}`へ変更する（ステップ未実行時に空文字列ではなく`'[]'`が伝播するようにするため）。
- `.agent-skill-chain/templates/github/.github/workflows/agent-skill-chain-gate.yml`（D4）: D2・D3と同一内容を反映するだけの配布物であり、独立した設計判断を持たない。

### 依存関係

```text
gateReport()（D1） → verify-gate-report.sh（無変更） → agent-skill-chain-gate.yml「Verify gate report schema」ステップ（id: schema、D2）
「Verify gate report schema」ステップのpending出力（steps.schema.outputs.pending） → 同ジョブ「Publish Check Run」ステップのif条件（D2、新設）
detect-segmentsジョブのcontext/segmentsステップ（D3） → 同ジョブのmatrix出力 → verify-and-publishジョブのif条件（無変更）
D2・D3 → templates/github/.github/workflows/agent-skill-chain-gate.yml（D4） ※単純ミラー、逆方向の依存はない
```

D1はD2からのみ呼び出され、D3はD1と独立（detect-segmentsジョブとverify-and-publishジョブは別ジョブであり、循環はない）。D2は既存の`Verify local-review evidence`ステップが持つCheck Run発行ロジック（`node -e`＋`gh api`パターン）を再利用するのみで新規外部依存を導入しない。「Publish Check Run」ステップのif条件は同一ジョブ内のstep output参照のみであり、`src/commands/gate.ts`の`publish()`関数は変更しない（同関数への依存は既存のまま：pending以外の場合にこのステップから呼び出される）。

## 関連ADR

```yaml
related_adrs: []
```

`accepted`のADRの中に本設計と直接関連するものは無い。本Issueで新設する`docs/adr/ADR-0018-gate-report-pending-as-action-required.md`（status: proposed）はこの設計を確定させるADRであり、同一設計セグメントの主成果物であるため`related_adrs:`には計上しない。

## 障害・ロールバック考慮

- 想定される失敗モード: D1のpending/otherErrors分離ロジックに誤りがあると、本来exit 1にすべきgate-report（スキーマ違反・digest不一致・target_sha不正）を誤ってexit 2（pending扱い）に倒し、マージ阻害が緩む「fail-open」方向のバグとなり得る。これはI8（安全側ラチェット）に抵触するため、設計上「otherErrorsが1件でも存在すれば無条件にexit 1」を優先させ、pending判定はotherErrorsが完全に0件の場合にのみ働く排他的分岐とする（曖昧な優先度付けをしない）。
- 想定される失敗モード（`Publish Check Run`ステップのif条件）: `steps.schema.outputs.pending`の書き出し漏れ・判定誤りにより、pendingであるにもかかわらず`if`条件がfalseと評価されず同ステップが実行された場合、`gate publish`（`publish()`関数の既存ガード）が`final=pending`を拒否し非0で終了するため、ジョブはFAILUREへ戻る。これはAC-1の効果が当該実行に限り得られない退行だが、マージ阻害を緩める方向（fail-open）ではなく従来の安全側（fail-closed）へ戻るだけであり、I8には抵触しない。逆にpendingでないにもかかわらず誤って`if`条件がskipと評価された場合は、`gate publish`が呼ばれずCheck Run発行（approved/rejectedの確定結果）が欠落するため、この方向の誤りをテストで優先的に検出する。
- ロールバック手順: D1〜D4はいずれも本Issueの単一PR内の変更であり、当該PRをrevertすれば即座に旧動作（全pending=FAILURE、dependabotブランチでdetect-segments失敗）へ戻る。Check Run自体はcommit SHA単位で発行されるため、reconcile.shが後続pushで再評価し状態を追従させる。
- 影響を受ける既存機能: `verify gate-report`の呼び出し元は`agent-skill-chain-gate.yml`の1箇所のみ（他script・workflowからの呼び出しなし）。既存の単体テスト（`test/integration/verify.test.ts`のpendingのみgate-reportを検証するケース）は現状exit status 1を期待しており、D1の実装に伴いexit status 2を期待するよう更新が必要（PLAN.mdの変更単位1で申し送る）。
