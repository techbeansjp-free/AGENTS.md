# SPEC: project固有ポリシー(manifest.yaml登録文書)がsegment start経由でワーカーへ配布されない

- Issue: `ISSUE-326`
- 作成者: `orchestrator`
- 対象ブランチ: `bugfix/326-segment-start-policy-dist`

## 目的・背景

AGENTS.md「プロジェクト固有ポリシー」節は「進行役は `manifest.yaml` 全体を読み、各ワーカーには `documents.common` と自role分のみを渡す」と定める。しかし `agent-skill-chain segment start`（`src/commands/segment.ts` の `start()`）が組み立てるセグメント作業ワーカー起動プロンプトは `.agent-skill-chain/config/roles.yaml` の `role_contracts.<segment>_worker` のみで構成され、`.agent-skill-chain/project/manifest.yaml` を一切読み込まない。

結果として、`documents.common`（`RULES.md`・`自己拡張ワークフロー.md`・`OPERATING_PRINCIPLES.md`・`MODEL_TIER_TABLE.md`）および `documents.roles.<segment>` に登録された project 固有ポリシー文書は、spec/design/implementation/validationいずれのセグメント作業ワーカーにも一度も配布されていない。これは仕様（AGENTS.md）と実装の食い違いであり、project固有ポリシーが実効性を持たない状態を放置している。

## 要求 → 要件 → 受入条件

### 要求

`segment start` で起動するセグメント作業ワーカーが、`.agent-skill-chain/project/manifest.yaml` に登録された project 固有ポリシー文書（`documents.common` および自セグメント分の `documents.roles.<segment>`）を実際に読める状態にする。

### 要件

- manifest.yamlが存在するプロジェクトでは、`segment start <issue_id> <segment>` の出力に `documents.common` の各文書内容が含まれる。
- `documents.roles.<segment>` にそのセグメント向けの文書が登録されていれば、その内容も含まれる。
- `documents.common`／`documents.roles.<segment>` に登録する文書パスは、`.agent-skill-chain/project/` ディレクトリを基点とした相対パスとして解決する。
- manifest.yaml自体が存在しない（project固有ポリシー未導入の）consumer projectでは、従来どおり `role_contract` のみが出力される（後方互換）。
- manifest.yamlが存在するがスキーマに適合しない場合は、サイレントに無視せずエラーとして扱う（I8: 迷ったら安全側）。
- `documents.common`／`documents.roles.<segment>` に登録されたパスに対応する実ファイルが存在しない、または読み取れない場合も、サイレントにスキップせずエラーとして扱う（I8: 迷ったら安全側。登録済み規範文書が配布されないままワーカーが起動する事態を防ぐ）。
- パス解決は「実ファイルの存否・可読性」だけでなく「解決結果がどこを指すか」自体を保護対象とする。`documents.common`／`documents.roles.<segment>` の各パスは、`../` 等による上位ディレクトリ脱出・絶対パス指定・`.agent-skill-chain/project/` ディレクトリ外を指すsymlink経由のいずれによっても、`.agent-skill-chain/project/` ディレクトリ配下の外側を解決結果として指してはならない（I8: 既定は常に安全側。`role_contract`起動プロンプトの出力は `.agent-skill-chain/adapters/human.sh` の `launch_worker` がGitHub Issueコメントへ転記する経路を持つため、範囲外パスの解決結果をサイレントに配布すると任意ファイル内容の公開漏洩に直結する）。

### 受入条件（Acceptance Criteria）

#### AC-1: documents.commonの配布

- Given: `.agent-skill-chain/project/manifest.yaml` が存在し、`documents.common` に1件以上の文書パスが登録されている。各パスは `.agent-skill-chain/project/` ディレクトリを基点とした相対パスであり、対応する実ファイルが同ディレクトリ配下に存在し読み取り可能である（例: `documents.common` に `RULES.md` と登録されていれば、実体は `.agent-skill-chain/project/RULES.md` に存在する）。
- When: `agent-skill-chain segment start <issue_id> <segment>` を実行する。
- Then: 標準出力に、`documents.common` に列挙された各ファイルの内容が含まれる。
- 検証方法見込み: `automated`

#### AC-2: documents.roles.<segment>の配布

- Given: `.agent-skill-chain/project/manifest.yaml` の `documents.roles.<segment>` に、当該セグメント向けの文書パスが1件以上登録されている。パスは `.agent-skill-chain/project/` ディレクトリを基点とした相対パスであり、対応する実ファイルが存在し読み取り可能である。
- When: `agent-skill-chain segment start <issue_id> <segment>` を実行する。
- Then: 標準出力に、その文書の内容が含まれる。他セグメント向けに登録された文書（例: `documents.roles.spec` のみに登録された文書）は、`implementation` セグメント起動時の出力には含まれない。
- 検証方法見込み: `automated`

#### AC-3: manifest.yaml不在時の後方互換

- Given: `.agent-skill-chain/project/manifest.yaml` が存在しない。
- When: `agent-skill-chain segment start <issue_id> <segment>` を実行する。
- Then: 現行と同じ出力（`role:` ＋ `issue:`（あれば）＋ `role_contracts` のみ）を返し、エラーにならない。
- 検証方法見込み: `automated`

#### AC-4: manifest.yamlスキーマ不正時のfail-safe

- Given: `.agent-skill-chain/project/manifest.yaml` が存在するが、`project-policy` スキーマに適合しない（例: 必須フィールド欠落）。
- When: `agent-skill-chain segment start <issue_id> <segment>` を実行する。
- Then: エラーを返し、終了コードは非0になる（サイレントに無視して起動を続けない）。
- 検証方法見込み: `automated`

#### AC-5: 既存動作への非破壊

- Given: 本Issueの変更後のコードベース。
- When: `npm test` を実行する。
- Then: `self-extension-policy` 関連テスト・`schema` 関連テスト・その他既存テストが全て成功し続ける。
- 検証方法見込み: `automated`

#### AC-6: 登録文書の実体欠落時のfail-safe

- Given: `.agent-skill-chain/project/manifest.yaml` の `documents.common` または `documents.roles.<segment>` に、文書パスが登録されているが、`.agent-skill-chain/project/` を基点として解決した実ファイルが存在しない、または読み取れない。
- When: `agent-skill-chain segment start <issue_id> <segment>` を実行する。
- Then: エラーを返し、終了コードは非0になる（サイレントにスキップして起動を続けない。AC-4のmanifest.yamlスキーマ不正時のfail-safeとは独立した契約であり、manifest.yaml自体はスキーマに適合しているが登録文書の実体が欠落しているケースを対象とする）。
- 検証方法見込み: `automated`

#### AC-7: 登録パスの解決範囲逸脱時のfail-safe

- Given: `.agent-skill-chain/project/manifest.yaml` の `documents.common` または `documents.roles.<segment>` に登録された文書パスが、`.agent-skill-chain/project/` ディレクトリを基点として解決した結果、以下のいずれかにより同ディレクトリ配下の外側を指す：(a) `../` 等の相対パス表記による上位ディレクトリ脱出（例: `../../.env`）、(b) 絶対パス指定（例: `/etc/passwd`）、(c) `.agent-skill-chain/project/` ディレクトリ配下に置かれたsymlinkだが、リンク先の実体が同ディレクトリ配下の外側にある。いずれのケースも、リンク先・解決先のファイル自体は実在し読み取り可能でありうる（AC-6の「実ファイルが存在しない・読み取れない」ケースとは独立の契約）。
- When: `agent-skill-chain segment start <issue_id> <segment>` を実行する。
- Then: 当該パスの内容を標準出力へ含めず（サイレントな配布を禁止し）、エラーを返し、終了コードは非0になる。すなわち「解決先が実在し読み取り可能である」ことは配布を正当化しない。
- 検証方法見込み: `automated`

## スコープ外

- `.agent-skill-chain/project/manifest.yaml` のスキーマ（`project-policy.schema.yaml`）自体の変更。
- ゲートレビュア（`launch_gate_reviewer`）へのproject policy配布（別Issueで扱う）。
- 対話セッション（Claude Code CLI等での直接チャット）における実装委譲の運用。`documents.roles.<segment>` の実データは、本Issue対応時点で `.agent-skill-chain/project/manifest.yaml` に0件登録（`roles: {}`）であり、`.agent-skill-chain/project/roles/` ディレクトリ自体も存在しない。セグメントロール別の追加ポリシー文書をmanifest.yamlへ登録すること自体は、本Issueの対象外（配布経路の是正のみを扱う）とし、別Issueで扱う。
- 標準出力への埋め込み形式（区切り・出典ラベル・`role_contract`との順序）、およびAGENTS.mdが定める優先順位（不変条件＞プロジェクトポリシー＞標準規約・既定値）をワーカーへ明示的に伝達する仕組み。本Issueは `documents.common`／`documents.roles.<segment>` に登録された文書が一切配布されていなかった不具合（配布の有無）の是正のみを対象とし、標準出力の構造（`role:` セクション・`issue:` セクション・`role_contracts` の後ろへ区切りなく文書内容を追記する現行の連結順序）自体の変更は行わない。
