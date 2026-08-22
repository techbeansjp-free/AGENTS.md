# PLAN: root成果物の削除をscope限定ロールと決定的コマンドへ移す

- Issue: `ISSUE-798`
- 対応する DESIGN: `DESIGN.md`

## 実装順序・変更単位

DESIGN.md の設計要素 D1〜D14 を、下から上へ（純粋な判定ロジック → 実行文脈 → 表層 → 契約・配布）積み上げる順序で実装する。各単位は単体で commit 可能であり、直前の単位までが緑であることを前提とする。

| # | 変更単位 | 内容 | 対応 AC-ID | 依存する変更単位 |
|---|---|---|---|---|
| 1 | `lease 走査の Issue 単位プリミティブへの統一` | `.agent-skill-chain/schemas/lease.schema.yaml` の segment enum へ `root_artifact_cleanup` を追加する。`src/commands/cleanup.ts` が有効 lease を探す際の segment 名5件の直書き列挙を、既存の Issue 単位プリミティブ `activeLeasesFor(issueNumber)` の呼び出しへ置き換える。segment 値の固定集合はコード側へ新設しない（D11） | `AC-8` | なし |
| 2 | `root成果物 状態分類器` | `src/lib/root-artifact-state.ts` を新設。HEAD tree・index・`git status --porcelain=v2 -z --untracked-files=all` のレコード列を入力とし、対象4ファイルを「削除対象／内容喪失リスクあり／不在」へ写像する純関数を実装する。未知レコード・未マージ・mode差・型変更・rename/copy は fail-closed で「内容喪失リスクあり」へ倒す（D1） | `AC-3, AC-5, AC-6` | なし |
| 3 | `実行文脈ガードと lease の Issue 単位排他` | `src/commands/root-cleanup-branch.ts` を新設し、まず実行文脈ガード（D2: worktree解決・既定ブランチ／detached HEAD 拒否・remote 先頭の存在・祖先関係・remote 先頭から HEAD への差分が root成果物の削除のみ）と writer lease の Issue 単位排他（D3: 期限を問わない存在検査 → 自 ref 取得 → GitHub モードでの取得直後の再走査と譲歩 → 全終了経路での解放）を実装する | `AC-8` | `#1` |
| 4 | `削除・commit と remote 同期` | 同モジュールへ index スコープ検査（D4）、pathspec 限定の削除ステージング（D5）、staged diff 完全一致検査（D6）、identity 確保・固定メッセージ commit（D7）、remote 同期の確立と終了コード0の事後条件検査（D8: 削除経路・no-op 経路が共通に通る無条件段。remote 先頭が HEAD と一致していれば push せず、一致しなければ push し、その後 remote 先頭・HEAD の tree・作業ツリーの3点を検査する）を、DESIGN.md の判定順序どおりに結線する | `AC-3, AC-4, AC-5, AC-6, AC-7, AC-9` | `#2, #3` |
| 5 | `CLI表層と薄いラッパー` | ディスパッチテーブルへ `root-cleanup branch` を1行追加する。`.agent-skill-chain/scripts/root-cleanup-branch.sh` を既存ラッパーと同一の CLI 解決前文で新設し実行権限を付与する。引数はちょうど1個を要求し、超過・不足・形式不正を使い方エラーとする。標準入力は読まない（D9） | `AC-2` | `#4` |
| 6 | `ロール定義と入出力契約` | `.agent-skill-chain/config/roles.yaml` の `roles:` へ `root_artifact_cleanup_worker`（`lease: writer`、`scope: root_artifacts_only`、capabilities は lease 取得・更新・解放と自ブランチへの commit・push、forbidden に対象4ファイル以外への変更とファイル内容の編集）を追加し、`role_contracts:` へ同名の入出力契約を既存の scope 限定ロールと同構造で追加する。進行役の定義は変更しない（D10） | `AC-1, AC-12` | `#5` |
| 7 | `許可コマンド列挙の更新` | `.agent-skill-chain/adapters/claude.sh` の既定許可コマンド列挙へ `.agent-skill-chain/ci/` 配下の実行を `.agent-skill-chain/scripts/` 配下と同じ2表記で追加する。削除系は追加しない。列挙の近傍へ、削除がワーカーの責務ではなくなったこととその帰結として削除系を意図的に列挙しない旨を理由付きで記述する（D12） | `AC-10` | なし |
| 8 | `テストと既存資産の追随` | 下表の自動テストを追加する。`test/unit/cli-resolve-structure.test.ts` の前文本数・`scripts` 件数・`exit` 形式件数の各期待値を、ラッパー1本追加後の値へ更新する。`test/unit/roles.test.ts` の期待ロール一覧へ新ロールを加える（D13 を含む） | 全AC | `#1〜#7` |

## テストの要否と実行結果

### 要否の判断

- **必要**: 本Issueは実行可能な CLI と権限契約の変更であり、全12 ACの検証方法見込みが `automated` である。判定順序・停止条件・事後条件はいずれも分岐であり、回帰の検出には自動テストが要る。
- **設計セグメント時点での実行**: 本セグメントの差分は Markdown 成果物のみで実装コードを含まないため、単体テスト・統合テストの全量実行は本セグメントの完了条件ではない。本セグメントでは型検査（`npm run build`）と、設計成果物に適用される `.agent-skill-chain/ci/` の静的検査のみを前景で実行した。実装セグメントで下表の全テストを追加・実行する。

### 設計セグメントで実行した検査と結果

| 検査 | コマンド | 結果 |
|---|---|---|
| 型検査・ビルド | `npm run build` | 成功（終了コード0） |
| ADR 検査 | `.agent-skill-chain/ci/verify-adr.sh docs/adr/ADR-0080-*.md` | 成功（終了コード0） |
| ADR 整合性 lint | `.agent-skill-chain/scripts/adr-lint.sh check` | 成功（終了コード0） |
| 設計図の要否記載 | `.agent-skill-chain/ci/verify-design-diagram.sh DESIGN.md` | 成功（終了コード0） |
| 文書量上限 | `.agent-skill-chain/ci/verify-doc-length.sh` | 成功（終了コード0） |
| テンプレート同期 | `.agent-skill-chain/ci/verify-template-sync.sh` | 成功（終了コード0） |
| 設定と文書の同期 | `.agent-skill-chain/ci/verify-config-doc-sync.sh` | 成功（終了コード0） |
| SPEC の BDD 構造 | `.agent-skill-chain/ci/verify-spec-bdd.sh SPEC.md` | 成功（終了コード0） |
| 成果物存在検査 | `.agent-skill-chain/ci/verify-artifacts.sh ISSUE-798 design` | 成功（終了コード0） |
| 禁止参照 lint | `.agent-skill-chain/scripts/lint-references.sh` | 成功（終了コード0） |
| 用語 lint | `.agent-skill-chain/scripts/lint-vocab.sh` | 成功（終了コード0） |

`.agent-skill-chain/ci/verify-ac-coverage.sh ISSUE-798` は本セグメントでは実行できない。同スクリプトは AC-ID と検証証跡の対応を `VALIDATION.md` から読むため、`VALIDATION.md` 不在を理由に終了コード1で停止する（実測出力: `VALIDATION.md が見つかりません`）。`VALIDATION.md` は独立検証セグメントの成果物であり、設計セグメント完了時点では存在しない。同検査は当該セグメントで実行する。

### 実装セグメントで追加する自動テスト

| 対象 | 種別 | 検証する AC-ID | 要点 |
|---|---|---|---|
| 状態分類器 | 単体 | `AC-3, AC-5, AC-6` | 3区分の相互排他・網羅性。作業ツリー上に存在／未ステージ削除／ステージ済み削除がいずれも「削除対象」へ落ちること。未追跡・新規ステージ済み・内容変更・mode変更・未マージが「内容喪失リスクあり」へ落ちること。全欠落が「不在」へ落ちること |
| lease の Issue 単位排他 | 統合 | `AC-8` | **他 segment（`implementation` 等）の有効 lease が存在する状態で、削除・commit・push のいずれも行わず非ゼロ終了すること**。同一 segment だけでなく Issue 内の任意の segment で停止すること。期限切れ lease でも停止し、回収しないこと。診断に保持者・segment・失効時刻が出ること。GitHub・ローカル両モードで同じ判定になること |
| lease 取得後の再走査 | 統合 | `AC-8` | GitHub モードで、自 ref 取得後の再走査により他 segment の lease を検出した場合、自らの lease を解放したうえで非ゼロ終了すること。削除・commit・push のいずれも行われないこと |
| ワーカー経路の不成立 | 統合 | `AC-8, AC-10` | セグメント作業ワーカーが lease を保持したままラッパーを起動した場合に、root成果物が削除されず commit も push も発生しないこと |
| remote 前提のガード | 統合 | `AC-8, AC-9` | remote 先頭が存在しない／remote が先行・分岐している／remote 先頭から HEAD への差分に root成果物の削除以外が含まれる、の各条件で commit も push もせず非ゼロ終了すること |
| 本コマンド 正常系 | 統合 | `AC-3` | 削除のみの commit が作られ push され SHA が出力され終了コード0。起動時点で既に作業ツリーから消えていた場合も no-op にならないこと |
| push 失敗と再実行 | 統合 | `AC-9` | **push が失敗した実行が非ゼロ終了すること。その後の再実行が push を完了させ、remote 先頭と HEAD の一致を検証したうえで終了コード0を返すこと。ローカルだけが clean な状態で終了コード0を返す経路が存在しないこと** |
| 本コマンド 停止系 | 統合 | `AC-4, AC-6, AC-8` | 対象外のステージ済み変更／内容喪失リスクあり／既定ブランチの3条件で、commit も push もせず非ゼロ終了し、日本語診断に理由が出ること。worktree と index が起動前から変化しないこと |
| 本コマンド no-op | 統合 | `AC-5` | 全件「不在」かつ remote 先頭が HEAD と一致するときだけ commit も push もせず終了コード0。作業ツリーに1件も無いが HEAD に存在する状態では no-op にならないこと |
| 対象外パスの非巻き込み | 統合 | `AC-7` | 対象外パスの未ステージ変更・未追跡ファイルが commit に入らず、実行後も起動前と同じ内容で作業ツリーに残ること |
| 事後条件 | 統合 | `AC-9` | 削除経路・no-op 経路の双方で終了コード0の後に既存の残存検査コマンドが終了コード0を返すこと。検査対象が remote 先頭・HEAD の tree・作業ツリーの3点であること |
| 引数仕様と決定性 | 単体 | `AC-2` | 引数が1個以外のとき使い方エラーで非ゼロ。実装モジュールの推移的 import 閉包にアダプタ・ワーカー起動・レビュア起動の実装が含まれないこと |
| ロール定義 | 単体 | `AC-1, AC-12` | 新ロールが `roles:`／`role_contracts:` 双方に存在し必須項目を持つこと。進行役の forbidden が不変で、新ロールの capabilities に著述・内容編集が無いこと |
| 許可コマンド列挙 | 統合 | `AC-10` | `ci/` 実行が `scripts/` と同表記で存在し、削除系（`rm`・`git rm`・`find` の削除実行・index からの強制削除）と無制限自動承認指定が存在しないこと。理由記述が列挙の近傍にあること |
| 既存挙動の不変 | 統合 | `AC-11` | 既存の事後清掃自動化と残存検査の既存テストが期待値を変更せずに成功すること。`lease acquire` の外部挙動が変わらないこと |
| `cleanup` の lease 走査 | 単体 | `AC-8` | 直書き列挙の置換後も既存の停止条件が緩まないこと。新 segment `root_artifact_cleanup` の有効 lease を検出して worktree 削除を拒否すること。スキーマ enum へ値を追加しても既存 lease 文書が有効なまま検証を通ること |

## 設計変更と AC の対応（design round 2）

design-gate round 1 の blocking を受けた設計変更と、その検証を担う AC・テストの対応は次のとおり。いずれも SPEC は変更していない。

| 設計変更 | 変更した設計要素 | 対応 AC-ID | 上表の担当テスト |
|---|---|---|---|
| lease の排他判定を segment 単位の ref compare-and-set から Issue 単位走査へ移した | D3、D11 | `AC-8` | lease の Issue 単位排他／lease 取得後の再走査／ワーカー経路の不成立 |
| 終了コード0の事後条件を remote 先頭で定義し、push を両経路共通の無条件段にした | D2、D7、D8 | `AC-5, AC-9` | push 失敗と再実行／remote 前提のガード／事後条件／本コマンド no-op |
| segment 値の固定集合の新設をやめ、既存 prefix 走査の再利用へ置き換えた | D11 | `AC-8` | `cleanup` の lease 走査 |

## 実装順序の見直しについて

作業順序のみを見直す場合は本ファイルのみを更新する。設計要素・責務・境界そのものを変更する場合は `DESIGN.md` の更新と設計ゲートの再通過が必要になる。

## 実装セグメントへの申し送り

- `test/unit/cli-resolve-structure.test.ts` はラッパーの本数を固定値で検査している。ラッパー1本の追加により、前文の総本数・`scripts` 配下の件数・`exit` 形式の件数の3つの期待値がいずれも1増える。更新漏れは実装セグメントで必ず落ちる。
- 既存の事後清掃自動化・残存検査・`lease acquire` の実装ファイルには差分を入れない。`AC-11` は差分の不在で示せる。
- remote 先頭の読み取りは、ローカルの remote-tracking ref ではなく remote の実体を読む経路（`ls-remote` 相当）で行う。ローカル ref の鮮度に事後条件の成否を依存させないためである。
