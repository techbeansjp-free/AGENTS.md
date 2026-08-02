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
| `AC-6`（登録文書の実体欠落時のfail-safe） | `loadProjectPolicyDocuments` 内の `resolveContainedDocumentPath`（`fs.realpathSync`）・`fs.readFileSync` 呼び出し、`src/commands/segment.ts` の `start()` を包む `guard()`（`src/lib/cli-io.ts`） | 登録パスに対応する実ファイルが存在しない・読み取れない場合、`fs.realpathSync`（存在しない場合）または `fs.readFileSync`（権限等で読み取れない場合）が例外を送出する。`loadProjectPolicyDocuments` はこれを独自に捕捉せず、`start()` を呼び出す `guard()` が任意の例外を捕捉して非0終了コードへ正規化する既存の共通パスをそのまま用いる。AC-4（スキーマ不正時のfail-safe）とは独立した契約だが、fail-safeの実現手段（`loadProjectPolicyDocuments` からの例外送出＋`guard()` による捕捉）は共通である |
| `AC-7`（登録パスの解決範囲逸脱時のfail-safe） | `loadProjectPolicyDocuments` 内の新設ヘルパー `resolveContainedDocumentPath(projectDir, documentPath)` | 各登録パスについて (1) `path.isAbsolute(documentPath)` なら無条件で例外を送出する（下記「絶対パスの扱い」参照）、(2) `path.resolve(projectDir, documentPath)` の字句解決結果が `projectDir` 配下でなければ例外を送出する（`../` 脱出）、(3) `fs.realpathSync` でsymlinkを解決した実体パスが `fs.realpathSync(projectDir)` 配下でなければ例外を送出する（symlink脱出）。(3) の `fs.realpathSync` 呼び出しは実体パスが存在しない場合にも例外を送出するが、これはAC-6（実体欠落）に分類し、AC-7固有の例外とは区別しない（呼び出し元の `guard()` はいずれも同じく非0終了コードへ正規化するため、呼び出し元から見た可観測な振る舞いは同一） |
| `AC-8`（重複登録された文書の出力抑制） | `loadProjectPolicyDocuments` 内の実体パス集合（`Set<string>`）による重複排除 | `documents.common` と `documents.roles.<segment>` を連結した登録パス列を順に処理し、各パスを `resolveContainedDocumentPath` で実体パス（realpath相当）へ正規化した上で、既出の実体パスと一致する場合はその文書の内容を出力へ追加しない。連結順（`documents.common` を先、`documents.roles.<segment>` を後）にかかわらず、実体パスが同一であれば2件目以降を抑制する |

## 設計判断（spec-gate warningへの対応）

spec-gate（`3489369a` 時点）で `severity: warning`/`info` として指摘された3件は、いずれもblockingではないが、実装のブレを防ぐため本節で確定する。

### `roles-key-absent-undefined`（`documents.roles.<segment>` キー自体が不在の場合）

`documents.roles.<segment>` キーが manifest.yaml に存在しない場合（`project-policy.schema.yaml` で segment 別キーは全て optional）と、キーが存在し値が空配列 `[]` の場合を、同一の正常系として扱う。既存実装 `manifest.documents.roles[segment] ?? []` は既にこの振る舞いであり、本Issueでの変更は無い（`??` 演算子により `undefined`・`[]` のいずれも「対象文書0件」に正規化される）。fail-safe（AC-4/AC-6/AC-7）の対象はあくまで「登録されたパスの実体・解決結果」であり、「segment別キー自体の有無」ではない。

### `ac4-output-atomicity-unspecified`（AC-4とAC-6/AC-7の出力原子性の非対称性）

AC-6・AC-7 がThenで明記する「標準出力へ何も出力せず（部分的な出力も行わない）」という原子性は、AC-4（manifest.yamlのスキーマ不正・構文不正・読み取り不能）にも同一の実装機構でそのまま適用される。`src/commands/segment.ts` の `start()` は `parts` 配列を組み立て終えるまで `ok()`（`src/lib/cli-io.ts`、標準出力への書き込みを担う唯一の関数）を呼び出さず、`guard()` が `start()` 内で送出された例外（manifest読込・スキーマ検証・`loadProjectPolicyDocuments` のいずれの段階のものも含む）を捕捉して非0終了コードへ正規化する。したがってAC-4起因の例外も、AC-6・AC-7と同じ経路で「例外発生時点までの標準出力書き込みが一切無い」という原子性を満たす。SPEC.mdのAC-4 Thenがこれを明記していない非対称性はSPEC文言上の書き分けの違いに過ぎず、実装契約としては3者とも同一である。

### `abs-path-inside-base-unspecified`（`.agent-skill-chain/project/` 配下を指す絶対パス表記の扱い）

登録パスが `path.isAbsolute()` と判定される場合、その解決結果が `.agent-skill-chain/project/` 配下を指すか否かに関わらず、常に拒否する（AC-7 (b)）。理由: 要件節が「登録する文書パスは `.agent-skill-chain/project/` ディレクトリを基点とした相対パスとして解決する」と定めており、絶対パス表記はこの構文契約（相対パスであること）自体への違反であって、封じ込め違反（解決結果が範囲外を指すこと）とは独立の理由で拒否されるべきものである。したがって封じ込め境界内を指す絶対パス（例: `<repo>/.agent-skill-chain/project/RULES.md`）であっても許容しない。

## 責務・境界

### コンポーネント構成

- `src/lib/project-policy.ts`（新規）: `.agent-skill-chain/project/manifest.yaml` の読込・スキーマ検証・`documents.common` ＋ `documents.roles.<segment>` に登録されたファイルパスの解決・封じ込め検証・重複排除・内容読込を行う。他モジュールから再利用可能な形にする（`src/lib/model-selection.ts` の `loadCoreReviewPolicy` は `model_selection` フィールドのみを見るため責務が異なり、統合しない）。パス解決・封じ込め検証は `resolveContainedDocumentPath(projectDir, documentPath): string`（実体パスを返す）という単一責務のヘルパー関数へ切り出し、`loadProjectPolicyDocuments` はこのヘルパーの戻り値（実体パス）を使って重複排除・内容読込のみを行う。
- `src/commands/segment.ts`（既存、変更なし）: `start()` 内で `loadProjectPolicyDocuments(root, segment)` を呼び出し、返却された文書内容を `role_contract` の前後いずれかに追加してプロンプト文字列を組み立てる。manifest.yaml読込・検証・パス封じ込め・重複排除のロジックはいずれも持たない（`project-policy.ts` に委譲）。AC-7/AC-8はいずれも `loadProjectPolicyDocuments` の返却値（文書内容の配列）にのみ影響するため、本Issueで既に呼び出し追加済みの `segment.ts` 側の変更は不要である。

### 依存関係

```text
src/commands/segment.ts → src/lib/project-policy.ts → src/lib/yaml-io.ts（readYamlFile）
                                                     → src/lib/schema.ts（validateAgainstSchema）
                                                     → node:path（resolveContainedDocumentPath: isAbsolute, resolve）
                                                     → node:fs（resolveContainedDocumentPath: realpathSync／内容読込: readFileSync）
```

循環依存なし。`project-policy.ts` は `segment.ts` に依存しない。

## 関連ADR

本Issueは既存の仕様（AGENTS.md「プロジェクト固有ポリシー」節）と実装のギャップを埋めるバグ修正である。AC-7・AC-8で追加するパス封じ込め・重複排除も、SPEC.mdが同一性判定基準（realpath相当の正規化）と封じ込め境界（`.agent-skill-chain/project/` 配下）を既に確定しているため、DESIGNは既存要求のNode.js標準API（`path.resolve`/`path.isAbsolute`/`fs.realpathSync`）への機械的な変換であり、複数の代替案から選択するトレードオフを伴う新たな設計判断ではない。関連ADRなし。

## 障害・ロールバック考慮

- 想定される失敗モード: manifest.yamlのYAMLパース失敗、`documents.common`/`documents.roles.<segment>` に列挙されたファイルが実在しない、スキーマ不正、登録パスが `.agent-skill-chain/project/` の範囲外を指す（絶対パス・`../` 脱出・symlink脱出）。いずれも `loadProjectPolicyDocuments` が例外を投げ、`segment start` が非0終了コードで失敗する（サイレントに空文字列を返さない。I8）。
- ロールバック手順: 本Issueの変更はコード追加（新規モジュール）＋ `segment.ts` への呼び出し追加のみで、既存スキーマ・既存ファイル形式を変更しない。問題発生時は本PRのcommitをrevertするだけで旧動作（`role_contract` のみ）に戻る。
- 影響を受ける既存機能: `agent-skill-chain segment start` の出力を消費する箇所（`.agent-skill-chain/scripts/worker-launch.sh` 経由でワーカーへ渡すプロンプト）。manifest.yaml未導入のconsumer projectでは出力が変わらないため影響なし。本リポジトリ（manifest.yaml導入済み）では出力にproject policy文書が追加されるため、既存の出力内容に依存したテストがあれば更新が必要（`test/unit/segment.test.ts` を確認・要修正）。
