# 仕様書の書き方の規則への経路の測定（#1843）：設定

開発時の検証資料であり、配布対象に含めない。通常のASC実行時に読み込ませない。測定の仕組みは共通のもの（[../../shared-harness/](../../shared-harness/)）を使い、このdirectoryには設定だけを置く。#1840の設定（[../../1840-user-environment/config/](../../1840-user-environment/config/)）と同じ形である。

**状態：設定だけ（2026-11-28）。未固定・未測定。** `release.json`の2件は仮の値（`placeholder`）なので、fixture・固定・有料の実行はすべて拒否される。

## 目的

#1840のs-1で、ascの本文まで読まれても書き方の規則（雛形の`00_利用案内.md`の「書き方」）が読まれたのは、Cで0/3だった（Rは規則を含まない版で、0/3）。ownerの決定（2026-11-28）により、規則の正本は雛形の`00_利用案内.md`のまま、ascの本文（`skills/asc/SKILL.md`の「業務操作を単位にした実装と完了」）に次の1文を足した。

> 仕様書（要求・機能・画面などの仕様を記述した文書）を書く・直す変更では、雛形から作る場合も既存のfileを直接直す場合も、書く前に[仕様書の書き方](../../v05/templates/specs/00_利用案内.md#書き方)を読む。

導入先では、`project-assets`がこのlinkを`../../templates/specs/00_利用案内.md#書き方`に書き換える（`.agent-skill-chain/skills/asc/`から`.agent-skill-chain/templates/specs/`へ）。配布の写し`.agent-skill-chain/managed-runtime/skills/asc/SKILL.md`は書き換えず、`managed-runtime/v05/templates/specs/`へ解決する。

この測定で確かめること（Issue #1843の完了の基準）：

1. s-1（既存のFN-003・SCR-005を変更に合わせて書き直す）で、規則のある`00_利用案内.md`が読まれる（水準2/3）。書いた本文が#1840で固定した照合（7つの事実、経緯0、承認済みにしない）に合格する（水準1）。
2. 仕様書を書かない依頼（n-2 翻訳、n-3 今の仕様を聞く）で、規則や雛形が読まれない（水準1/1、ownerの決定 2026-11-28。[decision-criteria.md](decision-criteria.md)）。

## 条件

| | B（基準） | C（候補版） |
| --- | --- | --- |
| 中身 | Cから#1843の製品のcommit（1文、linkの書換え、その試験。一覧は[release.json](release.json)の`B.revertCommits`）をすべて`git revert`したもの | PR #1838のhead（#1832の規則と#1843の1文）。origin/mainに#1845をmergeした後の版 |
| tarball | `node scripts/pack-candidate.mjs`（Cと同じ版の番号） | 同じ |
| 導入 | #1840と同じ（専用のworktreeで`project-assets --register-claude-skill --apply`、読む契機`claude-md`を採用） | 同じ |

- 候補版だけでなくBを置く理由：共通の仕組みは条件を2つとして扱う（`judge.mjs`の`judgeRun`と`score.mjs`の`levelsVerdict`）ので、条件1つの設定は仕組みの変更が要る。#1845が仕組みを直している間に別の変更を足すより、同じ時期・同じ環境の対照を置く方が、読込みの差が1文によるものかを示せる。#1840のCは規則（#1832）を含むが1文を含まないので、Bは#1840のCと同じ位置づけで、#1840のCのs-1では利用案内の読込みが0/3だった。Bの費用は見込みで約1.6 USD（6×0.19＋12×0.03＋probe 0.13）。
- Bの合否は判定に使わない（[decision-criteria.md](decision-criteria.md)）。

## fixtureと依頼

fixtureは#1840のSP（会員サイト、既存のFN-003・SCR-005）とEC1（ECサイト）を、そのまま[conditions.json](conditions.json)の`fixtures`に置いた。依頼は[cases.json](cases.json)。依頼文は#1840と同じで、Skill名・fileのpathを含めない。

| 依頼 | fixture | 期待するSkill | 期待する読取り | 読まれてはならない | 書いたfile |
| --- | --- | --- | --- | --- | --- |
| s-1 FN-003・SCR-005を変更に合わせて書き直す | SP | asc | 本文、`00_利用案内.md` | | FN-003とSCR-005の両方。7つの事実、経緯0、承認済みにしない |
| n-2 「保証範囲を顧客と合意済みです」の英訳 | EC1 | なし | | 雛形・規則、warranty-scope | |
| n-3 今の仕様の有効期限を聞く | SP | なし | | 雛形・規則 | |

#1840からの違いは[decision-criteria.md](decision-criteria.md)の「#1840からの違い」。

## #1845に依存すること

この設定は#1845（PR #1848）の共通の仕組みで動く前提で書いた。#1845がmergeされる前の仕組みでは、次が働かない。

| 設定 | #1845の前の仕組みでの動き |
| --- | --- |
| 水準の`min`の分数（`"2/3"`・`"5/6"`・`"1/1"`） | 数として比べられず、すべての水準が不合格になる |
| s-1の`writes.requireFiles`（FN-003とSCR-005の両方） | 無視され、片方だけ書いた試行も合格しうる |
| `collect.mjs`の`work/`のHEADの照合 | 行われない |

雛形の照合に`managed-runtime/v05/`の写しを含めることは設定の値だけで働き、#1845に依存しない。

## 費用とトークン

- 2条件×3依頼×6回＝36試行と、probe 2回（fixture SP）。
- 見込み（#1840の記録：s-1 0.147、n-2 0.025、n-3 0.032 USD。s-1は規則（約17.5 KB）を読む分を足して0.19）：s-1 12試行×0.19＝2.28、n-2・n-3 24試行×0.03＝0.72、probe 2回×0.13＝0.26。計 **約3.3 USD**（計画の単価で約4.3 USD）。入力（入力＋cache）約280万、出力約9万トークン。
- 上限：ownerの上限20 USDは#1843・#1844・#1846の**合計**で、各Issueへの割当て（2026-11-28、3つのIssueに記録）で守る。このIssueの割当ては**6 USD**（#1844は10、#1846は3）。共通の仕組みの`priorSpend`は台帳を1つしか取れず、他のIssueの支出を足せないので、`ownerCapUsd`には合計ではなくこの割当て6を書いた。`capUsd`は6 USD（余裕0.5、停止の線5.5 USD）。1試行の予算0.5 USD、probe 0.35 USD。
- 採点はモデルを使わない。
- 減らす案：Bを3回にする仕組みは無い（回数は全体で1つ）。Bを置かない場合は、仕組みの変更が要る（上の「条件」）。

## 測定の前に残っていること

1. #1845（PR #1848）がmainにmergeされる。
2. このbranchにorigin/mainをmergeし、PR #1838のheadを決める（独立レビューの是正を含む）。
3. Cをpackし、そのcommitで`release.json`の`B.revertCommits`（固定の時点の#1843の製品のcommitすべて。足りなければ一覧を直す）を`git revert`してBをpackする。`release.json`の`placeholder`を消し、sha256・`packedFromCommit`を書く。
4. dry run（B・C）：`dryRun.installedDiffExpected`のとおり、導入後の差がascの本文（とその写し）、`managed-runtime/src/project-assets.mjs`、導入の記録だけであることを確かめる。共通の仕組みのdry runは本文の中身を見ないので、次の2点は統括がdry runで作ったfixtureで確かめ、結果をこのREADMEに書く。
   - Bの導入先の`.agent-skill-chain/skills/asc/SKILL.md`と`.agent-skill-chain/managed-runtime/skills/asc/SKILL.md`に`00_利用案内.md#書き方`が無い。
   - Cの導入先の同じ2fileの1文のlinkが実在のfileに解決し（前者は`.agent-skill-chain/templates/specs/00_利用案内.md`、後者は`.agent-skill-chain/managed-runtime/v05/templates/specs/00_利用案内.md`）、そのfileに見出し`## 書き方`がある。
5. 独立レビューの後に`fixation.mjs init`で固定し、固定のcommitをこのREADMEに書く。
6. ownerの目印fileの承認を`results/probe-approval.json`に記録し、probe（B・C）。
7. 測定（36試行）、`collect.mjs`・`judge.mjs`。結果を`docs/evidence/1843-spec-rule-path/README.md`に書く。

## 手順（統括が行う）

#1840の[README](../../1840-user-environment/config/README.md)の「手順」と同じ。`EV=docs/evidence/1843-spec-rule-path/config`、条件は`R`・`C`ではなく`B`・`C`、fixtureは`SP`・`EC1`、probeのfixtureは`SP`。

```text
H=docs/evidence/shared-harness
EV=docs/evidence/1843-spec-rule-path/config
node $H/dry-run.mjs <scratch>/run1843dry --tarball-B $TGZ_B --tarball-C $TGZ_C --config $EV --out <scratch>/run1843dry.json
node $H/run-all.mjs planned <scratch>/run1843/runs --fixtures $FX --ledger $LEDGER --config $EV   # --runを付けなければモデルを呼ばない
```

## 限界

- Bashが無いので`start`を実行できない（#1840と同じ）。
- 読取りはfileの単位で数え、`00_利用案内.md`の「書き方」の節まで読んだかは確かめない。
- 読取りは試行の中のどこで行われても数え、「書く前に」読んだか（Write・Editより前か）は確かめない。1文は書く前に読むことを求めるが、完了の基準は「読まれる」だけである。
- 各条件6回。数試行の差は偶然の範囲を出ない。
- 仕様書に関係しない依頼（n-2・n-3）はascを読まない依頼なので、ascを読む仕様書以外の変更（コードの修正など）で規則が不要に読まれるかは測らない。
- 依頼はs-1の1件だけで、雛形から新しく作る依頼、要求・要件の文書を直す依頼は測らない。
