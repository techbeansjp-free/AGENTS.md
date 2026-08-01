# DESIGN: project固有ポリシー(manifest.yaml登録文書)がsegment start経由でワーカーへ配布されない

- Issue: `ISSUE-326`
- 対応する SPEC: `SPEC.md`

## 要件 → 設計要素の対応表

| 要件 / AC-ID | 対応する設計要素 | 備考 |
|---|---|---|
| `AC-1`（documents.commonの配布） | `src/lib/project-policy.ts`（新規）の `loadProjectPolicyDocuments` | manifest.yaml読込・検証・文書内容連結を担う |
| `AC-2`（documents.roles.<segment>の配布） | 同上、`segment` 引数によるフィルタリング | セグメント名をキーに `documents.roles.<segment>` のみ選択する |
| `AC-3`（manifest.yaml不在時の後方互換） | `loadProjectPolicyDocuments` の存在チェック、`src/commands/segment.ts` の呼び出し側 | `fs.existsSync` がfalseなら空配列を返し、`start()` 側で出力へ何も追加しない |
| `AC-4`（スキーマ不正時のfail-safe） | `loadProjectPolicyDocuments` 内の `validateAgainstSchema` 呼び出し | 既存の `loadCoreReviewPolicy`（`src/lib/model-selection.ts`）と同一パターンでスキーマ不正時に例外を投げる |
| `AC-5`（既存動作への非破壊） | `test/unit/segment.test.ts`（既存）・`test/integration/self-extension-policy.test.ts`（既存） | 新規回帰テストを追加し、既存テストは変更しない |
| `AC-6`（登録文書の実体欠落時のfail-safe） | `loadProjectPolicyDocuments` 内の `fs.readFileSync` 呼び出し、`src/commands/segment.ts` の `start()` を包む `guard()`（`src/lib/cli-io.ts`） | 登録パスに対応する実ファイルが存在しない・読み取れない場合、`fs.readFileSync` が例外を送出する。`loadProjectPolicyDocuments` はこれを独自に捕捉せず、`start()` を呼び出す `guard()` が任意の例外を捕捉して非0終了コードへ正規化する既存の共通パスをそのまま用いる。AC-4（スキーマ不正時のfail-safe）とは独立した契約だが、fail-safeの実現手段（`loadProjectPolicyDocuments` からの例外送出＋`guard()` による捕捉）は共通である |

## 責務・境界

### コンポーネント構成

- `src/lib/project-policy.ts`（新規）: `.agent-skill-chain/project/manifest.yaml` の読込・スキーマ検証・`documents.common` ＋ `documents.roles.<segment>` に登録されたファイルパスの解決・内容読込を行う。他モジュールから再利用可能な形にする（`src/lib/model-selection.ts` の `loadCoreReviewPolicy` は `model_selection` フィールドのみを見るため責務が異なり、統合しない）。
- `src/commands/segment.ts`（既存、変更）: `start()` 内で `loadProjectPolicyDocuments(root, segment)` を呼び出し、返却された文書内容を `role_contract` の前後いずれかに追加してプロンプト文字列を組み立てる。manifest.yaml読込・検証のロジック自体は持たない（`project-policy.ts` に委譲）。

### 依存関係

```text
src/commands/segment.ts → src/lib/project-policy.ts → src/lib/yaml-io.ts（readYamlFile）
                                                     → src/lib/schema.ts（validateAgainstSchema）
                                                     → node:fs（documents配下の各ファイル読込）
```

循環依存なし。`project-policy.ts` は `segment.ts` に依存しない。

## 関連ADR

本Issueは既存の仕様（AGENTS.md「プロジェクト固有ポリシー」節）と実装のギャップを埋めるバグ修正であり、新たな設計判断・トレードオフを伴わない。関連ADRなし。

## 障害・ロールバック考慮

- 想定される失敗モード: manifest.yamlのYAMLパース失敗、`documents.common`/`documents.roles.<segment>` に列挙されたファイルが実在しない、スキーマ不正。いずれも `loadProjectPolicyDocuments` が例外を投げ、`segment start` が非0終了コードで失敗する（サイレントに空文字列を返さない。I8）。
- ロールバック手順: 本Issueの変更はコード追加（新規モジュール）＋ `segment.ts` への呼び出し追加のみで、既存スキーマ・既存ファイル形式を変更しない。問題発生時は本PRのcommitをrevertするだけで旧動作（`role_contract` のみ）に戻る。
- 影響を受ける既存機能: `agent-skill-chain segment start` の出力を消費する箇所（`.agent-skill-chain/scripts/worker-launch.sh` 経由でワーカーへ渡すプロンプト）。manifest.yaml未導入のconsumer projectでは出力が変わらないため影響なし。本リポジトリ（manifest.yaml導入済み）では出力にproject policy文書が追加されるため、既存の出力内容に依存したテストがあれば更新が必要（`test/unit/segment.test.ts` を確認・要修正）。
