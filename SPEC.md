# SPEC: Codex core review の reasoning effort を high に固定する

- Issue: `ISSUE-814`
- 作成者: `run-8538867a`
- 対象ブランチ: `bugfix/814-codex-core-review-high`
- related_adrs: `ADR-0031`, `ADR-0079`

## 目的・背景

agent-skill-chain 自身のコア変更・コア監査で Codex を独立 gate reviewer として使う場合、現在の必須 reasoning effort `xhigh` を `high` に置き換える。`gpt-5.6-sol` と read-only の安全境界、Strict review、独立 reviewer 2 体、証跡検証は維持しつつ、利用者の運用方針と一致しない実行時間・コストの増加をなくす。

本成果物における「Codex core review」は、登録済み core 対象または `core_audit` と判定され、Codex adapter で行う独立 gate review を指す。「必須 tuple」は model、reasoning effort、書込み権限の組である。入力は protected project policy、core 判定、選択 adapter、reviewer context、起動・証跡 attestation であり、出力は検証済み reviewer 起動と review evidence、または不一致時の `human_required` である。

## 要求 → 要件 → 受入条件

### 要求

Codex core review の必須 reasoning effort を `xhigh` から `high` へ恒久的に置き換え、policy、reviewer context、adapter 起動、証跡、テスト fixture、規範文書を同じ契約へ同期する。Codex 以外の adapter、通常 worker、過去の固定 bootstrap 証跡の契約は変更しない。

### 要件

- Codex core review の唯一の有効な必須 tuple は `gpt-5.6-sol / high / read-only` とする。
- reviewer context、Codex adapter、review evidence は同じ必須 tuple を検証・記録し、model、effort、read-only のいずれかを証明できなければ承認しない。
- 現行 core policy を表す schema、型、policy、規範文書、テスト、fixture の `xhigh` 期待値を `high` へ同期する。
- Claude adapter の `frontier_coding / maximum_reasoning / read-only` 能力契約、human adapter の `human_required`、Strict reviewer 数と独立性を維持する。
- 通常 worker が取り得る reasoning effort としての `xhigh`、通常 implementation worker の `high`、固定 SHA の bootstrap 履歴、完了済み履歴文書は変更しない。

### 期待される影響範囲

現行ツリーの実測で、値または期待値の更新対象は `.agent-skill-chain/project/manifest.yaml`、`.agent-skill-chain/schemas/project-policy.schema.yaml`、`.agent-skill-chain/project/MODEL_TIER_TABLE.md`、`docs/adr/ADR-0009-core-review-provider-capability-policy.md`、`src/lib/model-selection.ts`、ならびに core review を扱う `test/unit/model-selection.test.ts`、`test/unit/review-evidence.test.ts`、`test/integration/self-extension-policy.test.ts`、`test/integration/gate-judgment.test.ts`、`test/integration/gate-adapters.test.ts`、`test/integration/gate-evidence.test.ts`、`test/integration/gate-round-budget-convergence.test.ts`、`test/integration/gate-gh-slurp-compat.test.ts`、`test/integration/gate-submit-evidence-reachability.test.ts` である。

`src/commands/gate.ts`、`src/lib/review-evidence.ts`、`.agent-skill-chain/scripts/gate-launch-reviewer.sh`、`.agent-skill-chain/adapters/codex.sh` は policy 値を伝播・照合する観測対象であり、AC を満たすために既存の汎用処理変更が必要かをテストで判定する。上記以外の `xhigh` は、通常 worker、汎用 enum、固定 bootstrap、完了済み履歴のいずれかとして本 Issue の置換対象外である。

### 受入条件（Acceptance Criteria）

#### AC-1: Codex core review の必須 tuple が high で一意に定まる

- Given: core review が必要で、選択 adapter が Codex である
- When: protected project policy とその schema・型から必須能力を解決する
- Then: 有効な必須 tuple は `gpt-5.6-sol / high / read-only` だけであり、Strict profile と独立 reviewer 2 体の要求も維持される
- 検証方法見込み: `automated`

#### AC-2: reviewer context・起動・証跡が同じ tuple を検証する

- Given: Codex による Strict core gate review の target SHA と reviewer context がある
- When: reviewer を起動し、その review evidence を検証・記録する
- Then: context は model `gpt-5.6-sol` と effort `high` を要求し、adapter の実効起動列と override attestation、および evidence は同じ model・effort と read-only を証明する。不一致または未証明なら `human_required` となる
- 検証方法見込み: `automated`

#### AC-3: policy・fixture・テスト・文書が同期する

- Given: 現行の Codex core policy を表す schema、型、policy、fixture、テスト、規範文書がある
- When: repository の静的検査、対象単体・結合テスト、文書同期検査を実行する
- Then: すべてが `high` を必須値として一致して成功し、現行 Codex core policy の必須値として `xhigh` を期待する記述が残らない
- 検証方法見込み: `automated`

#### AC-4: Codex core review 以外の capability 契約が変わらない

- Given: Claude・human adapter、通常 worker、固定 bootstrap に既存の独立した契約がある
- When: Issue の変更前後の policy と回帰テストを比較する
- Then: Claude の `frontier_coding / maximum_reasoning / read-only`、human の `human_required`、通常 worker の effort 値域と既定、固定 bootstrap 証跡の期待値は変更されない
- 検証方法見込み: `automated`

#### AC-5: xhigh は Codex core review の代替値として拒否される

- Given: model が `gpt-5.6-sol` で read-only が証明されているが、reasoning effort だけが `xhigh` の Codex core reviewer 起動または evidence がある
- When: adapter または evidence verifier が現行 core policy と照合する
- Then: `xhigh` は `high` の代替として受理されず、reviewer は承認・成功へ進まず `human_required` となる
- 検証方法見込み: `automated`

## 制約・完了条件・未決事項

- policy の必須値そのものを置き換え、`xhigh` を許す例外分岐や互換フラグは追加しない。
- 設定・schema・型・文書・fixture・テストを同一変更で同期し、全 AC の自動証跡を `VALIDATION.md` に記録できることを完了条件とする。
- 未決事項はない。

## スコープ外

- Issue #798 の cleanup 設計・実装。
- 通常 worker の reasoning effort 値域、通常 implementation worker の既存 `high` 設定、任意の `xhigh` override。
- Claude Code の model 名・最大 reasoning probe・capability attestation、human adapter の挙動。
- 固定 SHA に束縛された bootstrap ledger、完了済み履歴文書、non-core Codex reviewer の契約。
- 新しい adapter、fallback、設定項目、互換フラグ、ADR の追加。
