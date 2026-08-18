# DESIGN: PRマージのたびに他のopen PRのゲートレビューがbase SHA不一致で停止する

- Issue: `ISSUE-703`
- 対応する SPEC: `SPEC.md`

## 目的・対象範囲

本設計は、証跡記録処理（`agent-skill-chain gate submit-evidence`）が GitHub PR review へ証跡を投稿する前に行う受理判定の構造と、記録処理が各入力をどのツリーから読むかを定める。目的は、repository default branch が前進しただけで他の open PR の証跡投稿が停止する状態を解消し、同時に「記録処理が読む入力の由来を GitHub が attest したコミットへ固定する」という信頼境界（不変条件 I5 を機械的に支える機構）を弱めないことである。

対象は証跡記録処理の受理判定・拒否メッセージ・入力の供給元に限る。起動スクリプト（`.agent-skill-chain/scripts/gate-local-review.sh`）の受理条件・実行内容、証跡スキーマ、レビュアの判定内容、証跡検証・ゲート集約の経路、ローカルモードの記録経路は変更しない。

## 前提・用語

用語は SPEC.md の用語表（記録実行 worktree・trusted base SHA・PR base SHA・差分基点・到達可能・変更前挙動）に従う。本設計が追加で用いる語は次の 1 つに限る。

| 用語 | 本設計での意味 |
|---|---|
| 供給元ツリー | 記録処理がある入力を読み取る対象。コミット SHA によって内容が確定する Git コミットのツリーと、HEAD の位置および未コミットの内容に依存する記録実行 worktree の作業ツリーとを区別するために用いる。 |

記録処理は GitHub モードでのみ動作し、当該 PR の metadata と repository metadata を既に取得している。記録処理の実行コードは、起動スクリプトが trusted base SHA を checkout した隔離 clone で構築したものであり、記録実行 worktree の生成物ではない。記録実行 worktree は進行役の default branch worktree であり、複数の Issue worktree と Git object store・ref store を共有する。

## 設計セグメントで確定させた判断

### 判断1: 未 push のローカルコミットに対する追加検証は行わない。入力から HEAD 依存を無くすことで対処する

SPEC.md の未決事項は「記録実行 worktree の HEAD が、GitHub が返す default branch の現在の先端そのものから到達可能であることまで追加検証するか」を設計セグメントへ委ねている。**本設計は追加検証を行わないことを確定する。**

追加検証が意味を持つのは、記録処理が記録実行 worktree の作業ツリーからファイルを読む場合に限られる。変更前は「HEAD が PR base SHA と完全一致」かつ「tracked file が clean」であることにより、作業ツリーの内容が GitHub の attest したコミットのツリーへ transitively 固定されていた。完全一致を到達可能性へ緩めると、HEAD に任意の子孫コミットを置けるためこの固定は失われる。**本設計は失われた固定を別の検査で作り直すのではなく、判断3 により記録処理の全入力の供給元をコミットのツリーへ移し、作業ツリーからの読み取り自体を無くす。** その結果、HEAD にどのコミットが置かれていても記録処理が読む値は変更前と同一（trusted base SHA および target SHA のツリーの内容）になり、review policy を記録実行側から差し替えてコアレビュー要否や要求 profile を引き下げる経路は生じない。

追加検証を採らない理由は 2 つある。第一に、上記により HEAD の内容が記録処理の入力へ一切影響しないため、追加検証が守るべき対象が無い。第二に、追加検証は GitHub への追加問い合わせを必要とし、応答を得られないときに証跡投稿が止まる新たな停止条件を作る。SPEC.md がこの事項を要件として固定しなかった理由も同じ懸念であり、本 Issue の目的は「default branch の前進だけでは証跡投稿が止まらないこと」である。守る対象の無い検査のために停止条件を増やす選択は目的に反する。

記録実行 worktree の HEAD に対する要求は、default branch を checkout していること・trusted base SHA が HEAD から到達可能であること・tracked file が clean であることの 3 つとなる。未 push のローカルコミットを持つ状態は、default branch への変更を PR 経由に限る不変条件 I4 に反する状態であるが、その検出は本 Issue の射程ではなく、検出しなくても記録処理の入力・判定・証跡の内容は変わらない。

### 判断2: 差分基点と trusted base SHA は単一の値として扱い、PR base SHA へ直接結線する

SPEC.md の要件本文は trusted base SHA を PR base SHA に固定することを求め、AC-4(a) は指定 base SHA が PR base SHA と一致することを求める。**本設計は、差分基点と trusted base SHA が常に同一値であること、およびその同一性を PR base SHA との照合として実現することを、設計上の不変として明示する。** 実現は次の 3 点の連鎖による。

1. 起動スクリプトは受け取った 1 つの base SHA 引数を、差分基点・証跡 base SHA・trusted base SHA の 3 つの環境変数すべてへ同じ値として渡す（変更前挙動を維持する）。
2. 記録処理は PR metadata 照合において、指定 base SHA と trusted base SHA の**両方**が当該 PR の `base.sha` と一致することを 1 つの検査で確認する。両者の同一性はこの検査から従属的に成立し、いずれが食い違っても PR metadata との不一致として提示される。これが両者を結線する唯一の点である。
3. 記録処理は以降、差分基点・launcher digest 算出・review policy の読み取り・証跡への `execution.trusted_base_sha` 記録のすべてに同一の値を用いる。証跡には両者を別フィールドとして持たせない。

両者を互いに比較するのではなく PR base SHA へ直接照合するため、AC-4(a) が要求する「PR metadata との不一致である旨」の提示と、要件が求める trusted base SHA の固定が、同一の検査で同時に成立する。証跡検証側も同じ値を trusted base SHA の期待値として用いるため、記録と検証で基準が分岐しない。

### 判断3: 記録処理の入力はすべてコミットのツリーから読む

AC-2 が一致を要求する対象は経路集合とコアレビュー要否分類だが、各入力をどのツリーから読むかは規定されていない。**本設計は次の表を確定する。記録実行 worktree の作業ツリーは、いずれの入力の供給元にもならない。**

| 入力 | 供給元ツリー | 読み取り手段 |
|---|---|---|
| 承認対象成果物の経路集合・コアレビュー要否分類の対象経路 | 差分基点コミットと target SHA の三点差分（コミット同士） | `git diff --name-only <差分基点>...<target SHA>` |
| 各成果物の内容・digest | target SHA のツリー | `git show <target SHA>:<path>` |
| review policy（project policy manifest）とその検証スキーマ | trusted base SHA のツリー | `git show <trusted base SHA>:<path>` |
| launcher 構成の digest | trusted base SHA のツリー | 同上 |

三点差分は merge-base を基点とするため、記録実行 worktree の HEAD が差分基点より前進していても、差分基点より後の default branch コミットが変更した経路は結果へ入らない。成果物の内容は target SHA のツリーから読み、コアレビュー要否分類の判定規則である review policy は差分基点（＝ trusted base SHA）のツリーから読むため、経路集合・成果物・分類のいずれも HEAD の位置に依存しない。差分基点より後の default branch コミットが review policy を変更していても、分類結果は変わらない。trusted base SHA が HEAD から到達可能であることを受理条件としているため、その Git object は記録実行 worktree に存在し、この読み取りに追加の取得や問い合わせを要しない。

記録処理は Coordination Backend を GitHub に固定して扱い、設定ファイルを作業ツリーから読まない。証跡へ転記する light review の決定は、GitHub モードでは作業ツリー外の作業領域に生成された scaffold から読むため HEAD に依存せず、かつ証跡検証側が同じ手続きで再評価した値と照合するため、記録側が独自に選んだ値は検証を通らない。

## 要件 → 設計要素の対応表

| 要件 / AC-ID | 対応する設計要素 | 備考 |
|---|---|---|
| 完全一致を要求せず到達可能性を受理条件とする | E1, E4 | 完全一致検査を削除し祖先判定へ置換 |
| PR metadata（base SHA・trusted base SHA・base ref・head SHA）との結線を維持 | E1, E2 | 判断2 のとおり 1 つの検査へ集約 |
| 記録実行 worktree の default branch checkout を独立に確認 | E1, E3 | GitHub 応答の default branch 名と比較 |
| Issue worktree 実行の拒否・tracked clean 要求を維持 | E1, E3 | 既存検査を維持 |
| 経路集合と分類を HEAD 非依存の供給元から算出する | E5 | 供給元ツリー表のとおり |
| 拒否理由を原因ごとに区別し次の操作を示す | E6 | `update-branch` を促さない |
| 証跡スキーマ・記録値の意味を変更しない | E2, E7 | 単一 base 値のまま 1 フィールドへ記録 |
| 起動スクリプトの受理条件・実行内容を変更しない | E8 | 本 Issue では一切変更しない |
| `AC-1` | E1, E4 | HEAD が base SHA より前進していても投稿が成立する |
| `AC-2` | E5 | 経路集合・成果物・分類のすべてが HEAD 非依存の供給元から算出される |
| `AC-3` | E4, E6 | 未取得・履歴外のいずれも到達不能として拒否 |
| `AC-4` | E2, E6 | 3 構成すべてで PR metadata 不一致として拒否 |
| `AC-5` | E3, E6 | 別ブランチ・detached HEAD の 2 構成を拒否 |
| `AC-6` | E3, E6 | Issue worktree 実行・dirty を変更前挙動のまま拒否 |
| `AC-7` | E6 | 拒否理由表の 5 種が SPEC の 5 原因と 1 対 1 に対応する |
| `AC-8` | E7 | 記録値・スキーマ不変により既存証跡の再検証が成立 |
| `AC-9` | E8 | 起動側は変更しないため 3 構成とも変更前挙動 |

## 責務・境界

### コンポーネント構成

- `E1 受理判定列`: 証跡記録処理の投稿前段。E2〜E4 の検査を受理判定の順序表が定める固定順序で実行し、最初に失敗した検査の理由だけを提示して非0終了する。検査の追加・削除はこの列の外で行わない。
- `E2 PR metadata 照合`: 当該 PR の base ref が repository default branch であること、指定 base SHA と trusted base SHA の双方が当該 PR の `base.sha` と一致すること、当該 PR の head SHA が target SHA と一致すること。判断2 の 3 点連鎖のうち記録側を担う。
- `E3 実行場所検査`: 記録実行 worktree が main worktree であること、default branch を checkout していること（detached HEAD を含めて不一致は拒否）、tracked file が clean であること。
- `E4 ローカル到達可能性検査`: trusted base SHA が HEAD の祖先または同一であることの判定。Git object が無い場合も到達不能として扱う。
- `E5 供給元ツリー解決`: 判断3 の表に従い、経路集合・分類・成果物 digest・review policy・launcher digest を各コミットのツリーから読む。作業ツリーからの読み取り経路を残さない。
- `E6 拒否理由表`: 拒否原因と日本語メッセージ・推奨操作の対応。
- `E7 証跡組立`: 変更前と同一のスキーマ・フィールド意味で証跡を構成し投稿する。
- `E8 起動側`: 本 Issue では変更しない境界。起動側は隔離 clone を trusted base SHA で作成し実行コードを構築する既存責務のままとする。

E1 は判定順序だけを持ち、個別判定は E2〜E4 が持つ。判定に必要な GitHub 応答は E1 が 1 度だけ取得して各検査へ渡し、各検査は GitHub へ独自に問い合わせない。

### 依存関係

```text
E1 受理判定列 → E2 PR metadata照合 ／ E3 実行場所検査 ／ E4 ローカル到達可能性検査（実行順序は受理判定の順序表が定める）
E1 受理判定列 → E5 供給元ツリー解決 → E7 証跡組立 → GitHub PR Review API
E2 / E3 / E4 → E6 拒否理由表（失敗時のみ）
E1 受理判定列 → GitHub PR/repository metadata（取得は1回）
```

### 図示要否の判断

- 判断: `不要`
- 根拠: 依存関係は E1 を起点とする一方向であり、E2〜E4 は互いに依存せず順序だけを共有する。分岐は「失敗時に E6 を経て非0終了する」1 種のみで、状態は「受理して投稿」「拒否して非0終了」の 2 つに閉じる。責務境界は列挙したとおり記録処理の内部区分であって、独立コンポーネント 3 つ以上の相互作用ではない。テキスト矢印で依存の全体が表現できるため図を要しない。

### 受理判定の順序と拒否理由

順序は固定とし、複数の不備が同時に存在する場合も先に評価した理由だけを提示する。これにより同一構成に対する拒否理由が一意に定まる。表の 5 行は SPEC の 5 原因と 1 対 1 に対応する。

| # | 検査 | 拒否理由 | SPEC の 5 原因との対応 | 推奨操作 |
|---|---|---|---|---|
| 1 | Issue worktree からの実行でない | Issue worktree からの実行 | (d) | default branch worktree から実行する |
| 2 | PR metadata 照合（base ref・base SHA・trusted base SHA・head SHA） | PR metadata との不一致 | (b) | 対象 PR・target SHA・起動引数を確認する |
| 3 | default branch を checkout している | default branch worktree でない | (c) | default branch を checkout する |
| 4 | trusted base SHA が HEAD から到達可能 | 到達不能 | (a) | 記録実行 worktree で `git fetch` と早送りを行う（`update-branch` は促さない） |
| 5 | tracked file が clean | dirty | (e) | 作業ツリーの変更を退避する |

## 関連ADR

```yaml
related_adrs: []
```

本 Issue の決定（記録側の完全一致要求を default branch checkout 検査と到達可能性検査の連言へ置き換えること、未 push のローカルコミットに対する追加検証を行わないこと、差分基点と trusted base SHA を PR `base.sha` へ直接結線すること、記録処理の全入力の供給元をコミットのツリーへ固定すること）は `docs/adr/ADR-0074-recorder-base-reachability-and-published-head.md` として `proposed` で記録した。`accepted` の ADR のみ構造化リストへ載せる規約に従い、設計ゲート承認前の本時点では上記リストを空とする。

なお起動側の同種の緩和は先行して行われており（`gate-local-review.sh` の attestation を HEAD 完全一致から default branch 到達可能性判定へ緩めた決定）、本 Issue はその決定を変更せず、記録側にのみ残っていた完全一致要求を対象とする。当該決定は `proposed` のままであるため構造化リストへは載せない。

## 障害・ロールバック考慮

- 想定される失敗モード1: trusted base SHA のツリーに review policy が存在しない、または読み取れない。記録処理は投稿せず非0終了する（変更前と同じく登録済み review policy が無い場合の扱いに合流する）。影響は当該レビュー実行 1 回分で、成果物・PR の状態は変化しない。
- 想定される失敗モード2: 記録実行 worktree が default branch を checkout していない、または trusted base SHA を未取得の状態で運用され、拒否が続く。是正は当該 worktree の checkout と `git fetch`・早送りに限られ、open PR 側への操作（`update-branch`）は不要である。
- 想定される失敗モード3: 記録実行 worktree に未 push のローカルコミットがある状態で記録処理が成立する。記録処理が読む値はすべてコミットのツリー由来であるため、証跡の内容も判定結果も当該コミットの有無に依存しない。当該状態は不変条件 I4 に反するが、是正は default branch worktree 側の運用であり記録処理の出力を汚染しない。
- ロールバック手順: 変更は証跡記録処理の受理判定列・拒否メッセージ・入力の読み取り経路に閉じるため、当該コミットの revert のみで変更前挙動へ戻る。証跡スキーマ・記録値・起動スクリプト・レビュア側は変更しないため、revert 後も本変更適用中に投稿された証跡はそのまま検証できる。
- 影響を受ける既存機能: 証跡記録処理のみ。証跡検証、ゲート集約、起動スクリプト、ローカルモードの記録経路、レビュアのプロンプト生成は入力・出力とも変わらない。

## 対象外

- マージ要件としての最新化（`update-branch`）と、その後の CI 再実行待ち。
- 証跡スキーマの拡張（差分基点と trusted base を別フィールドとして記録すること）。
- 記録処理以外の経路（証跡検証・ゲート集約・レビュアプロンプト生成）が review policy・設定を作業ツリーから読む構造の見直し。本設計は記録処理の入力に限って供給元を固定する。
- 記録実行 worktree に未 push のローカルコミットがある状態そのものの検出と是正。
- `wip.limit` の既定値、ワーカー終了後の writer lease 残存、ローカルモードのゲート記録経路。

## 未決事項

なし。SPEC.md が設計セグメントへ委ねた未決事項（未 push のローカルコミットの扱い）は判断1 で確定した。
