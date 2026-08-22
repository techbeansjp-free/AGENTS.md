# PLAN: root成果物の削除をscope限定ロールと決定的コマンドへ移す

- Issue: `ISSUE-798`
- 対応する DESIGN: `DESIGN.md`

## 実装順序・変更単位

DESIGN.md の設計要素 D1〜D15 を、下から上へ（純粋な判定ロジック → 非偽造の実行境界 → 実行文脈 → 表層 → 契約・配布）積み上げる順序で実装する。各単位は単体で commit 可能であり、直前の単位までが緑であることを前提とする。

| # | 変更単位 | 内容 | 対応 AC-ID | 依存する変更単位 |
|---|---|---|---|---|
| 1 | `lease 走査の Issue 単位プリミティブへの統一` | `.agent-skill-chain/schemas/lease.schema.yaml` の segment enum へ `root_artifact_cleanup` を追加する。`src/commands/cleanup.ts` が有効 lease を探す際の segment 名5件の直書き列挙を、既存の Issue 単位プリミティブ `activeLeasesFor(issueNumber)` の呼び出しへ置き換える。segment 値の固定集合はコード側へ新設しない（D11） | `AC-8` | なし |
| 2 | `root成果物 状態分類器` | `src/lib/root-artifact-state.ts` を新設。D1の固定5入力（HEAD tree、stage付きindex、通常untracked、ignored untracked、copy検出を有効にしたporcelain v2）をNUL安全に読み、対象4ファイルを3区分へ写像する。ignored・newly staged・内容/mode/type差・rename/copy・unmerged・未知はfail-closedとする | `AC-3, AC-5, AC-6` | なし |
| 3 | `非偽造のcleanup launcher grant` | 既存protected launcher／one-time token契約を再利用し、adapter共通の`launch_root_artifact_cleanup`と署名・短期expiry・原子的nonce消費を実装する。mutation可能なexecutorをprotected base/version固定packageからdigest固定で調達し、署名鍵、registry、cleanup用Git credentialをworker環境外へ分離する。grantをissue/branch/HEAD/executor digestへ拘束し、CLI直呼び、role env偽装、workerのlease解放、別Issue、期限切れ・再利用をrepository mutation前に拒否する（D15） | `AC-10, AC-12` | なし |
| 4 | `実行文脈ガードと lease の Issue 単位排他` | `src/commands/root-cleanup-branch.ts` を新設し、grant検証・原子的消費を最初に行う。続いて実行文脈ガード（D2）と writer lease の Issue 単位排他（D3）を実装する | `AC-8, AC-10` | `#1, #3` |
| 5 | `書込み前barrier・削除・commit・remote同期` | D4のread-only検査後、D1の5入力snapshotをD5直前に取得し、それ以前のindex/worktree mutationを禁止する。pathspec限定削除（D5）、staged完全一致（D6）、cleanup role identityでの固定commit（D7）、両経路共通のremote同期・事後条件（D8）を結線する | `AC-3, AC-4, AC-5, AC-6, AC-7, AC-9, AC-12` | `#2, #3, #4` |
| 6 | `CLI表層と薄いラッパー` | ディスパッチテーブルと`.agent-skill-chain/scripts/root-cleanup-branch.sh`を追加する。引数は1個、stdin不読とし、grantなしの直接呼出しは認可エラーにする（D9） | `AC-2, AC-10` | `#5` |
| 7 | `ロール定義と入出力契約` | `root_artifact_cleanup_worker`のrole/contractを追加し、grant必須、cleanup role credential、対象4ファイルの削除限定、通常workerからの直接起動禁止を規約へ含める。進行役の定義は変更しない（D10） | `AC-1, AC-12` | `#3, #6` |
| 8 | `許可コマンド列挙の更新` | claude adapterへ`ci/`の2表記だけを追加する。削除系は追加せず、`scripts/*`にcleanup wrapperが含まれてもD15が実効認可を担う理由を近傍へ記す（D12） | `AC-10` | `#3` |
| 9 | `テストと既存資産の追随` | 下表の自動テストを追加し、ラッパー本数とロール一覧の既存構造テストを追随させる（D13を含む） | 全AC | `#1〜#8` |

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
| 状態分類器 | 単体 | `AC-3, AC-5, AC-6` | D1の5入力を個別fixture化し3区分の相互排他・網羅性を検証する。通常untrackedと`.gitignore`/`.git/info/exclude`/global excludesでignoredになった対象、新規stage、内容/mode/type差、rename/copyのsource/target、index stage 1〜3、未知/壊れたNULレコードは全て「内容喪失リスクあり」。未stage/stage済み削除は「削除対象」、全欠落は「不在」 |
| Git観測flagとmutation順序 | 統合 | `AC-4, AC-6` | Git shimでD1の5コマンドのargvを完全一致検証し、`--no-optional-locks`、`--literal-pathspecs`、`-z`、通常untracked、`--ignored --exclude-standard`、porcelain v2とcopy検出flagが欠けないこと。最初の`git rm`/index書込み/ファイル書込みより前に全観測が完了し、観測失敗時はindex/worktree/HEAD/remoteが起動前と同一であること |
| lease の Issue 単位排他 | 統合 | `AC-8` | **他 segment（`implementation` 等）の有効 lease が存在する状態で、削除・commit・push のいずれも行わず非ゼロ終了すること**。同一 segment だけでなく Issue 内の任意の segment で停止すること。期限切れ lease でも停止し、回収しないこと。診断に保持者・segment・失効時刻が出ること。GitHub・ローカル両モードで同じ判定になること |
| lease 取得後の再走査 | 統合 | `AC-8` | GitHub モードで、自 ref 取得後の再走査により他 segment の lease を検出した場合、自らの lease を解放したうえで非ゼロ終了すること。削除・commit・push のいずれも行われないこと |
| grant正常系とrole主体 | 統合 | `AC-3, AC-10, AC-12` | protected launcherが発行した未使用grantだけが1回成功し、claimsのIssue/branch/HEADが実体と一致すること。commit author/committerとpush credentialがcleanup roleで、進行役・通常worker identityではないこと。grant本文やcredentialがargv/env/stdin/log/worker promptへ出ないこと |
| 通常worker経路の不成立 | 統合 | `AC-10` | Claude/Codex workerの両launcherから、(a) lease保持中、(b)自lease解放後、(c)leaseの無い別Issue指定、(d)`ASC_ROLE`偽装、(e)wrapper/CLI直接呼出し、(f)自己生成grant、(g)期限切れ、(h)消費済みgrant再利用、(i)対象worktree側wrapper/CLI sourceから認可検査を除去、を実行し、全てgrant検証でlease取得より前に非ゼロ終了すること。root成果物・index・HEAD・remoteが不変であること |
| grant claim/registry障害 | 統合 | `AC-10, AC-12` | issue/branch/HEAD/roleの各claim改変、署名不正、registry停止、nonce競合ではfail-closed。2並列実行は原子的消費により片方だけが認可され、他方はmutation前に停止すること |
| remote 前提のガード | 統合 | `AC-8, AC-9` | remote 先頭が存在しない／remote が先行・分岐している／remote 先頭から HEAD への差分に root成果物の削除以外が含まれる、の各条件で commit も push もせず非ゼロ終了すること |
| 本コマンド 正常系 | 統合 | `AC-3` | 削除のみの commit が作られ push され SHA が出力され終了コード0。起動時点で既に作業ツリーから消えていた場合も no-op にならないこと |
| push 失敗と再実行 | 統合 | `AC-9` | **push が失敗した実行が非ゼロ終了すること。その後の再実行が push を完了させ、remote 先頭と HEAD の一致を検証したうえで終了コード0を返すこと。ローカルだけが clean な状態で終了コード0を返す経路が存在しないこと** |
| 本コマンド 停止系 | 統合 | `AC-4, AC-6, AC-8` | 対象外stage／通常untracked／ignored untracked／newly staged／内容・mode・type差／rename/copy／unmerged／既定ブランチで、削除・commit・pushせず非ゼロ。診断はpathと理由を示し内容を漏らさず、worktree・index・HEAD・remoteが不変であること |
| 本コマンド no-op | 統合 | `AC-5` | 全件「不在」かつ remote 先頭が HEAD と一致するときだけ commit も push もせず終了コード0。作業ツリーに1件も無いが HEAD に存在する状態では no-op にならないこと |
| 対象外パスの非巻き込み | 統合 | `AC-7` | 対象外パスの未ステージ変更・未追跡ファイルが commit に入らず、実行後も起動前と同じ内容で作業ツリーに残ること |
| 事後条件 | 統合 | `AC-9` | 削除経路・no-op 経路の双方で終了コード0の後に既存の残存検査コマンドが終了コード0を返すこと。検査対象が remote 先頭・HEAD の tree・作業ツリーの3点であること |
| 引数仕様と決定性 | 単体 | `AC-2` | 引数が1個以外のとき使い方エラーで非ゼロ。コマンド本体の推移的import閉包にLLM・ワーカー・レビュア起動実装が含まれず、launcherは決定的コマンドを直接起動するだけであること |
| ロール定義 | 単体 | `AC-1, AC-12` | 新ロールが `roles:`／`role_contracts:` 双方に存在し必須項目を持つこと。進行役の forbidden が不変で、新ロールの capabilities に著述・内容編集が無いこと |
| 許可コマンド列挙 | 統合 | `AC-10` | `ci/`実行が`scripts/`と同表記で存在し、削除系と無制限自動承認が無いこと。`scripts/*`がcleanup wrapperを含むこととgrant境界が必要な理由を近傍に明記すること |
| 既存挙動の不変 | 統合 | `AC-11` | 既存の事後清掃自動化と残存検査の既存テストが期待値を変更せずに成功すること。`lease acquire` の外部挙動が変わらないこと |
| `cleanup` の lease 走査 | 単体 | `AC-8` | 直書き列挙の置換後も既存の停止条件が緩まないこと。新 segment `root_artifact_cleanup` の有効 lease を検出して worktree 削除を拒否すること。スキーマ enum へ値を追加しても既存 lease 文書が有効なまま検証を通ること |

## 設計変更と AC の対応（design round 2）

design-gate round 1 の blocking を受けた設計変更と、その検証を担う AC・テストの対応は次のとおり。いずれも SPEC は変更していない。

| 設計変更 | 変更した設計要素 | 対応 AC-ID | 上表の担当テスト |
|---|---|---|---|
| lease の排他判定を segment 単位の ref compare-and-set から Issue 単位走査へ移した | D3、D11 | `AC-8` | lease の Issue 単位排他／lease 取得後の再走査／ワーカー経路の不成立 |
| 終了コード0の事後条件を remote 先頭で定義し、push を両経路共通の無条件段にした | D2、D7、D8 | `AC-5, AC-9` | push 失敗と再実行／remote 前提のガード／事後条件／本コマンド no-op |
| segment 値の固定集合の新設をやめ、既存 prefix 走査の再利用へ置き換えた | D11 | `AC-8` | `cleanup` の lease 走査 |

## 設計変更と AC の対応（design remediation round 3）

| 設計変更 | 変更した設計要素 | 対応 AC-ID | 上表の担当テスト |
|---|---|---|---|
| ignoredを通常untrackedと独立列挙する固定5入力snapshotを、最初のindex/worktree mutation直前のbarrierにした | D1、D4、D5 | `AC-4, AC-6` | 状態分類器／Git観測flagとmutation順序／本コマンド停止系 |
| worker leaseを認可根拠から削除し、protected launcherの署名付きone-time grantとcleanup role credentialへ置換した | D9、D10、D12、D15 | `AC-10, AC-12` | grant正常系とrole主体／通常worker経路の不成立／grant claim/registry障害 |

## 実装順序の見直しについて

作業順序のみを見直す場合は本ファイルのみを更新する。設計要素・責務・境界そのものを変更する場合は `DESIGN.md` の更新と設計ゲートの再通過が必要になる。

## 実装セグメントへの申し送り

- `test/unit/cli-resolve-structure.test.ts` はラッパーの本数を固定値で検査している。ラッパー1本の追加により、前文の総本数・`scripts` 配下の件数・`exit` 形式の件数の3つの期待値がいずれも1増える。更新漏れは実装セグメントで必ず落ちる。
- 既存の事後清掃自動化・残存検査・`lease acquire` の実装ファイルには差分を入れない。`AC-11` は差分の不在で示せる。
- remote 先頭の読み取りは、ローカルの remote-tracking ref ではなく remote の実体を読む経路（`ls-remote` 相当）で行う。ローカル ref の鮮度に事後条件の成否を依存させないためである。
