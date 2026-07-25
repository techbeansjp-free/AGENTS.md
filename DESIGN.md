# DESIGN: 非coreのStrictゲートで独立レビュア2体を強制する

- Issue: `ISSUE-277`
- 対応する SPEC: `SPEC.md`

## 目的・前提・入出力

目的は、一般ゲートのStrict起動を「2つの独立invocation」と「trusted aggregation」へ分離し、件数だけを満たす複製・別対象の混在・片側失敗を成功にしないことである。入力はIssue、gate、target SHA、profile、対象成果物、選択adapterである。出力は2件のsub-verdict証跡を内包するgate reportと、GitHubモードでは同じSHAのrequired Checkである。trusted CLIとlauncherだけが調整状態を書き、レビュアはread-onlyとする。

## 要件 → 設計要素の対応表

| 要件 / AC-ID | 対応する設計要素 | 備考 |
|---|---|---|
| AC-1 | Strict session preparer / slot launcher | 固定2 slotを別invocationで起動 |
| AC-2 | Strict verdict aggregator / schema | provenance・対象・優先順位を検査 |
| AC-3 | Provider-neutral adapter boundary | 実在adapterを2回起動し、不能時停止 |
| AC-4 | Standard direct path | 既存1体・順次2観点を維持 |
| AC-5 | Core integration seam | coreモデル選択を持たず共通集約だけ提供 |

## 責務・境界

### Strict session preparer

trusted CLIの`gate strict-prepare`は、`review_profile: strict`かつ`pending`の最終reportだけを受け入れる。`reviewer-1`と`reviewer-2`へ一回限りのUUIDを発行し、同一Issue・gate・SHA・profileを持つ2つのscratch reportとprivate session manifestを作る。manifestは未消費状態を持ち、同じsessionの再集約を拒否する。scratch reportは成果物branchの外にあるruntime領域へ置く。

### Slot launcher

`gate-launch-reviewer.sh`はStandardなら従来どおりadapterを1回直接起動する。Strictならpreparerの固定2 slotを別subprocessとして並列起動し、各adapterへ自slot・invocation・専用scratch reportだけを渡す。レビュアプロンプトは対象成果物と自provenanceだけから生成し、peer reportを入力に含めない。

Claude Code、Codex、humanのmodel名や能力を共通化しない。選択済みadapterの既存起動契約を2回使い、CLI・認証・2回目の起動・human通知のいずれかが成立しなければscratch resultを`human_required`にする。

### Strict verdict aggregator

trusted CLIの`gate aggregate-strict`はsessionを一度だけ消費し、次を順に検査する。

1. reportが2件で、slot集合が`reviewer-1`・`reviewer-2`、invocation UUIDとreport pathが相互に異なる。
2. manifest、scratch report、最終reportのIssue・gate・target SHA・`strict`が完全一致する。
3. 各sub-verdictのschema、完了状態、finalと2観点・blocking findingの整合が成立する。
4. 不足・不正・`human_required`があれば他方より優先して最終`human_required`、次にいずれかrejectなら`rejected`、両方approveだけを`approved`にする。

最終reportの`reviewers`へ両sub-verdictとprovenanceを保存する。approved artifactのpath/digest集合が一致しない場合も対象証跡が一致しないため`human_required`とする。publishは`review_profile: strict`のapproved reportに正しい2件が無ければ拒否する。

### Gate report schema

既存v1へ後方互換なoptionalフィールド`review_profile`、`review_invocation`、`reviewers`を追加する。新規scaffoldはprofileを必ず記録する。`review_invocation`はscratch専用、`reviewers`は集約後の最終証跡である。Standardの既存reportとconsumerは追加フィールドを要求されないが、新規Strict reportの成功条件はtrusted CLIが強制する。

## 依存関係とデータフロー

```text
gate review → strict-prepare → reviewer-1 ─┐
                              reviewer-2 ─┴→ aggregate-strict → gate publish
                                  │                         │
                         read-only artifacts        final report / Check
```

依存はlauncherからadapter、adapterからraw判定、aggregatorからpublishへの一方向である。adapterはpeer結果、最終状態、Checks APIを所有しない。

## PR #274との統合境界

本Issueはmain上で一般Strict集約を自己完結させる。PR #274のcore分類・Codex Action・provider能力選択は本設計へ移さない。両PRはlauncher、gate command、workflowで競合するため、先にmergeされた側をbaseに後続PRをrebaseし、core専用起動が生成する2結果も本設計のscratch reportとaggregatorへ結線する。PR #274の件数だけの配列集約はprovenanceを満たさないため残さない。

## 障害・ロールバック考慮

- prepare、片側起動、schema、session消費、集約の失敗は最終reportを`human_required`にし、GitHubでは`action_required`を発行する。
- scratch/runtime cleanup失敗は成功を覆してerrorとし、対象pathを秘密値なしで記録する。
- rollbackはschema optional項目、strict commands、launcher分岐、テストを同時に戻す。Standard direct pathは変更前と同じため影響を受けない。
- 4ゲート、Check名、coreモデル選択、外部credential値は変更しない。

## 完了条件・未決事項・関連ADR

正常2件、1件、重複、replay、別SHA、片側失敗、rejectとhuman_required混合、全adapter、Standard回帰を自動検証する。未決事項はない。

```yaml
related_adrs: []
```
