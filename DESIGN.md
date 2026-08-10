<!--
正本: AGENTS.md §4セグメント・4ゲート
このファイルは Issue 毎に複製して使う雛形である（セグメント: design、成果物: DESIGN.md（PLAN.md は別ファイル）、ゲート: design-gate）。
-->

# DESIGN: AGENTS.mdの`verify-template-sync.sh`パス言及を実在パスへ修正する

- Issue: `ISSUE-553`
- 対応する SPEC: `SPEC.md`

## 要件 → 設計要素の対応表

SPEC.md の要件は「AGENTS.md本文中の`verify-template-sync.sh`パス言及を実在パスへ修正すること」の1点であり、対応する設計要素も1箇所のテキスト修正に限定される。新規コンポーネント・新規スクリプトは導入しない。

| 要件 / AC-ID | 対応する設計要素 | 備考 |
|---|---|---|
| `AC-1`（本文中のパス言及が実在パスと一致） | `AGENTS.md`「GitHub配布・マルチAI対応」節の該当1文中、`.agent-skill-chain/scripts/verify-template-sync.sh` の記載を `.agent-skill-chain/ci/verify-template-sync.sh` に置換する | 同一文中の `setup-labels.sh`・`setup-ruleset.sh` への言及（`.agent-skill-chain/scripts/` 配下、実在パスと既に一致）は変更しない |
| `AC-2`（修正後も自己矛盾しない） | 置換後の記載を「ディレクトリ構成」節の `ci/` 配下ツリー列挙（`verify-template-sync` を含む）と突き合わせる確認手順 | 新規記載の追加ではなく、既存の正しい記載（ディレクトリ構成節）との整合を取るのみ |
| `AC-3`（併記参照の非変更） | `setup-labels.sh`・`setup-ruleset.sh` への言及を変更対象から明示的に除外する編集範囲の限定 | 置換対象の文字列パターンを `.agent-skill-chain/scripts/verify-template-sync.sh` に限定することで担保する |

## 責務・境界

### コンポーネント構成

本変更は実行コード・スキーマ・設定を一切変更せず、`AGENTS.md`（規範文書）内の1箇所のテキスト記載を実在パスに合わせて修正するのみである。新設・変更するコンポーネントは無い。

- `AGENTS.md`「GitHub配布・マルチAI対応」節: 唯一の変更対象。誤記載パス文字列を実在パス文字列へ置換する責務のみを持つ。

### 依存関係

```text
AGENTS.md（該当1文） -- 記載一致 --> .agent-skill-chain/ci/verify-template-sync.sh（実在ファイル、変更なし）
```

`.agent-skill-chain/ci/verify-template-sync.sh` 自体、CIワークフロー（`.github/workflows/agent-skill-chain-ci.yml`・配布元テンプレート）、`setup-labels.sh`・`setup-ruleset.sh` への言及は変更しない。文書側の記載をコード側の実在配置へ追従させる一方向の修正であり、逆方向（コード配置を文書側へ合わせる）は選択しない（詳細は関連ADR参照）。

### 図示要否の判断

- 判断: `不要`
- 根拠: 依存関係は1本（AGENTS.md該当文 → 実在ファイルパスとの記載一致）のみであり3つ未満、状態遷移は無く、責務境界となるコンポーネントも1つのみで3つ未満。上記いずれの図示必須基準にも該当しないため、テキスト矢印表記のままとする。

## 関連ADR

```yaml
related_adrs:
  - id: ADR-0040
    relation: adopts
```

`ADR-0040-agents-md-verify-template-sync-path-doc-only-fix.md` は本Issue起票時点で `status: proposed` である。AGENTS.md「ADR・テンプレート・テスト適用性」節が定めるADRライフサイクル（`proposed → accepted`、設計ゲート承認時にfinalizationワーカーがwriter lease取得の上statusのみ更新）に従い、本design-gateの承認をもって `status: accepted` へ更新する手続きが必要になる。この更新作業自体は本design-gate承認後にfinalizationワーカーが行うものであり、本DESIGN.mdの作成（design_worker、writer lease保有）では実施しない。

## 障害・ロールバック考慮

- 想定される失敗モード: 置換対象の文字列パターンを誤って広く指定した場合、`setup-labels.sh`・`setup-ruleset.sh` への正しい既存パス記載や「ディレクトリ構成」節の `ci/` 配下ツリー列挙まで意図せず書き換えてしまうリスクがある。実装セグメントでは `.agent-skill-chain/scripts/verify-template-sync.sh` という完全一致文字列のみを対象とし、他の言及箇所（`setup-labels.sh`・`setup-ruleset.sh`・「ディレクトリ構成」節）を変更前後で diff 確認する。
- ロールバック手順: 本変更は `AGENTS.md` 内の1行相当のテキスト置換のみであり、実行コード・スキーマ・設定への影響が無いため、当該 commit を `git revert` するだけで完全に元の記載へ戻せる。
- 影響を受ける既存機能: 無し。`.agent-skill-chain/ci/verify-template-sync.sh` の実装・呼び出し元（CIワークフロー）・スキーマ・設定はいずれも変更しないため、実行時の挙動に影響しない。影響は「AGENTS.mdを読む人間・AIエージェントが参照するパス文字列」という文書の記載内容のみに限定される。
