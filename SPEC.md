# SPEC: project固有ポリシー(manifest.yaml登録文書)がsegment start経由でワーカーへ配布されない

- Issue: `ISSUE-326`
- 作成者: `spec_worker`
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
- `documents.common` または `documents.roles.<segment>` がキーとして存在するが空配列（`[]`）の場合、対象文書が0件であることを意味し、エラーとしては扱わない（fail-safeはAC-4・AC-6・AC-7が規定する条件が成立した場合にのみ発動する。空配列自体は未定義ケースではなく正常系である）。
- manifest.yaml自体が存在しない（project固有ポリシー未導入の）consumer projectでは、従来どおり `role_contract` のみが出力される（後方互換）。
- manifest.yamlが存在するがスキーマに適合しない場合は、サイレントに無視せずエラーとして扱う（I8: 迷ったら安全側）。
- `documents.common`／`documents.roles.<segment>` に登録されたパスに対応する実ファイルが存在しない、または読み取れない場合も、サイレントにスキップせずエラーとして扱う（I8: 迷ったら安全側。登録済み規範文書が配布されないままワーカーが起動する事態を防ぐ）。
- パス解決は「実ファイルの存否・可読性」だけでなく「解決結果がどこを指すか」自体を保護対象とする。`documents.common`／`documents.roles.<segment>` の各パスは、`../` 等による上位ディレクトリ脱出・絶対パス指定・`.agent-skill-chain/project/` ディレクトリ外を指すsymlink経由のいずれによっても、`.agent-skill-chain/project/` ディレクトリ配下の外側を解決結果として指してはならない（I8: 既定は常に安全側。`role_contract`起動プロンプトの出力は `.agent-skill-chain/adapters/human.sh` の `launch_worker` がGitHub Issueコメントへ転記する経路を持つため、範囲外パスの解決結果をサイレントに配布すると任意ファイル内容の公開漏洩に直結する）。
- 登録された文書の重複排除は、各パスを `.agent-skill-chain/project/` を基点として解決し、symlinkを辿った実体パス（realpath相当の正規化結果）で同一性を判定する。正規化後の実体パスが一致する登録が、`documents.common` 内の複数エントリ・`documents.roles.<segment>` 内の複数エントリ・`documents.common` と `documents.roles.<segment>` の間のいずれで生じても、対応する文書内容は出力へ1回のみ含める（重複配布はしない）。表記のみが異なる登録（例: `RULES.md` と `roles/../RULES.md`）や、AC-7の範囲内に留まるsymlinkエイリアス（リンク先が別の登録パスと同一の実体を指す場合）も、実体パスが一致すれば同一の文書として扱う。この同一性判定は、対応する受入条件（AC-8）で機械検証する。
- 本要求は既存の後方互換契約（AC-3）を manifest.yaml が存在しない場合に限定する。manifest.yamlが存在し `documents.common`／`documents.roles.<segment>` に登録済みの文書実体が欠落している既存 consumer project では、本Issue対応後は `segment start` がAC-6により必ず非0で失敗するようになる（従来は project 固有ポリシーが配布されないまま無害に起動していた）。これは意図した非互換変更であり、I8（迷ったら安全側）を優先する。
- `documents.common`／`documents.roles.<segment>` に登録する文書の内容は、`.agent-skill-chain/adapters/{claude,human}.sh` の `launch_worker` が `segment start` の標準出力を `sed -n 's/^role:[[:space:]]*//p' | head -n1` で解析し先頭行の `role:` 値のみを抽出する既存の解析契約に依存する（`^issue:` 行を解析する処理は両アダプタのいずれにも存在しない）。登録文書の内容が `^role:` パターンに一致する行を含む場合、`head -n1` により実際の抽出結果（`role_contract` 側の `role:` 行）自体は変わらないが、将来この解析契約が変更された場合に影響しうる。本Issueは出力への区切り・出典ラベルの追加を対象外とするため（後述スコープ外節）、この依存関係の是正は行わない。project 固有ポリシー文書を追加する consumer project は、この既知の制約を踏まえて文書内容を作成する必要がある。

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
- Then: 現行と同じ出力（`role: <role>` 行 ＋ `issue:`（あれば）＋ `.agent-skill-chain/config/roles.yaml` の `role_contracts.<role>` が持つフィールド（`inputs`／`outputs`／`rules`／`completion`／`forbidden` 等）をそのままYAMLとして連結したもの。`role_contracts` という名前のキーで包まれることはない）を返し、エラーにならない。
- 検証方法見込み: `automated`

#### AC-4: manifest.yaml読み込み不能・スキーマ不正時のfail-safe

- Given: `.agent-skill-chain/project/manifest.yaml` が存在するが、以下のいずれかに該当する：(a) `project-policy` スキーマに適合しない（例: 必須フィールド欠落）、(b) YAMLとして構文解析できない、(c) ファイル権限等により読み取れない。
- When: `agent-skill-chain segment start <issue_id> <segment>` を実行する。
- Then: いずれの場合もエラーを返し、終了コードは非0になる（`.agent-skill-chain/project/manifest.yaml` が存在しないケース＝AC-3の後方互換経路へ吸収してはならない。サイレントに無視して起動を続けない）。
- 検証方法見込み: `hybrid`（(a)(b)は`automated`。(c)のファイル権限による読み取り不能ケースは、root権限で実行されるCI/検証環境ではパーミッション剥奪を再現できないため、VALIDATION.mdで代替の検証手段（非root実行環境の明示、または権限以外の読み取り不能要因での代替確認）を確定する）

#### AC-5: 既存動作への非破壊

- Given: 本Issueの変更後のコードベース。
- When: `npm test` を実行する。
- Then: `self-extension-policy` 関連テスト・`schema` 関連テスト・その他既存テストが全て成功し続ける。
- 検証方法見込み: `automated`

#### AC-6: 登録文書の実体欠落時のfail-safe

- Given: `.agent-skill-chain/project/manifest.yaml` の `documents.common` または `documents.roles.<segment>` に、文書パスが登録されているが、`.agent-skill-chain/project/` を基点として解決した実ファイルが存在しない、または読み取れない。
- When: `agent-skill-chain segment start <issue_id> <segment>` を実行する。
- Then: 標準出力へ何も出力せず（当該パスより先に読み込み済みの他の登録文書の内容を含め、部分的な出力も行わない）、エラーを返し、終了コードは非0になる（サイレントにスキップして起動を続けない。AC-4のmanifest.yamlスキーマ不正時のfail-safeとは独立した契約であり、manifest.yaml自体はスキーマに適合しているが登録文書の実体が欠落しているケースを対象とする）。
- 検証方法見込み: `hybrid`（実体不在(ENOENT相当)は`automated`。ファイル権限による読み取り不能ケースは、root権限で実行されるCI/検証環境では再現できないため、VALIDATION.mdで代替の検証手段を確定する）

#### AC-7: 登録パスの解決範囲逸脱時のfail-safe

- Given: `.agent-skill-chain/project/manifest.yaml` の `documents.common` または `documents.roles.<segment>` に登録された文書パスが、`.agent-skill-chain/project/` ディレクトリを基点として解決した結果、以下のいずれかにより同ディレクトリ配下の外側を指す：(a) `../` 等の相対パス表記による上位ディレクトリ脱出（例: `../../.env`）、(b) 絶対パス指定（例: `/etc/passwd`）、(c) `.agent-skill-chain/project/` ディレクトリ配下に置かれたsymlinkだが、リンク先の実体が同ディレクトリ配下の外側にある。いずれのケースも、リンク先・解決先のファイル自体は実在し読み取り可能でありうる（AC-6の「実ファイルが存在しない・読み取れない」ケースとは独立の契約）。
- When: `agent-skill-chain segment start <issue_id> <segment>` を実行する。
- Then: 標準出力へ何も出力せず（当該パスより先に読み込み済みの他の登録文書の内容を含め、部分的な出力も行わない）、エラーを返し、終了コードは非0になる。すなわち「解決先が実在し読み取り可能である」ことは配布を正当化しない（AC-6と同じ全出力抑制の原子性を持つ。当該パス以外の既読込文書だけを部分出力してよいという例外は無い）。
- 検証方法見込み: `automated`

#### AC-8: 重複登録された文書の出力抑制

- Given: `.agent-skill-chain/project/manifest.yaml` の `documents.common` と `documents.roles.<segment>` の双方に同一の文書パスが登録されている、または同一リスト内（例: `documents.common`）に同一の文書パスが複数回登録されている。ここでの「同一」とは、各パスを `.agent-skill-chain/project/` を基点として解決し、symlinkを辿った実体パス（realpath相当の正規化結果）が一致することを指す。文字列表記が異なっていても（例: `RULES.md` と `roles/../RULES.md`）、あるいは一方がsymlinkで他方がそのリンク先の実ファイルであっても、実体パスが一致すれば同一とみなす。登録された実体パスがAC-7により配布不可と判定される場合（`.agent-skill-chain/project/` 配下の外側を指す場合）は、本ACの対象外とし、AC-7が優先して適用される。
- When: `agent-skill-chain segment start <issue_id> <segment>` を実行する。
- Then: 当該文書の内容は標準出力へちょうど1回のみ含まれる。同一実体を指す2件目以降の登録によって内容が重複して出力されてはならない。
- 検証方法見込み: `automated`

## スコープ外

- `.agent-skill-chain/project/manifest.yaml` のスキーマ（`project-policy.schema.yaml`）自体の変更。
- ゲートレビュア（`launch_gate_reviewer`）へのproject policy配布（別Issueで扱う）。
- 対話セッション（Claude Code CLI等での直接チャット）における実装委譲の運用。`documents.roles.<segment>` の実データは、本Issue対応時点で `.agent-skill-chain/project/manifest.yaml` に0件登録（`roles: {}`）であり、`.agent-skill-chain/project/roles/` ディレクトリ自体も存在しない。セグメントロール別の追加ポリシー文書をmanifest.yamlへ登録すること自体は、本Issueの対象外（配布経路の是正のみを扱う）とし、別Issueで扱う。
- 標準出力への埋め込み形式（区切り・出典ラベル・`role_contract`との順序）、およびAGENTS.mdが定める優先順位（不変条件＞プロジェクトポリシー＞標準規約・既定値）をワーカーへ明示的に伝達する仕組み。本Issueは `documents.common`／`documents.roles.<segment>` に登録された文書が一切配布されていなかった不具合（配布の有無）の是正のみを対象とし、標準出力の構造（`role:` セクション・`issue:` セクション・`role_contracts` の後ろへ区切りなく文書内容を追記する現行の連結順序）自体の変更は行わない。
- 基点ディレクトリ自体（`.agent-skill-chain/project/`・呼び出し元worktreeパス）がsymlink経由で解決される実行環境における、正規化アルゴリズムの具体的な適用順序（realpathをどの時点・どの経路に適用するか）の確定。本Issueは登録パスの解決結果に対する封じ込め要件（AC-7）と重複判定基準（AC-8）を規定するのみであり、基点側の実装方式はDESIGNで確定する。
