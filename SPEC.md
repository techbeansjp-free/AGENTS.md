# SPEC: worker・core gate review の reasoning 上限を high に統一する

- Issue: `ISSUE-814`
- 作成者: `run-8538867a`
- 対象ブランチ: `bugfix/814-codex-core-review-high`
- related_adrs: `ADR-0031`, `ADR-0079`

## 目的・背景

agent-skill-chain の現行 runtime で worker または gate reviewer を起動する設定・policy・adapter が、`xhigh` または `maximum_reasoning` を要求・許可できる状態を廃止し、利用可能な reasoning effort の上限を `high` にする。特にコア変更・コア監査の独立 gate review は、進行役や adapter が Codex と Claude Code のどちらであっても `high` を必須とする。Strict profile、独立 reviewer 2体、read-only、証跡検証、不一致時の fail-closed は維持する。

本成果物で「現行 runtime 契約」とは、worker または gate reviewer の選択・設定検証・起動・attestation・証跡検証に現在使われる config、schema、型、CLI、adapter、登録済み project policy を指す。過去の判断を記録する ADR と、固定 SHA の一回限り bootstrap ledger およびその履歴整合性検証は現行 runtime の選択肢ではなく、改変しない歴史的証跡である。

## 要求 → 要件 → 受入条件

### 要求

全 core gate reviewer の reasoning effort を provider 共通で `high` に訂正する。同時に worker と gate reviewer の現行 runtime 設定から `xhigh` / `maximum_reasoning` の許可経路を除去し、policy、schema、型、CLI、adapter、証跡、テスト、登録済み規範文書を同じ契約へ同期する。過去の ADR と bootstrap 証跡は書き換えず、新しい決定を現行成果物と生きた policy に記述する。

### 要件

- core Codex reviewer の唯一の有効な tuple は `gpt-5.6-sol / high / read-only` とする。
- core Claude reviewer は実行環境が宣言する実在モデルを使い、reasoning tier `high` の attestation、実行環境固有 probe の成功、read-only を必須とする。Codex 固有の model slug や設定 key は使わない。
- core capability、reviewer context、adapter 起動、review evidence は同じ `high` 契約を伝播・記録・検証する。model、`high`、probe、read-only の必要な証明が欠ける場合は承認せず `human_required` とする。
- Strict profile、独立 reviewer 2体、conformance と falsification、target SHA・digest・protected-base・slot の証跡要件は変更しない。
- worker と gate reviewer の現行 runtime 設定で許される reasoning effort は `medium` と `high` に限定し、`high` を上限とする。core gate review はそのうち `high` だけを許す。
- config、project policy、schema、型、CLI help/context、worker・reviewer adapter、環境上書き、evidence verifier、登録済み規範文書、fixture、テストを同期し、`xhigh` / `maximum_reasoning` を現行実行値として受理する経路を残さない。
- `xhigh` / `maximum_reasoning` を config、project policy、環境上書き、attestation、probe 入力、review evidence のいずれから与えても、起動または承認へ進めず、設定エラーまたは `human_required` へ安全側に停止する。
- ADR は status にかかわらず過去判断の記録として本文を変更しない。固定 bootstrap ledger と、その固定証跡を検証するコード・fixture も変更しない。現行値の検索結果では、この歴史的集合と完了済み履歴だけを許容する。

### 期待される影響範囲

変更対象は、現行 runtime 契約を保持・伝播する `.agent-skill-chain/config/agent-skill-chain.yaml`、config schema、project policy manifest/schema、登録済み model/role policy、worker・core review の型と context、Codex/Claude adapter、review evidence verifier、および対応する unit/integration test と fixture である。既に `high` の正しい値を持つ asset は、回帰検証対象として維持する。

`docs/adr/`、bootstrap ledger、その固定 SHA 証跡用 command と test fixture は変更対象外である。accepted ADR に `xhigh` / `maximum_reasoning` を現行必須値として固定する判断は実測されておらず、ADR-0009 と ADR-0015 は `proposed`、ADR-0031 は Strict 優先、ADR-0079 は model identifier と fail-closed 境界を扱うため、新規 ADR は不要である。

### 受入条件（Acceptance Criteria）

#### AC-1: core review の共通 reasoning 契約が high になる

- Given: core review が必要で、reviewer adapter として Codex または Claude Code が選択される
- When: protected project policy、schema、型、reviewer context から必須能力を解決する
- Then: reasoning tier は `high` だけであり、Strict profile、独立 reviewer 2体、read-only、fail-closed の要求は維持される
- 検証方法見込み: `automated`

#### AC-2: Codex core reviewer は正確な tuple だけで起動・承認される

- Given: Codex による core gate review の target SHA と reviewer context がある
- When: adapter を起動し review evidence を記録・検証する
- Then: `gpt-5.6-sol / high / read-only` の完全一致だけが受理され、model・effort・read-only・override attestation の不一致または未証明は `human_required` となる
- 検証方法見込み: `automated`

#### AC-3: Claude core reviewer は runtime 固有の high 証明だけで起動・承認される

- Given: Claude Code による core gate review と、実行環境が宣言した実在 model がある
- When: adapter が model 指定、reasoning attestation、runtime 固有 probe、read-only を検証し evidence を記録する
- Then: reasoning と capability reasoning tier の双方が `high` と記録され、probe 成功を含む全証明が揃った場合だけ受理される。`maximum_reasoning`、`xhigh`、probe 不足、provider 不一致は `human_required` となる
- 検証方法見込み: `automated`

#### AC-4: worker と gate reviewer の現行設定は high を超えられない

- Given: worker または non-core/core gate reviewer の config、CLI context、adapter 環境上書きがある
- When: reasoning effort を設定・解決・起動する
- Then: 許容集合は `medium` と `high` だけで、`xhigh` / `maximum_reasoning` は schema、型、実行時検査のいずれかで起動前に拒否される。既定・恒久 worker 設定の `high` は維持される
- 検証方法見込み: `automated`

#### AC-5: active policy・adapter・evidence・文書が high に同期する

- Given: 現行 runtime 契約を表す config、schema、型、CLI、adapter、project policy、規範文書、fixture がある
- When: 対象単体・結合テストと対象限定の静的検索を実行する
- Then: 全伝播先が `high` に一致し、生きた worker/gate 設定または許可経路として `xhigh` / `maximum_reasoning` が残らない
- 検証方法見込み: `automated`

#### AC-6: 不正な旧値は fail-closed となる

- Given: 正しい model と read-only を持つが reasoning だけが `xhigh` または `maximum_reasoning` の設定、起動値、attestation、evidence がある
- When: worker/gate の設定検証、adapter、evidence verifier の該当境界へ入力する
- Then: fallback、暗黙 downgrade、互換フラグを使わず、設定エラーまたは `human_required` となり、worker/reviewer 起動や gate success へ進まない
- 検証方法見込み: `automated`

#### AC-7: 歴史的 ADR と bootstrap 証跡が不変である

- Given: `xhigh` / `maximum_reasoning` を記録する既存 ADR、固定 bootstrap ledger、履歴整合性検証と fixture がある
- When: ISSUE-814 の変更差分と対象限定検索を確認する
- Then: それらは変更されず、現行 runtime の許可値とは区別され、新規 ADR も追加されていない
- 検証方法見込み: `automated`

## 制約・完了条件・未決事項

- 旧値を許す例外分岐、互換フラグ、fallback は追加せず、原因となる既存の許可値・照合値を `high` 契約へ置換する。
- config/schema/型/policy/adapter/文書/fixture/test を同一実装 checkpoint で同期し、全 AC の証跡を独立検証で記録できることを完了条件とする。
- 未決事項はない。

## スコープ外

- Issue #798 の cleanup。
- provider の具体的 model 世代変更、Claude model 名の固定、Codex/Claude 以外の新規 adapter。
- Strict reviewer 数、独立性、read-only、evidence digest、protected-base、trusted recorder の設計変更。
- 既存 ADR の本文・status、固定 bootstrap ledger・command・fixture、完了済み履歴の改変。
- 新しい設定項目、互換フラグ、fallback、新規 ADR。
