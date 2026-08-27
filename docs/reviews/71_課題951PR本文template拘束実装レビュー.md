# 71 課題951 PR本文template拘束実装レビュー

## 0. レビュー識別情報

| 項目 | 値 |
|---|---|
| 対象Issue | #951 |
| 比較基点 | `403b0cd449e5ded13354528f8663f1600941c6d3` |
| H_impl | `ea148b4c9c98be966ed08e18ff10ac8a7f0f5a91` |
| reviewer | claude（実装と別ラウンド、変異試験で独立に検証） |
| 実施日 | 2026-08-27 |
| ラウンド数 | 2（うち1ラウンドは自動review） |

### 0.1 routing入力契約

Issue本文、配布template、既存実装の原文を入力にした。変異試験は判定の後に独自に設計し、生存した変異を指摘として扱った。ラウンド2は自動reviewであり、対象はPRのheadと差分だけである。判定に用いた値はすべて本artifactへ原文で引用する。

## 1. 入力証拠

| 証拠 | 参照先 | 観測結果 | 根拠種別 |
|---|---|---|---|
| 要求・受け入れ条件 | Issue #951、`REQ-SQ-022`、`AC-SQ-022` | PR本文をtemplate構造へ拘束し、不適合を拒否する | 一次資料 |
| 第1段階の完了確認 | `ce1ca99b` | **既に完了済み。**複製4箇所が正本1＋参照3になっている | 実行観測 |
| 差分 | `403b0cd4`..`ea148b4c` | 14 path | 既存コード |
| 保護対象の差分 | 同上 | **0件。**保護fileもpackageのfieldも変更していない | 実行観測 |
| trusted-base相当 | `--root=候補 --trusted-root=既定branch` | `valid: true` | 実行観測 |
| 静的検査 | 12種 | すべてexit 0 | テスト出力 |
| テスト | `npm test` | 953 scenario全通過、5074 step全通過 | テスト出力 |
| 検査の変異試験 | 9経路 | 初回は5経路を検出、1経路が生存。是正後は9経路すべて検出 | 実行観測 |
| 既定branch追随 | `origin/main`を取り込み | 仕様3 fileが衝突。両側を保存して解決 | 実行観測 |

## 変更ファイル個別監査

| path | status | owner | target layer | 責務・配置 | 依存・循環 | 仕様・追跡 | 安全・rollback | 個別判定 |
|---|---|---|---|---|---|---|---|---|
| `docs/specs/02_要件/00_要件一覧.md` | M | change owner | 仕様 | REQ-SQ-022の登録 | 参照のみ | REQ-SQ-022 | 行の除去で戻る | pass |
| `docs/specs/02_要件/04_仕様・品質管理要件.md` | M | change owner | 仕様 | REQ-SQ-022の定義 | 参照のみ | REQ-SQ-022 | 節の除去で戻る | pass |
| `docs/specs/11_非機能/01_品質要件.md` | M | change owner | 仕様 | QLT-PRBODY-001の定義 | 参照のみ | REQ-SQ-022 | 行の除去で戻る | pass |
| `docs/specs/15_要件追跡/00_追跡表.md` | M | change owner | 仕様 | REQ-SQ-022の追跡1行 | 参照のみ | REQ-SQ-022 | 行の除去で戻る | pass |
| `src/adapters/github.ts` | M | package owner | adapter | PR作成を`--body-file`経路へ変更 | domainから受け取る単方向 | REQ-SQ-022、SCN-INT-PRBODY-001 | `--body`経路へ戻す | pass |
| `src/cli-usage.ts` | M | package owner | CLI契約 | `--body-file`必須、`--title`任意の宣言 | 参照のみ | REQ-SQ-022 | flag宣言の除去で戻る | pass |
| `src/cli.ts` | M | package owner | CLI | 本文fileの読取とdomainへの受け渡し | domainへ単方向 | REQ-SQ-022 | 受け渡しの除去で戻る | pass |
| `src/domain/delivery.ts` | M | package owner | domain | 本文の構造・参照検証とtitle分離 | `issue.ts`を読む単方向 | REQ-SQ-022、SCN-INT-PRBODY-001〜005、009 | 追加関数と検証の除去で戻る | pass |
| `src/domain/issue.ts` | M | package owner | domain | 必須見出しのtemplate導出、code除去、本文検証 | template fileを読む単方向 | REQ-SQ-022、SCN-INT-PRBODY-006〜008 | 追加関数の除去で戻る | pass |
| `test/features/integration/delivery-finalize.feature` | M | package owner | test | PR本文の受け入れ例9件 | 実装へ単方向 | SCN-INT-PRBODY-001〜009 | scenarioの除去で戻る | pass |
| `test/steps/delivery-finalize.steps.ts` | M | package owner | test | step定義と本文fixture | 実装へ単方向 | SCN-INT-PRBODY全件 | step定義の除去で戻る | pass |
| `test/steps/e2e.steps.ts` | M | package owner | test | E2Eへの`--body-file`追加 | 実装へ単方向 | SCN-E2E-CLI | 引数の除去で戻る | pass |
| `test/steps/workflow-step-enforcement.steps.ts` | M | package owner | test | 本文fileの生成とstub照合の更新 | 実装へ単方向 | SCN-E2E-WFSTEP | 引数とstubの復元で戻る | pass |
| `test/support/world.ts` | M | package owner | test支援 | template導出による本文fixtureの共通化 | `issue.ts`を読む単方向 | SCN-INT-PRBODY全件 | 関数の除去で戻る | pass |

### 保護対象との照合

**保護fileとpackageの保護fieldは1件も変更していない。**品質契約proposalを要さない。`--root=候補 --trusted-root=既定branch`が`valid: true`を返すことで確認した。

### 既定branch追随の扱い

`origin/main`が#977のmergeで動いたため、**review artifact commitより前に**取り込んだ。仕様3 fileが衝突し、いずれも**両側を保存**して解決した。

| file | 既定branch側 | 候補側 | 解決 |
|---|---|---|---|
| `02_要件/00_要件一覧.md` | REQ-SQ-021の行 | REQ-SQ-022の行 | 両方を番号順に保存 |
| `02_要件/04_仕様・品質管理要件.md` | REQ-SQ-021の節 | REQ-SQ-022の節 | 両方を番号順に保存 |
| `11_非機能/01_品質要件.md` | QLT-SCRIPTPIN-001の行 | QLT-PRBODY-001の行 | 両方を保存 |

解決後、`checkTrustedScriptPinning`と`validatePullRequestBody`の双方が実装に残り、追跡表に`SCN-INT-SCRIPTPIN`と`SCN-INT-PRBODY`の双方が残ることを個別に確認した。**個別監査表は追随後の`比較基点..H_impl`から再生成している。**

## 2. 受け入れ条件の確認

| AC | 結果 | 証拠 |
|---|---|---|
| template構造の本文を受理する | 充足 | SCN-INT-PRBODY-001 |
| H1をタイトルにし本文から除く | 充足 | SCN-INT-PRBODY-001 |
| 必須見出しの欠落を拒否する | 充足 | SCN-INT-PRBODY-002（3見出しで検証） |
| 未解決placeholderを拒否する | 充足 | SCN-INT-PRBODY-003 |
| 条件付き見出しを必須にしない | 充足 | SCN-INT-PRBODY-004、006 |
| Issue参照規約との同時充足 | 充足 | SCN-INT-PRBODY-005 |
| 必須見出しをtemplateから導出する | 充足 | SCN-INT-PRBODY-006 |
| dry-runでも拒否する | 充足 | SCN-INT-PRBODY-002、003、005はいずれもdry-run |
| 見出しを行全体で一致させる | 充足 | SCN-INT-PRBODY-007。**ラウンド2で追加** |
| code block内の見出しを数えない | 充足 | SCN-INT-PRBODY-008。**ラウンド2で追加** |
| code内のIssue参照を数えない | 充足 | SCN-INT-PRBODY-009。**ラウンド2で追加** |

### 2.1 開発考慮事項の適用判定（必須）

| ID | 判定 | 確認 |
|---|---|---|
| DC-PRIVACY | not-applicable | 個人データを扱わない。本文の一時fileは`os.tmpdir()`配下に置く |
| DC-OBSERVABILITY | not-applicable | logも計測も生成しない |
| DC-UX | not-applicable | UIを持たない。CLIのusageは既存の宣言機構で生成する |
| DC-TOKENS | not-applicable | UI要素を持たない |

## 3. 肯定的評価

- **第1段階を実装せずに済むことを実測で確認した。**Issue本文は複製4箇所の解消を第1段階として要求しているが、`ce1ca99b`が既に解消していた。**症状の記述ではなく現在のfileを読んだことで、不要な作業を回避した。**
- **必須見出しを実装へ書き写していない。**配布templateから導出するため、templateと独立に古くなる経路が構造的に無い。**書き写していれば、本Issueが指摘した複製の型をそのまま再生産していた。**
- test側のfixtureも同じ導出関数を使う。`conformingPullRequestBody`は`pullRequestRequiredHeadings`から組み立てるため、3 fileにあった本文fixtureの重複を1箇所へ集約した。
- 条件付き見出しを必須から外した。**Issue本文が「充足不能なACを作らない」と明記しており、`図表`を必須にすると条件を満たさない変更でPRを作れなくなる。**
- 型検査が既存の呼び出し4箇所を機械的に検出した。手作業の探索を要していない。

## 4. 敵対的評価

| 反例 | 結果 |
|---|---|
| Issue本文が第1段階として要求する複製が既に無い可能性 | **成立。**実測で確認し第1段階を実装しなかった |
| `Closes #N`を含む本文が第2段階の検証を通らない（矛盾の残存） | **不成立。**下記「矛盾の不在確認」を参照 |
| 必須見出しの一覧を書き写すとtemplateと分岐する | **成立。**導出方式にして回避 |
| 条件付き見出しを必須にすると充足不能になる | **成立。**除外規則を入れて回避 |
| **fixtureが導出関数を使うため、導出の変異を検出できない** | **成立。**下記「自己整合による変異の隠蔽」を参照 |
| 本文をargvへ載せると上限と引用に依存する | 成立。`--body-file`経由へ変更 |
| 既定branch追随で片側の仕様が消える | **成立しうる。**両側保存を個別に確認して回避 |
| **包含判定が`### 概要`や接尾辞付き見出しを充足として受理する** | **成立。**下記「包含判定の緩さ」を参照 |
| code block内の見出しが充足として数えられる | **成立。**codeを除去して是正 |
| code内の`Closes #N`が終端参照として数えられる | **成立。**同上 |
| PR本文の一時fileが残留する | **成立。**`try/finally`で削除して是正 |

### 矛盾の不在確認

Issue本文は次を要求している。

> 第1段階の完了後、`Closes #N`を含む本文が第2段階の検証を通ることを反例シナリオで先に確認する。通らなければ矛盾が残っている。

**実装前にこの確認を行った。**入力にはPR #987の実際の本文を使った。

| 検証 | 結果 |
|---|---|
| 構造検証 | `{"valid":true,"errors":[]}` |
| 参照検証 | `{"valid":true,"errors":[],"closes":[977],"relates":[965,966]}` |

**双方が同時に通る。**正本が要求する`Closes`本文が、配布templateの構造検証で拒否されることはない。矛盾は残っていない。

この本文は`## 図表`の節を持たない。**条件付き見出しを必須にしていれば、この確認は失敗していた。**

### 自己整合による変異の隠蔽

**初回の変異試験で、条件付き見出しの除外規則を外す変異が6 scenario全通過で生存した。**

原因は、test fixtureが検証対象と同じ`pullRequestRequiredHeadings`から本文を組み立てていたことである。導出規則を変えるとfixtureの本文も同時に変わるため、**両者が同じ向きにずれて不一致が生じない。**

一覧をfixtureへ書き写せば検出できるが、それは本Issueが解こうとしている複製そのものである。そこで**導出規則自体を対象とするSCN-INT-PRBODY-006を追加した。**配布templateのH2見出しを導出関数を経由せず原文で読み、条件付き見出しが必須へ入らないこと、無条件見出しがすべて必須へ入ることを要求する。前提が失われた場合（templateから条件付き見出しが消えた場合）はGivenで停止する。

追加後、同じ変異は1 scenarioを失敗させる。

### 包含判定の緩さ

**ラウンド2の自動reviewで、必須見出しの判定が緩すぎることが検出された。**

初稿は`body.includes("## " + heading)`で判定していた。この形は次をすべて充足として受理する。

| 本文 | 初稿 | 是正後 |
|---|---|---|
| `## 概要` | 受理 | 受理 |
| `### 概要` | **受理** | 拒否 |
| `## 概要（補足）` | **受理** | 拒否 |
| `## 概要 extra` | **受理** | 拒否 |
| code block内の`## 概要` | **受理** | 拒否 |

**template契約を満たさない本文が検証を通過する。**本Issueの目的は契約の充足を強制することであり、緩い判定はその目的を直接損なう。codeを除いた本文の行全体一致へ変更した。

同じ理由でIssue参照もcodeを除いた本文から抽出する。本文へ参照の書き方を例示しただけで終端参照が成立してはならない。

除去には既存の`withoutCode`と`withoutInlineCode`を束ねた`withoutMarkdownCode`を用いる。**新しい除去規則は書いていない。**行構造を保つのは、見出しの行全体一致に行境界が必要なためである。

## 5. 指摘

| ID | 深刻度 | 内容 | 状態 |
|---|---|---|---|
| S71-M-01 | Medium | fixtureが導出関数を使うため導出規則の変異を検出できなかった | 是正済み。SCN-006を追加 |
| S71-H-01 | High | **包含判定が`###`見出し・接尾辞付き見出し・code block内の見出しを充足として受理していた** | 是正済み。SCN-007、008で確認 |
| S71-M-02 | Medium | code内の`Closes #N`を終端参照として数えていた | 是正済み。SCN-009で確認 |
| S71-M-03 | Medium | PR本文の一時fileを削除していなかった | 是正済み。`try/finally`で再帰削除 |
| S71-M-04 | Medium | 追跡表のREQ-SQ-022にCLI層の実装が無かった | 是正済み。`src/cli.ts`、`src/cli-usage.ts`を追加 |
| S71-L-01 | Low | 不均衡なH1やH1欠落時のタイトル導出が空になる | 是正済み。空タイトルを明示的に拒否 |
| S71-L-04 | Low | artifactのcode span末尾に空白があった（MD038） | 是正済み。文言を変更 |
| S71-L-02 | Low | 本文の内容品質を判定しない | **意図的。**Issue本文が対象外と明記 |
| S71-L-03 | Low | 事前確認templateの全項目は機械検証しない | **意図的。**Issue本文が対象外と明記 |

### ラウンド予算による打ち切り

**ラウンド2で収束した。**未解決のCritical/Highは0件、High 1件とMedium 4件はいずれも是正済み、残るLowはIssue本文が明示的に対象外としたものである。`.agent-skill-chain/docs/02_品質基準.md`はMedium/Lowだけを理由に追加ラウンドを起こさないことを求めており、追加ラウンドの根拠が無い。上限3ラウンドに対して1ラウンドの余裕を残している。

## 6. ラウンド固有の確認

### ラウンド1

全評価基準を確認した。Medium 1、Low 3。Medium 1は変異試験で検出し是正した。新規Critical/High 0件。判定 **rejected（ラウンド2の自動reviewを待つ）**。

### ラウンド2（自動review）

Major 1、Minor 4。**Major 1は必須見出しの包含判定が緩く、template契約を満たさない本文を通していた欠陥であり、本Issueの目的を直接損なう。**`ea148b4c`で是正した。Minor 4のうち3件（code内のIssue参照、一時fileの残留、追跡表のCLI層欠落）も実在として是正し、1件（MD038）は文言を変更した。判定 **approved**。

## 7. テスト結果

| 層・検査 | コマンド | 件数 | 判定 |
|---|---|---|---|
| 形式 | `npm run format:check`、`npm run docs:format`、`npm run test:format` | exit 0 | pass |
| 静的 | `npm run lint`、`npm run typecheck`、`npm run source:check` | exit 0 | pass |
| 契約 | `npm run project:quality`、`npm run cli:check`、`npm run workflow:check`、`npm run trace:check`、`npm run architecture:check` | exit 0 | pass |
| 統合 | `npm test` | 953 scenario全通過、5074 step全通過 | pass |
| 適合 | `npm run conformance:check`、`npm run package:check` | exit 0 | pass |
| 既定branch比較 | `--root=候補 --trusted-root=既定branch` | `valid: true` | pass |

検査の変異試験。

| 変異 | 失敗scenario数 |
|---|---|
| 構造検証を外す | 3 |
| placeholder検出を外す | 1 |
| 条件付き見出しの除外を外す | 1（SCN-006の追加前は0） |
| Issue参照検証を外す | 1 |
| H1除去を外す | 1 |
| 必須見出しの導出元を空にする | 6 |
| 見出し判定を包含へ戻す | 4 |
| 見出し判定でcodeを除去しない | 1 |
| 参照検証でcodeを除去しない | 1 |
| 変異なし | 0（13件全通過） |

**変異試験の前に作業treeをcommit済みにした上で実施し、各変異の後は退避した原本の複写で復元した。**`git checkout`を後始末に使っていない。

**`npm test`と`conformance:check`を同時に走らせない。**同時実行では`dist/bin`が実行中に再構築され、E2E 10件が`Cannot find module`で落ちる。上表の実測値はいずれも単独実行で取得している。

## 8. 配布物影響

| 変更path | 配布境界に入るか | 影響 |
|---|---|---|
| `src/adapters/github.ts` | 入る | `dist/src/`へcompileされる。PR作成が`--body-file`経路になる |
| `src/cli.ts` | 入る | `dist/src/`へcompileされる。`pr create`が`--body-file`を必須にする |
| `src/cli-usage.ts` | 入る | `dist/src/`へcompileされる。usage出力に新flagが現れる |
| `src/domain/delivery.ts` | 入る | `dist/src/`へcompileされる。不適合な本文を拒否する |
| `src/domain/issue.ts` | 入る | `dist/src/`へcompileされる。本文検証を提供する |
| `docs/specs/**` | 入らない | 製品仕様 |
| `test/**` | 入らない | test資産 |

判断: 配布物を更新した

根拠: `src/`は`dist/src/`へcompileされて配布境界に入る。**consumerから観測できる変化がある。`pr create`は`--body-file`を必須flagとして要求するようになり、指定しない既存の呼び出しは`ASC-CLI-VALIDATION-001`で拒否される。** 利用者へ届く形での宣言は`src/cli-usage.ts`のflag定義が単一正本であり、`npm run cli:check`と`--help`出力がそこから生成される。配布文書側の追随が必要な箇所は`cli:check`がexit 0であることで確認した。

## 9. 独立reviewの成立

| 条件 | 充足 |
|---|---|
| reviewerが実装担当の判断を入力に持たない | 充足。差分と実測値だけを入力にした |
| 各ラウンドの判定と根拠が原文引用を伴う | 充足 |
| 有限ラウンドで終了する | 充足。1ラウンドで収束 |
| 外部証拠 | PR作成後のCI結果とautomated reviewで補う |

**変異試験がfixtureの自己整合による隠蔽を検出した。**静的検査12種と948 scenarioはすべて通過しており、実行だけでは検出できなかった。

**ラウンド2の自動reviewは、実装者自身の変異試験が対象にしていなかった経路を検出した。**変異試験は「実装した規則を外す」形で設計しており、**規則そのものが緩い**場合は変異させる対象が無い。包含判定の緩さは、独立した読解でしか出なかった。

## 10. 仕様整合性

`docs/specs/`の4 fileを更新した。REQ-SQ-022、AC-SQ-022、QLT-PRBODY-001を採番し、追跡表でSCN-INT-PRBODY-001〜006へ結び付けた。

**要件IDは`REQ-SQ-021`ではなく`REQ-SQ-022`を採番した。**分岐時点の既定branchには`REQ-SQ-020`までしか無かったが、並行して進んでいた#977が`REQ-SQ-021`を採番しており、両方をmergeするまで衝突が検出されない。#977のmerge後に追随して確認している。

Issue参照規約は`.agent-skill-chain/docs/01_開発ワークフロー.md`が所有し、本Issueの仕様節は**規約本文を複製せずMarkdown linkで参照する。**初稿では規約の文言を引用しており、`ASC-CANON-SINGLE-SOURCE-001`が複製として拒否した。**本Issueが解こうとしている型を実装者自身が再生産しかけ、既存の機構が検出した事例である。**

## 11. 総合判定と再開地点

**判定: approved**

- 未解決Critical: 0件
- 未解決High: 0件
- 未解決Medium: 0件
- 記録したLow: 4件（S71-L-01とS71-L-04は是正済み、S71-L-02とS71-L-03はIssue本文が対象外と明記）

再開地点: ステップ11（PR作成）
