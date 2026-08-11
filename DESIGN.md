# DESIGN: 配布テンプレートからdependabot.ymlを削除する

- Issue: `ISSUE-611`
- 対応する SPEC: `SPEC.md`

## 要件 → 設計要素の対応表

| 要件 / AC-ID | 対応する設計要素 | 備考 |
|---|---|---|
| `AC-1`（新規導入consumerにdependabot.ymlが配置されない） | `配布元ファイル削除: .agent-skill-chain/templates/github/.github/dependabot.yml` | 配布元ディレクトリツリーに存在しないファイルは `sync templates`/`init`/`setup github` の展開処理（配布元ツリーをそのまま展開先へコピーする既存ロジック）が対象としないため、コード変更なしにAC-1を満たす。 |
| `AC-2`（seed-only manifestからdependabot.ymlエントリ削除） | `manifest更新: .agent-skill-chain/templates/github/.github.seed-only.yaml` | `paths:` から `dependabot.yml` を除去し `CODEOWNERS` のみ残す。 |
| `AC-3`（配布元にdependabot.ymlが存在しない状態でverify template-syncが整合） | `既存テスト更新: test/integration/verify.test.ts` の該当ケース | 配布元にファイルが存在しない前提へテストシナリオを是正する（後述「既存テストの是正方針」）。`computeTemplateSyncDiffs`（`src/lib/template-sync.ts`）自体は無変更。 |
| `AC-4`（dependabot-ci-skip判定ロジックに回帰が無い） | `変更対象外の確認: .github/workflows/agent-skill-chain-ci.yml` の `skip_checks` 判定 | 下記「AC-4の設計時確認結果」のとおりコード変更不要と確認済み。 |
| `AC-5`（dogfooding用 `.github/dependabot.yml` が変更されない） | `変更対象外の明示: リポジトリ本体 .github/dependabot.yml` | 本Issueの変更範囲（配布元 `.agent-skill-chain/templates/github/.github/` 配下と `.github.seed-only.yaml`）に含めない。 |

## 責務・境界

### コンポーネント構成

- `配布元テンプレートツリー`（`.agent-skill-chain/templates/github/.github/`）: consumer projectへ配布するファイル一式の正本。本Issueでは `dependabot.yml` を削除するのみで、他ファイルは変更しない。
- `seed-onlyマニフェスト`（`.agent-skill-chain/templates/github/.github.seed-only.yaml`）: 初回配置後の内容カスタマイズを差分検査対象外とするファイルパスの一覧。`dependabot.yml` エントリを削除し `CODEOWNERS` のみ残す。責務は「初回配置後の乖離許容対象の列挙」のみであり、ファイルの存在有無の判定ロジック自体は持たない。
- `template-sync同期検査`（`src/lib/template-sync.ts` の `computeTemplateSyncDiffs`）: 配布元ツリーと展開先ツリーを比較し欠落・差分を報告する既存ロジック。本Issueでは変更しない——配布元から `dependabot.yml` を削除すれば `sourceFiles`（配布元ツリーの実ファイル一覧）にそのパスが含まれなくなり、欠落検査・差分検査のいずれの対象にも自動的にならなくなるため、ロジック変更は不要。
- `dependabot-ci-skip判定`（`.github/workflows/agent-skill-chain-ci.yml` の `skip_checks` 判定、テンプレート正本は `.agent-skill-chain/templates/github/.github/workflows/agent-skill-chain-ci.yml`）: PR作成者（`pull_request.user.login`）とブランチ起源に基づく汎用判定であり、`dependabot.yml` ファイルの配布有無や内容を一切参照しない。本Issueの変更対象外。

### 依存関係

`配布元テンプレートツリー` の実ファイル集合を `template-sync同期検査` が読み取り、`seed-onlyマニフェスト` の登録パス集合を参照して差分報告を出す、という既存の一方向依存のみが本Issueに関係する。`dependabot-ci-skip判定` は独立しており、上記のいずれとも依存関係を持たない。

```text
配布元テンプレートツリー（dependabot.yml削除） → template-sync同期検査（sourceFiles計算に反映、ロジック無変更）
seed-onlyマニフェスト（dependabot.ymlエントリ削除） → template-sync同期検査（seed-only判定対象から除外、ロジック無変更）
dependabot-ci-skip判定 → （依存なし、変更対象外）
```

### 図示要否の判断

- 判断: `不要`
- 根拠: 変更対象コンポーネントは「配布元ファイルの削除」「manifestエントリの削除」「既存テストの記述更新」の3点であり、依存関係は1本の既存の片方向（配布元ツリー→同期検査ロジックの入力）のみで、新規の状態遷移も発生しない。責務境界も3コンポーネント未満（実質的な変更対象は配布元ツリーとmanifestの2点、同期検査ロジック自体は無変更）であるため、AGENTS.mdの図示必須基準（依存関係3つ以上／状態遷移2つ以上／責務境界3つ以上）のいずれにも該当しない。

## 既存テストの是正方針（AC-3対応）

`test/integration/verify.test.ts` の以下2箇所を、配布元に `dependabot.yml` が存在しない実態に整合させる。

1. `verify template-sync: seed-only指定ファイル（dependabot.yml）が完全に削除された場合は引き続き欠落として検出される（AC-2）` という既存テストケースは、ISSUE-574当時の「配布元に `dependabot.yml` が存在し、展開先でのみ削除された場合」の欠落検出を検証するものであり、本Issue適用後は配布元に当該ファイルが存在しないため前提が成立しなくなる。このテストケースは削除する。同ファイル内の他のseed-onlyケース（CODEOWNERS）はそのまま維持し、CODEOWNERSに対する欠落検出テストパターンを踏襲した新規ケースは追加しない——AC-3が要求するのは「配布元に存在しないファイルを理由とする誤検知が起きないこと」であり、これは既存の `sync templates` 成功パス（`afterSync.status, 0` を検証する既存テスト）が `dependabot.yml` を含まない状態で通ることで既に検証される。
2. 冒頭コメント `// ISSUE-574: seed-onlyファイル（CODEOWNERS・dependabot.yml）は初回配置後の内容カスタマイズを正当な乖離として許容する。AC-1〜AC-3を検証する。` を `CODEOWNERS` のみを列挙する記述へ是正する（AGENTS.mdが定めるコードコメントの陳腐化防止規約に従い、コードから読み取れない「なぜ」以外の逐語的説明・陳腐化した具体例を放置しない）。

`src/lib/template-sync.ts` 内のコメント `ISSUE-574: CODEOWNERS・dependabot.yml等、プロジェクトごとに正当にカスタマイズされうるファイルを、...` も同様に `CODEOWNERS等` へ是正する。この変更はロジック自体（`loadSeedOnlyPaths`・`computeTemplateSyncDiffs`）を変更せず、コメントが指す具体例を実態へ追従させるのみである。

## AC-4の設計時確認結果

`dependabot-ci-skip` 判定（`.github/workflows/agent-skill-chain-ci.yml` の `skip_checks` 出力、および固定テスト `test/unit/dependabot-ci-skip.test.ts`・`test/unit/dependabot-ci-skip-exec.test.ts`）は、PR作成者（`pull_request.user.login`）とブランチ起源のみに基づく判定であり、`dependabot.yml` ファイルの配布・存在・内容のいずれも参照しない（consumerが独自に `dependabot.yml` を設定した場合も対象に含む汎用判定であるため）。ソースコード全体を横断検索した結果、`dependabot` という語を含むソース・テストファイルはこの判定関連のもの、`src/lib/template-sync.ts`（本Issueで変更）、`test/integration/verify.test.ts`（本Issueで是正）の3系統のみであり、`skip_checks` 判定ロジック自体・関連テストのいずれにも `dependabot.yml` ファイルへの参照は無い。したがって本Issueの変更（配布元ファイル削除・manifest更新）はこの判定に影響せず、コード変更・テスト変更のいずれも不要と確認した。

## 関連ADR

```yaml
related_adrs:
  - id: ADR-0047
    relation: adopts
```

## 障害・ロールバック考慮

- 想定される失敗モード: (1) 配布元から `dependabot.yml` を削除したが `.github.seed-only.yaml` の更新漏れにより、存在しないファイルパスが `paths:` に残存し、`loadSeedOnlyPaths` が意味のない集合を返し続ける（実害は無いが陳腐化した記述が残る）。(2) 既存テスト（`verify template-sync` の欠落検出ケース）を削除し忘れ、配布元に存在しないファイルの削除を試みるテストコードがエラーになりCIが失敗する。
- ロールバック手順: 本Issueの変更は「ファイル削除」「manifestエントリ削除」「テストコード・コメント更新」のみであり、実行時状態や外部システムを変更しない。ロールバックは当該PRをrevertする、または `.agent-skill-chain/templates/github/.github/dependabot.yml` を元の内容で復元し `.github.seed-only.yaml` の `paths:` に `dependabot.yml` を再追加し、`test/integration/verify.test.ts` の削除したテストケースを復元するだけで完全に元の状態へ戻せる（Git履歴からの復元のみで完結、データ移行やマイグレーションは不要）。
- 影響を受ける既存機能: 新規導入（`init`）・既存導入への `upgrade`／`sync templates` の展開結果から `dependabot.yml` が無くなる。既に展開済みのconsumer projectの `.github/dependabot.yml` は本Issueの変更では自動削除されず、`verify template-sync` の検査対象外（展開先だけに存在する余剰ファイルは非検知）として残り続ける（SPEC.mdスコープ外に明記済み）。dogfooding用のこのリポジトリ自身の `.github/dependabot.yml` は配布元ツリーの外にあるため無影響。
