# 引き継ぎ: agent-skill-chain（2026-09-12 セッション）

**このファイルを最初に全文読むこと。** 決定事項・設計根拠・未処理項目をすべて含む。

---

## 0. 最初に読むもの

`AGENTS.md` → `.agent-skill-chain/00_利用案内.md` → `docs/00_運用ポリシー.md` / `01_開発ワークフロー.md` / `02_品質基準.md`。各Stepの開始時に `asc-step` skill を呼ぶ。

**基準時点**: `origin/main` = `632c7f1d`（PR #1361 merge直後）。着手前に必ず `git fetch origin main` と `gh pr list` で更新を確認する。

---

## 1. owner が明示した方針（すべて有効・優先順）

1. **派生した欠陥は出所のIssueのscope内で直す。** 別Issueにするのは「目的が変わる」「別ownerの決裁が要る」「安全境界を広げる」場合だけ
2. **報告本文の「対応策」を成果物の上限にする。** 隣接fileの同型literalは、報告が名指ししていなければ触らない
3. **諮問先（codex / fable）の「別Issueへ」提案を自動採用しない**
4. **PRを出すだけでなくmergeまで行う。** `merge.mode=disabled` なのでASCのStep 11はPRで終端し、mergeは `gh pr merge --merge` で進行役が行う。**squash と rebase は禁止**
5. **細かくIssueを分けない。** owner原文「一気にひとまとめのissueにしてしまって全部一度に直しても大して工数必要ない。逆に分けている分だけコストがかかっている」。1 Issueあたりの固定費（Step 0〜8の文書と同期、独立review 10〜15分、フルテスト10分、artifact、PR、CI 8分）が実装そのものより大きく、分けるほど他PRへの追随が増える
6. **速度を優先する。** owner原文「なんでもいいのだけど早く対応して」「そんなに難しくないはずです。すべて」

---

## 2. owner 決裁の全件（実施済み・記録済み）

| # | 決裁内容 | 記録先 | 状態 |
|---|---|---|---|
| D-1 | **#1357 は #1287 を先に実装してから追随させる。** 上限引き上げもPR作り直しも当初は採らない | PR #1357コメント、Issue #1287コメント | 有効 |
| D-2 | **staging digest の再固定を1回だけ許可**（`refreshStoredStagingDigest` の直接呼び出し）。迂回であることを認識したうえでの決裁 | PR #1354 closeコメント（訂正コメント付き） | 使用済み・1回限り |
| D-3 | **review予算を追加5回まで許可** | 本文書 | **未使用** |
| D-4 | **`REVIEW_ROUND_BUDGET` 3→6、`REVIEW_RECOVERY_ROUND` 4→8** | Issue #1287コメント | #1287で実装済み・未merge |
| D-5 | **採番はIssue番号由来にする。UUIDv7は採らない** | Issue #1360 | 未実装 |
| D-6 | **進行中3件を先にmergeしてから機構側3件へ進む** | 本文書 | #1342完了、残り2件 |

### D-4 の補足

`REVIEW_RECOVERY_ROUND` は元々 `BUDGET + 1` の導出値だった。8にすると取り直し枠が1→2に増える（3→6の倍化と整合する）。実装では `BUDGET + 2` とした。

### D-5 の補足（UUIDv7を採らない理由。**これは必ず引き継ぐこと**）

| 性質 | 連番 | UUIDv7 | Issue番号由来 |
|---|---|---|---|
| 並行branchで衝突しない | ✗ | ○ | ○ |
| `^TERM-[A-Z0-9][A-Z0-9-]*$`（`src/domain/spec.ts:119`）を通る | ○ | △ 小文字は弾かれる | ○ |
| **merge損失検知のtokenになる**（`src/domain/merge-integrity.ts:16` の `[A-Z][A-Z0-9]*(-[A-Z][A-Z0-9]*)*-[0-9]{2,}`） | ○ | **✗ 末尾群が16進なので一致しない** | ○ 末尾が `-01` |
| 人が読み書きできる | ○ | ✗ | ○ |
| 出所のIssueへ辿れる | ✗ | ✗ | ○ |

**UUIDv7の決定的な不利は3行目。** 用語IDが損失検知のtokenでなくなると、mergeが用語行を落としても `audit:check` が気付かない。今回 `TERM-ASC-106` の消失を捕まえたのはまさにこの機構であり、外す変更は目的と逆向きになる。

---

## 3. 現在の状態

### merge済み（本セッション）

| PR | Issue | merge commit |
|---|---|---|
| #1353 | #1349 | （前セッション） |
| **#1361** | **#1342** | **`632c7f1d`** |
| #1354 | #1342 | **closed（作り直し）。** 理由は§5.1 |

### OPEN PR

| PR | Issue | branch | 状態 | 備考 |
|---|---|---|---|---|
| #1358 | #1350 | `bugfix/1350-routing-tier-provenance` | BEHIND | §6.1 |
| #1357 | #1340 | `bugfix/1340-json-flag-usage` | DIRTY・予算4/4で詰み | §6.3 |
| #1364 | — | `fix/darwin-review-draft-output` | BLOCKED | **別セッションの作業。触らない** |

### OPEN Issue

| Issue | 内容 | 状態 |
|---|---|---|
| #1287 | 既定branch追随がreview予算を消費する | **実装完了・staging未作成**（§6.2） |
| #1340 | routing roles/ceiling のJSON flag宣言 | PR #1357で詰み |
| #1341 | provider観測の失敗診断 | **実装完了・PR未作成**（§6.4） |
| #1343 | tierMapping key の契約 | **未着手。結論は出ている**（§6.5） |
| #1350 | routing tier の provenance | PR #1358（§6.1） |
| #1352 | 是正範囲の拘束と「最小実装」の測度 | 未着手 |
| #1360 | 並行作業で衝突する採番 | **起票済み・設計あり**（§6.6） |
| **#1365** | **Step 11後のstaging封印** | **本セッションで起票**（§6.7） |
| **#1366** | **`review round --init` の誤誘導診断** | **本セッションで起票**（§6.8） |

**注意**: 以前の記録で「staging封印は #1074」と書いていたのは**誤り**。#1074 は「review予算3をCI実行前に使い切る」という別Issueで既にCLOSED。正しくは **#1365**。PR #1354 へ訂正コメント済み。

---

## 4. 独立reviewが捕まえた実在欠陥（全9件・すべて是正済み）

| Issue | ID | 内容 | 重大度 |
|---|---|---|---|
| #1342 | REV-01 | 配布schemaが `reconfirmation` / `postTerminalIntake` を定義せず、製品の正規出力を拒否 | Medium |
| #1342 | REV-02 | Step 11後の再確定entryを読取り側が位置検査せず、手編集journalが `workflow verify` を通る | Medium |
| #1342 | REV-04 | REV-03の是正が正本の条件を部分複製し、契約を分岐させた | High |
| #1342 | REV-05 | `humanOverride` が「先行する通常entry」に数えられ、**一度も実施していないStepを再確定できた** | Medium |
| #1342 | CodeRabbit | `--reconfirm=false` が有効として通る。**利用者が無効化したつもりの入力が逆の記録になる**。同型の `--post-terminal-intake` も同時に是正 | Minor |
| #1341 | REV-01 | `run()` が spawn失敗を終了値1へ潰し、**AC-02の本番経路が成立していなかった** | High |
| #1341 | REV-02 | executorがargs配列を書き換えると診断が偽のargvを報告 | Medium |
| #1341 | REV-03 | timeout・出力上限超過（processは起動済み）まで「起動できません」と報告 | Medium |
| #1350 | REV-01 | `provenance.source` の語彙が5値なのにTSDocが3値と誤記し、AC-04が `git` に限定 | Medium |

**いずれも独立reviewが無ければ通していた。** codex reviewer を省略しないこと。

---

## 5. 本セッションで確定した運用規律（**すべて実害が出た**）

### 5.1 mergeの中で内容を消してはならない（**PR 1本を失った**）

`src/domain/merge-integrity.ts` の `LOSS_TOKEN_PATTERN` に一致する token が merge commit で片親から消えると `audit:check`（CI必須）が検出する。

**PR #1354 は2回の追随mergeで用語IDの採番し直しをmerge commitの中で行い、`TERM-ASC-106` と `TERM-ASC-107` を失った。** merge commitの内容は後から直せず、履歴の作り直し → review sessionのanchor切れ → staging ごとやり直しになった。

**さらにこの機構は実在の欠陥を捕まえていた。** 1回目の衝突解決は、自分のentryを107へ移すと同時に**既にmainへ入っていた#1335の変更履歴行まで107へ書き換えていた**（用語台帳は106のまま）。手作業で発見して是正したが、調停という操作そのものが持つriskである。

**正しい手順**: mergeでは**両方を残す**（IDが重複してよい）→ **mergeの後の通常commit**で採番し直す。PR #1361 の `3e360b74`（merge）と `8ca38ce6`（採番）が実例。

### 5.2 Step 11記録後のstagingを編集しない

詳細は §6.7（Issue #1365）。**発見は review artifact へ書く。03 へ追記しない。** どうしても触るなら `review round --apply` より**前**に済ませる（applyは検査の後に `refreshStoredStagingDigest` を呼ぶので1回だけ吸収できる）。

Issue #1350 では、stagingへの追記を巻き戻して整合させ、発見記録をartifact側へ置くことで**迂回せずに解決した**。この方法を優先する。

### 5.3 テスト実行中に `npm run build` をしない（1日で3回踏んだ）

`build` は `clean` を伴い `dist/` を消すため、走行中のE2Eが `Cannot find module '<worktree>/dist/bin/agent-skill-chain.js'` で落ちる。**`SCN-E2E-WFSTEP-*` や `SCN-INT-SCRIPTPIN-*` が12件同時に落ち、実装の欠陥や意味的衝突に見える。** 別worktree同士の並行実行は安全。

### 5.4 変異試験は単一のStep番号・単一の値で検査しない

`humanOverride` 除外を「Step 3だけ」に狭める変異が、Step 5だけを見るscenarioを通過した。**2つ以上の異なるStep番号・値で検査する。** また、後段の条件に覆われて生存する変異がある。生存したら等価かどうかを必ず判定して記録する。

### 5.5 review artifact の書式

- file名は `^\d+_課題\d+.*レビュー\.md$`（`scripts/check_file_audit.ts:29`）。**`review artifact --init` の既定出力 `<Issue番号>_レビュー.md` はこの検査を通らない**（生成器と検査器の不一致）
- **先頭連番の一意性は検査されない。** `199_` が2件といった衝突は黙って通る
- **個別監査表からは `dist/` の行を削る。** `check_file_audit.ts` は `isGeneratedDistributionPath` で除外した件数を期待する。配布物影響の表（§8）には生の差分をそのまま載せる
- 現在の最大連番は `202`（PR #1363）。次は `203`

### 5.6 識別子は書いた場で実在を確かめる

本セッションで2回踏んだ。(1) 存在しない40桁SHA `8e7405b95af6f9b01b0e9b32e96f6cbd2e27e2d3` をreview promptへ書き、(2) staging封印の件を存在しない文脈の #1074 として参照し続けた。**Issue番号・SHA・file path・要件IDは書く前に1コマンドで確認する。**

### 5.7 他セッションとの並行

**別のClaudeセッションが同じrepositoryで作業している。** 本日 PR #1359（#1336）・#1362（#1337）・#1363 がそちらからmergeされ、そのたびにmainが動いて追随が発生した。PR #1364 も別セッションのもの。**着手前に `git fetch origin main` と `gh pr list` を確認し、他セッションのPRには触らない。**

---

## 6. 各項目の再開手順

### 6.1 PR #1358（Issue #1350）— 最初にやる

worktree `.worktrees/20260912_025416-1350-routing-tier-provenance`、HEAD `32d68c7d`

**commit構造**

```
32d68c7d fix(routing): provenance.sourceの恒等写しをAC-05とSCN-UNIT-TIERPROV-004で固定する
37b299b9 fix(routing): provenance.sourceの語彙をloaderのまま写すことを明文化する
a17ab1d9 docs(specs): Issue 1350の仕様変更履歴の行を追加する
c1de4268 merge: origin/main（PR #1353・#1355・#1359）を取り込む   ← 衝突なしの自動merge
36109d44 fix(routing): routing tierへ判定の信頼源と用途を出力し仕様外のprovider値を拒否する
```

- review session: round 2記録済み・`converged`
- staging digest: **一致している**（一度巻き戻して整合させた）。**これ以上 staging を編集しない**
- テスト: `a17ab1d9` で 1902 scenarios / 失敗0。**現HEADでの再実行が必要**
- 独立review: round 2でapproved（REV-01）→ 追加reviewでrejected（REV-01-RECHECK、REV-02）→ 是正済み。**是正後の再reviewは未実施**

**この過程で分かった設計判断（引き継ぐこと）**

`provenance.source` の語彙は5値（`filesystem` / `filesystem-legacy` / `git` / `git-legacy` / `git-floor`。発生源は `src/domain/policy.ts` の 1409・1468・1533・1554・1690行）。**`git-legacy` を `git` へ潰す是正は採らない。** 潰すと「どの形式のpolicyを読んだか」が出力から消え、信頼源を正しく示すという本Issueの目的そのものを失う。正しいのはAC側で、ACは「loaderの語彙をそのまま写す」という実装の保証を書くべきだった。

**未検査の分岐を申告済み**: `git-legacy` と `git-floor` を出す経路のscenarioは追加していない。有効なlegacy monolith manifestの構築はv0.2系policy形式の再現を要し、本Issueの対象（`routing tier` の出力）を超えるため。実測として、`schemaVersion` だけを差し替えた擬似legacy manifestは `legacy project policyが不正です` で判定へ到達しなかった。代わりに `tierProvenance` をexportし、5値すべての恒等性を SCN-UNIT-TIERPROV-004 で検査する。変異3件（git系をgitへ正規化／`-legacy`接尾辞を落とす／`git-floor`だけ読み替え）をすべてkill。

**残りの手順**: main追随（衝突を確認。あれば §5.1 の手順）→ 独立review → round 3記録 → artifact作成（`203_課題1350…レビュー.md`、`dist/`行を表から削除）→ `audit:check` → `workflow record --step=10 --post-terminal-intake` → push → CI → merge。

### 6.2 Issue #1287 — 最重要

worktree `.worktrees/20260912_115125-1287-follow-round-budget`、branch `feature/1287-follow-round-budget`、HEAD `b54abdb9`

**実装は完了している。** staging（Step 0〜8）と review 以降がすべて残り。

**実装内容**

- `REVIEW_ROUND_BUDGET` 3→**6**、`REVIEW_RECOVERY_ROUND` = `BUDGET + 2` = **8**（D-4）
- `REVIEW_ROUND_RECORD_LIMIT = 64` を新設（記録総数の上限。予算とは別の量）
- `ReviewRoundInput` / `ReviewRoundRecord` へ `followOnly?: true`
- 予算判定を `countedRounds()`（`followOnly` を除いた件数）に対して行う
- `followOnly` の round へ finding を載せることを拒否する
- `src/adapters/review-session.ts` に `isDefaultBranchFollowMerge()` を新設。**Git観測から導出し申告を信用しない**
- 既存scenarioの予算値literalを定数参照へ変更（設定値testではなく契約test）
- 新規 SCN-UNIT-REVIEWCONV-008（追随roundは予算へ数えない）、009（受理しない4つの形）

**判定述語（実測で確定。Issue本文の案は成立しないので必ず引き継ぐこと）**

次の3条件をすべて満たすときだけ `followOnly` を受理する。

1. candidate が merge commit で、**第1親が前roundのcandidate**
2. **第2親が `refs/remotes/origin/HEAD` のancestor**（任意branchの取り込みで予算を回避させない）
3. `git merge-tree --write-tree <第1親> <第2親>` の tree が **merge commit の tree 自身と一致**

**条件3が成り立つとき、merge commitのtreeは両親から完全に決まる。除外されたroundを通して実装を1 byteも持ち込めないため、追随を装った予算回避が成立しない。** これはIssue本文の未決事項「除外に上限を設けるか」への回答でもある。衝突解決は実装者が書いた内容なので条件3を満たさず、予算へ数える側に落ちる。

**Issue本文の「実装差分digestの一致」案は成立しない。** 追随すると比較基点自体が動くため、branchの寄与が1 byteも変わらなくてもdigestは変わる。#1340のPR #1357で実測（旧 `5b5e5e84…` / 新 `390907b0…`、path集合は一致）。

**実測（git 2.43.0）**

| merge | 内容 | 判定 |
|---|---|---|
| `c1de4268`（#1350の追随、衝突なし） | 著作contentなし | **一致** → 数えない |
| `3eff3e0c`（#1342の追随、採番し直しを含む） | 衝突解決あり | 不一致 → 数える |
| `81c00be7`（同上2回目） | 衝突解決あり | 不一致 → 数える |

**変異試験（`SCN-UNIT-REVIEWCONV` 9 scenario に対して）**

| 変異 | 内容 | 結果 |
|---|---|---|
| A | `followOnly` を予算から外す扱いをやめる | **生存（等価）**。予算検査は `!round.followOnly &&` で守られており非followのroundでは値が変わらない |
| B | `countedRounds` が `followOnly` も数える | killed |
| C | followOnly roundへのfinding禁止を外す | killed |
| D | Git観測による検証をやめ申告を信用する | killed |
| E | tree一致の検査を外す | killed |
| F | 第2親が既定branchのancestorである検査を外す | killed |
| G | 第1親が前roundのcandidateである検査を外す | killed（「実装commitを挟んでからのmerge」scenarioで解決） |
| H | merge commitでなくても受理する | **生存（等価）**。後続の第1親検査と `merge-base --is-ancestor undefined` の失敗に覆われる |

**規範文書の更新がまだ手つかず**

| file | 箇所 |
|---|---|
| `.agent-skill-chain/docs/02_品質基準.md` | 76行「最大3ラウンド契約」、78行「予算3ラウンドとは別枠で…取り直しを1ラウンド」、84行「round 5以降は拒否する」 |
| `.agent-skill-chain/docs/01_開発ワークフロー.md` | 170行「最大3ラウンド」、179行「同一scope最大3ラウンド、収束後の取り直し1ラウンド、通算4ラウンド」 |
| `.agent-skill-chain/templates/issue/04_レビュー.md` | 18行の残り予算欄、§0のラウンド欄「1 / 2 / 3」、§6のラウンド節 |
| `docs/specs/02_要件/01_ワークフロー要件.md` | REQ-WF-005 |
| `docs/specs/15_要件追跡/` | 追跡表と変更履歴 |

`scripts/check_file_audit.ts:799` は `MAX_REVIEW_ROUNDS = REVIEW_RECOVERY_ROUND` として定数を取り込むので自動追随する。

**#1287 へ追加で記録した2つの論点（Issueコメント参照）**

1. **追随を強制しているのはASCではなくGitHubのruleset。** 本repositoryの `main-protection` は `strict_required_status_checks_policy: true`（実測）。ASCは `src/adapters/github.ts:1616-1627` の `protectingRuleTypes` で**rule の型の存在しか見ておらず**、この値も merge queue の有無も一切観測していない
2. **根本解は merge queue。** `strict` を切ると「mainの最新状態と組み合わせてCIを通した」保証が失われ、gitが報告せず型検査も通る意味的衝突を誰も検出しなくなる。merge queue なら安全性を保ったまま追随が自動化される。ASCがすべきは**観測と報告**であり、門を足すことではない（`01_開発ワークフロー.md` の「診断の欠落に門を足さない」、REQ-LC-011の前例）

**assessment JSON**: `<scratchpad>/1287-assessment.json`（Q-01・Q-02・Q-07がfalse → full mode）

**残りの手順**: `issue create` で staging → 00〜03（材料はIssue本文と3つのコメントに揃っている）→ Step 1〜8記録と `issue sync --checkpoint=4` / `=8` → **フルテスト（予算値変更で他のscenarioが落ちないか確認）** → 独立review → round 1 → artifact → Step 10 → `pr create` → CI → merge。

**mergeすると #1357 の追随が通るようになる。**

### 6.3 PR #1357（Issue #1340）

worktree `.worktrees/20260912_015650-1340-json-flag-usage`、HEAD `41791499`

**予算4/4で詰んでいる。** #1287 のmerge後に追随させる。

**重要**: 追随は `docs/specs/15_要件追跡/01_変更履歴.md` で衝突する（実測。衝突pathはこの1 fileだけ）。したがって #1287 の「自動mergeだけのroundは数えない」では救えず、**予算上限6/8が効いて初めて通る。** D-3（追加5回）はまだ使っていない。

### 6.4 Issue #1341（PR未作成）

worktree `.worktrees/20260912_092508-1341-observation-diagnostic`、HEAD `9646fcd9`

- 実装完了。`npm test` 1884 scenarios / 失敗0
- Step 9記録済み（ただし `implementationHeadSha` が `70aa3562` のままで、その後 `9646fcd9` へ進んでいる。**Step 9の再記録が要る**）
- scenario 7件（SCN-UNIT-OBSDIAG-001〜007）、**変異11件すべてkill**
- 独立review: 2回実施し計4件の指摘をすべて是正済み。**最終HEADでの正式reviewは未実施**

**設計判断（引き継ぐこと）**

- **成功経路の `entrypoint` は変えない。** codexの `codex app-server model/list` は論理的な入口名であり、00 §2.3「codex経路の観測結果は不変」を維持する。実argvにするのは失敗診断だけ
- **`launchFailure` は「子processが1つも起動しなかった」だけを意味する。** timeout（`ETIMEDOUT`）と出力上限超過（`ENOBUFS`）では子processは起動しており、これらを「起動できません」と報告すると利用者は実在するpathを疑って実際の原因へ到達できない。判定は `error.code` の列挙ではなく**pidの有無**で行う（実測: ENOENTは `pid=0`、timeoutと上限超過は実pidを持つ）
- `runJsonlSession`（公式Codex経路）にも同じ旗を通す。`error` eventはkill失敗等でも起きるため `child.pid === undefined` のときだけ立てる
- `ProviderExecutor` へ渡すargvは**複写**する。同じ参照を診断へ再利用すると、executorが書き換えた場合に偽のargvを報告する

**注意**: `src/lib/process.ts` は Issue #1024 の故障注入証跡3件（`docs/evidence/1024-consumer-acceptance/mechanism-1〜3`）が file全体のSHA-256 で束縛している。触ったら3 fileを更新し、**残余比較**（今回の追加箇所を除いた byte列が旧束縛commitのfileと完全一致し、残余のSHA-256が旧束縛値そのものになること）を実測して記録する。現在の束縛値は `2d0c9dcb6a84a4eae4007d1bbc9327740b8e81f2faec1b82ec07cf197023f4e9`。**hashだけ差し替えて「変わっていない」と書かない。**

**残りの手順**: main追随 → Step 9再記録 → 独立review → round 1 → artifact → Step 10 → `pr create` → CI → merge。

### 6.5 Issue #1343（未着手・**結論は出ている**）

**owner決裁は不要。** 諮問2件は「割れている」と整理されていたが、実際には報告本文の提案へ収束している。詳細は Issue #1343 のコメント（本セッションで投稿）に全量記載。要点:

- codexの「閉じた既知selector集合に限定」と fable の「aliasにせよ」は**同じことを言っている**
- 割れているのは「実model IDをrouting evidenceへ持つ件を別Issueにするか」だけで、owner方針2・3で決着（報告本文が名指ししているので #1343 の中で実装する）
- 両諮問の一致点: **正規化（`claude-opus-5[1m]` → `claude-opus-5`）を製品側で行わない**

**実測した事実**

- `validateTierSelection` は `mapping[model]` の素の辞書引き（`src/domain/role.ts:257`）。`model` は `routing tier --model=<値>` のCLI flagそのもの
- **製品自身のusage例は `--model=opus`**（`src/cli-usage.ts:217`）＝ alias前提
- 一方、本repositoryの `development.json` は `"claude-opus-5": "critical"`（`.agent-skill-chain/project/choices/development.json:144-147`）。**製品の例と自repositoryの設定が食い違っている**
- codexのkeyは `codex:provider_recommended_default:high:default` という**採用selectorであり model slug ではない**。報告本文の「provider `codex` は model slug」は #1257 でslug保守を廃止した後の現状と合わない。実装時に訂正する
- `PROVIDER_AUTONOMOUS_CEILINGS.claude.allowed = ["haiku","sonnet","opus"]`、override適格は `selection === "fable"`（`src/domain/role.ts:284-295`、`:330-333`）

**実装範囲**（報告本文の3点をそのまま）: (1) key契約の明記、(2) 実model IDをrouting evidenceの観測値として別fieldへ、(3) alias と ceiling 語彙の一致を `policy validate` で検査。

**`development.json` を新契約へ揃える必要がある。** 保護fileに該当するか着手前に確認すること。モード見込みは **full**（Q-01・Q-02がfalse）。

### 6.6 Issue #1360（採番衝突）

設計は Issue 本文とコメントに全量。**4種類の衝突源**を扱う。

| 採番 | 機械検査 | 実害 |
|---|---|---|
| ドメイン用語ID `TERM-ASC-<連番>` | 形式のみ（`src/domain/spec.ts:119`）。一意性は未検査 | #1335が106、#1336が107、#1337が108を取り、#1342が**3回**採番し直した |
| review artifact の file名 | `^\d+_課題\d+.*レビュー\.md$`。**先頭連番の一意性は未検査** | `199_` が2件、`200_` が2件 |
| ADR番号 | 未確認（`docs/adr/` は現在0件。**いまが最も安い**） | 過去に発生 |
| **仕様変更履歴の行位置** | なし | **最頻**。全Issueがヘッダ区切りの直後へ行を足すため、並行する任意の2 branchが必ず衝突する。#1357の追随で衝突したのはこの1 fileだけ |

**方針**: `TERM-ASC-<Issue番号>-<2桁連番>`。既存106件は改名しない（新規IDにだけ適用）。UUIDv7は採らない（§2のD-5）。変更履歴の行位置は行末追記にすると衝突しないが「最新が一番上」の読みやすさを失うため**owner判断が要る**。

### 6.7 Issue #1365（Step 11後のstaging封印）

本セッションで起票。§5.2 が現象。**回復経路が1つも無い**ことを実測済み（`review round --apply` も `workflow record --step=10 --post-terminal-intake` も先にdigest検査で落ち、製品の案内は到達不能）。

**未決**: 「正規の再固定経路を用意する」か「編集をその場で拒否する」か。**現状は「編集は通り、後で回復不能になる」という最悪の組み合わせ。** 決定権者は repository owner。

### 6.8 Issue #1366（`review round --init` の誤誘導診断）

本セッションで起票。利用側プロジェクトからの修正依頼（依頼1）。`src/adapters/review-session.ts:224` の「HEADを進めずに次roundを記録することはできません」が、**実際には誤った復旧へ誘導する**（典型原因は前roundの `--head` に是正後HEADを渡したこと。HEADを進めると取り違えが重なる）。判定は変えず文言だけを足す。

**同じ依頼の残りの項目は未整理。** 依頼本文（`v0.3.1-beta.135` / `56f66f2d` を対象、2026-09-12観測）はIDEで共有されたが依頼1しか取り込んでいない。**owner へ残りの依頼内容を確認すること。**

### 6.9 Issue #1352

前セッションで起票。是正範囲の拘束と「最小実装」の測度が無い件。未着手。

---

## 7. 環境

- 各worktreeは `npm ci --ignore-scripts && npm run build` 済み。新規worktreeでは必須
- `npm test` 約10分。**`conformance:check`（約13秒、87 scenario）は npm test の部分集合ではない。** 両方要る
- 既知flake: `SCN-INT-GITHUB-031`（600ms待機の計測）、`SCN-E2E-WFSTEP-044`。**単独再実行で確定させる**
- 独立review: `codex exec --skip-git-repo-check --sandbox read-only -C <worktree> --color never - < prompt.md`
  - **`--model` を指定しない**（provider既定が `gpt-6-astra`）
  - read-only sandbox では `/tmp` へ書けず cucumber が EROFS で止まる。reviewerには「実行できなければその旨を書き、合格したと書かない」と伝える
  - capacity エラーで落ちることがある。再試行で通る
  - **inline context（diffをpromptへ埋める）で6倍速い。** 探索させると1ラウンド6〜8分、抜粋を渡すと1分
- **fable も諮問先として使ってよい**（2026-08-31にowner が禁止を解除済み）
- scratchpad: `/tmp/claude-1000/-home-tatsuru-Projects-techbeansjp-free-AGENTS-md/69fc15b4-122a-4aba-aab3-f43c816ef91e/scratchpad/`
  - 諮問prompt、review出力、test log、PR本文、evidence JSON、変異script が全部ある
  - **別PCへ移るならこのdirectoryを持っていく。** 無い場合は作り直しになるが、本文書の情報だけで着手できる

---

## 8. 次にやること（優先順）

1. **PR #1358（#1350）を仕上げてmerge**（§6.1）
2. **Issue #1287 を Step 0〜11 で通してmerge**（§6.2。実装は完了済み）
3. **Issue #1341 のPRを作ってmerge**（§6.4）
4. **PR #1357（#1340）を追随させてmerge**（§6.3。#1287のmerge後）
5. **Issue #1343 に着手**（§6.5。結論は出ている）
6. #1360、#1365、#1366、#1352

**mergeのたびに他のPRへ追随が発生する。** 1本mergeしたら残りへ `git fetch origin main` して追随の要否を確認する。追随時は §5.1 の手順を必ず守る。owner方針5に従い、**まとめられるものは1 Issueにまとめて工数を下げる。**
