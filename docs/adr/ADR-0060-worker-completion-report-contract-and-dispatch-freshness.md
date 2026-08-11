# ADR

```yaml
id: ADR-0060
status: proposed
title: worker完了報告手順をcontract生成側で機械的に付加し、dispatch起点の鮮度判定で完了確認を安全側化する
tags: [worker-launch, worker-launch-verify, report-status, agent-tool-dispatch, roles-yaml]
supersedes: []
superseded-by: null
deprecated-reason: null
```

## Context

`.agent-skill-chain/scripts/worker-launch-verify.sh`（および `.agent-skill-chain/adapters/claude.sh` の `launch_worker` 末尾のインライン完了確認）は、segment worker（spec/design/implementation/validation）の完了確認として「workerが `report-status.sh <issue_id> <role> <segment> completed <push済みHEAD>` を投稿済みであること」を要求する。

一方、workerへ実際に配達される契約は `src/commands/segment.ts` の `segment start` が組み立てる出力（`.agent-skill-chain/config/roles.yaml` の `role_contracts.<role>` のYAMLダンプ）であり、その `completion` 項目はいずれのロールも「commit + push済み」（spec_workerのみDraft PR作成済みを追加）で終わり、`report-status.sh` の実行を求める指示を一切含まない。Agent tool dispatch経路（`_dispatch_via_agent_tool` が組み立てるdispatchプロンプト）も「作業完了後の最終応答は完了状態・target_sha・簡潔な1文要約のみに限定する」とテキスト応答での報告のみを指示し、`report-status.sh` の実行には言及しない。

この結果、契約に忠実に従ったworkerほど報告を行わずに終了し、完了確認は「report不在」（当該segment初回起動時）または「前サイクルの古いcompleted report」（2回目以降の起動時、報告済みtarget_shaが常に前サイクルの値、現在HEADが直後に確定する新サイクルの値と一致する）を観測してblocked判定を返す。由来Issue（`techbeansjp/chintainet-wp-theme` #55）の実測では10/10がblockedとなり、いずれも人間エスカレーション経由の事後補填で矛盾なくcompletedが確定していた。判定ロジック自体（報告済みstatus・target_shaと現在HEADの一致確認）は入力に対して正しく動作しており、誤っているのは「報告が行われる」という前提である。

### 検討した選択肢

1. **各ロールの `config/roles.yaml` `role_contracts.<role>.completion` へ個別に報告手順を追記する。**
   宣言的で単純だが、consumer projectが独自にカスタマイズした `roles.yaml` には反映されず、将来ロールが追加された場合にも追記漏れが再発しうる。修正の実効性がconsumer側の追随作業に依存してしまい、本Issueの根本原因（「契約に配達される保証がない」）を再生産する。
2. **Agent tool dispatchプロンプトのみへ報告指示を追加し、contract本体（`role_contracts.<role>`）は変更しない。**
   `_dispatch_via_agent_tool` 経由のAgent tool dispatch以外の起動系（headless subprocess、Codex直接実行、人間が `segment start` の出力をそのまま読む場合）ではcontract本体だけが唯一の指示経路であり、dispatchプロンプトが届かない場合に報告指示が欠落したままになる。SPEC.mdのAC-1（contract本体への付加）とAC-2（dispatchプロンプトへの付加）は独立した要求であり、この案はAC-1を満たさない。
3. **（採用・contractへの付加）`segment start`（生成側）が全ロール共通の完了報告ブロックをcontract末尾へ常に機械的に付加し、かつ `_dispatch_via_agent_tool` のdispatchプロンプトにも同旨を明記する（二重化）。**
   `role_contracts.<role>` の個別テキストではなく生成コード側で付加するため、consumer側 `roles.yaml` の編集有無・将来のロール追加に依存せず一貫して報告手順が配達される。dispatchプロンプト側にも明記することで、Agent tool dispatch経路では「最上位で明示される指示」としての冗長性を持たせる（dispatch経由でworkerへ渡る指示のうち、dispatchプロンプト自体がAgentへの最初の指示であり、そこに報告手順が無いと契約本体を読む前の時点で完了時の挙動が固まってしまう懸念に対応する）。
4. **鮮度判定（前サイクルの古い報告を完了根拠として採用しない）の実現方式として、(a) `report latest` にdispatch起点時刻との比較用 `created_at` を追加する時刻ベース比較と、(b) `worker-report.schema.yaml` へdispatch識別子フィールドを追加しreport-status呼び出し時に埋め込ませる識別子ベース比較を検討した。**
   識別子ベース（b）はスキーマ変更（`additionalProperties: false` の `worker-report.schema.yaml` へのフィールド追加、`schema_version` bump要否の検討、consumer側の既存reportとの後方互換）を要し、影響範囲がスキーマ全体・全報告経路に及ぶ。時刻ベース（a）は `report latest` の出力へ1行追加するだけで実現でき、既存の `status=`/`target_sha=` 抽出パターンとの後方互換を保ったまま影響範囲を出力拡張に限定できるため、時刻ベース比較を採用する。

## Decision

1. **contractへの機械的付加（AC-1）**: `src/commands/segment.ts` の `segment start` が、`role_contracts.<role>` のYAMLダンプに続けて、spec/design/implementation/validationの4ロール共通で、issue_id・role・segmentを埋め込んだ固定形式の完了報告手順ブロック（`report-status.sh <issue_id> <role> <segment> completed <push済みHEAD>` の実行を明示する指示）を付加する。挿入位置はYAMLダンプの**後**に限定し、既存のrole抽出（`sed -n 's/^role:[[:space:]]*//p'` による先頭行抽出）に影響を与えない。`config/roles.yaml` の `role_contracts.*.completion` 本文自体は変更しない。
2. **dispatchプロンプトへの明記（AC-2）**: `.agent-skill-chain/adapters/claude.sh` の `_dispatch_via_agent_tool` が組み立てるdispatchプロンプト（claude分岐・codex分岐の両方）へ、成果物のcommit・push後にreport-status投稿を実行してから最終応答するよう明示する一文を、既存の「最終応答は完了状態・target_sha・簡潔な1文要約のみに限定する」という指示の直前に追加する。既存指示文言そのものは変更しない。
3. **dispatch起点の記録と鮮度判定（AC-4）**: `_dispatch_via_agent_tool` は `dispatch_temp_dir` 作成直後にUTC ISO8601形式の現在時刻を取得し、既存の監査ファイル `contract.sha256`（`CONTRACT_SHA256`/`CONTRACT_LINES` を保持）へ `DISPATCH_STARTED_AT` として追記する。`src/commands/report.ts` の `report latest` は、既存の `status=`/`target_sha=` 出力に加えて `created_at=<UTC ISO8601>`（ローカルモードはreportファイルのmtime、GitHubモードは取得済みコメントの `createdAt`）を出力する。完了確認は、`report latest` が返す `created_at` が `DISPATCH_STARTED_AT`（またはheadless経路ではworker起動直前に取得したローカル時刻）より前である場合、その報告を今回サイクルの完了根拠として採用しない。
4. **判定ロジックの一本化とblocked_reason文言の分離（AC-5）**: `.agent-skill-chain/adapters/claude.sh` に共通の完了判定ヘルパーを新設し、`worker-launch-verify.sh` と `launch_worker` 末尾のインライン完了確認の両方がこれを呼ぶ形へ置き換える。判定結果は3通りに分離する。(a) 報告が1件も存在しない、または存在するが今回サイクルより前（dispatch開始前）に作成されたものだけの場合は「workerがreportを投稿していません（契約不履行の可能性）」という一意な理由を返す。(b) 今回サイクルの報告が存在するがstatusまたはtarget_shaが不一致の場合は、既存踏襲の診断的な理由（報告status・報告target_sha・現在HEADを含む）を返す。(c) 今回サイクルの `completed` かつ `target_sha` 一致の場合は合格とする。(a)と(b)を明確に分離することで、前サイクルの報告との取り違えを示唆する文言が「報告が存在しない」ケースに混入することを防ぐ。
5. **既存completion条件の非変更（AC-6）**: 上記いずれも `.agent-skill-chain/config/roles.yaml` の既存 `completion` 項目（commit + push済み、spec_workerのDraft PR作成済み等）・`.agent-skill-chain/schemas/worker-report.schema.yaml` の構造を変更しない。追加した報告手順・鮮度判定は既存条件への上乗せとしてのみ働く。

## Consequences

- 利点: 契約に忠実に従うworkerが自動的に完了報告手順を実行するようになり、由来Issueで観測された10/10のfalse-positive blockedパターン（報告不在・前サイクル取り違え）が構造的に解消される。生成側（`segment start`）での付加により、consumer projectが `roles.yaml` を個別編集する必要がなく、将来ロールが追加された場合も同一の付加ロジックが自動的に適用される。鮮度判定・判定文言の一本化により、`worker-launch-verify.sh` と `launch_worker` インライン確認の2箇所で判定ロジック・blocked_reason文言が将来的に乖離するリスクを排除する。
- 欠点: `report latest` の出力形式が1行増える（既存の `status=`/`target_sha=` 抽出との後方互換は保つが、出力全体を厳密な行数で扱う独自ツールが仮に存在する場合は影響し得る）。`contract.sha256` の監査ファイルに新しいキー（`DISPATCH_STARTED_AT`）が増え、これを必須項目として扱うことで、当該キーを欠いた古い形式のdispatch一時ディレクトリが万一残存していた場合（プロセスクラッシュ後の残骸等）は監査証跡欠落としてblocked扱いになる（安全側の挙動として意図的）。
- フォローアップ: `.agent-skill-chain/standards/AGENT_TOOL_DISPATCH.md` は本ADRの決定内容が確定した実装セグメントで、実際の挙動に合わせて更新する（ドキュメントの現状追従であり、新たな決定ではないため本ADRの対象外）。将来、report-status呼び出しにdispatch識別子を持たせる方式（検討したが却下した選択肢4-(b)）へ切り替える必要が生じた場合は、`worker-report.schema.yaml` のスキーマ変更を伴う新規ADRを作成し、本ADRとの関係を `supersedes`/`superseded-by` で記録する。
