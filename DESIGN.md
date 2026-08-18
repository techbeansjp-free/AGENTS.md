# DESIGN: PRマージのたびに他のopen PRのゲートレビューがbase SHA不一致で停止する

- Issue: `ISSUE-703`
- 対応する SPEC: `SPEC.md`

## 目的・対象範囲

本設計は、証跡記録処理（`agent-skill-chain gate submit-evidence`）が GitHub PR review へ証跡を投稿する前に行う受理判定の構造を定める。目的は、repository default branch が前進しただけで他の open PR の証跡投稿が停止する状態を解消し、同時に「記録処理が読む入力の由来を GitHub が attest したコミットへ固定する」という信頼境界（不変条件 I5 を機械的に支える機構）を弱めないことである。

対象は証跡記録処理の受理判定と拒否メッセージ、および記録処理が各入力をどのツリーから読むかの確定に限る。起動スクリプト（`.agent-skill-chain/scripts/gate-local-review.sh`）の受理条件・実行内容、証跡スキーマ、レビュアの判定内容、ローカルモードの記録経路は変更しない。

## 前提・用語

用語は SPEC.md の用語表（記録実行 worktree・trusted base SHA・PR base SHA・差分基点・到達可能・変更前挙動）に従う。本設計が追加で用いる語は次の 2 つに限る。

| 用語 | 本設計での意味 |
|---|---|
| 公開済み HEAD | 記録実行 worktree の HEAD コミットが、GitHub 上の repository default branch の履歴に含まれている状態。 |
| 公開状態問い合わせ | GitHub の commit 比較エンドポイント（`GET /repos/{owner}/{repo}/compare/<HEAD SHA>...<default branch 名>`）を 1 回呼び、応答の `status` を読む操作。`status` が `identical`（同一）または `ahead`（比較先である default branch が HEAD より進んでいる）であることが、公開済み HEAD であることを意味する。 |

記録処理は GitHub モードでのみ動作し、当該 PR の metadata と repository metadata を既に取得している。記録実行 worktree は進行役の default branch worktree であり、複数の Issue worktree と Git object store・ref store を共有する。

## 設計セグメントで確定させた判断

### 判断1: 未 push のローカルコミットを含む HEAD は受理しない。判定根拠は GitHub 側に置く

SPEC.md の未決事項は「記録実行 worktree の HEAD が、GitHub が返す default branch の現在の先端そのものから到達可能であることまで追加検証するか」を設計セグメントへ委ねている。**本設計は追加検証を行うことを確定する。** ただし判定は記録実行 worktree のローカル情報では行わず、公開状態問い合わせの結果だけを根拠とする。

追加検証が必要な理由は、記録処理の入力のうち review policy（`.agent-skill-chain/project/manifest.yaml`）・設定（`.agent-skill-chain/config/agent-skill-chain.yaml`）・light review scaffold の 3 つが、コミットではなく記録実行 worktree の作業ツリーから読まれるためである。変更前は「HEAD が PR base SHA と完全一致」かつ「tracked file が clean」であることにより、これらの内容が GitHub の attest したコミットのツリーへ transitively 固定されていた。完全一致を到達可能性へ緩めると、HEAD に任意の子孫コミットを置けるため、この固定が失われる。review policy はコアレビュー要否と要求 profile を決めるため、固定が失われるとレビューの厳格度を記録実行側から引き下げられる。

ローカル情報を根拠にしない理由は、記録実行 worktree が Issue worktree と ref store を共有することにある。ローカルのブランチ ref・remote-tracking ref（`refs/remotes/origin/<default branch>` 等）は、同じリポジトリで動作する任意のプロセスが更新できるため、「公開済みであること」の根拠にならない。GitHub 応答は審査対象ブランチが値を選べない情報源であり、PR base SHA を固定根拠とするのと同じ性質を持つ。

SPEC.md が懸念した「記録実行 worktree が当該先端を未取得の場合に新たな停止条件を作り得る」問題は、公開状態問い合わせが GitHub 側で関係を解決するため生じない。記録実行 worktree のローカル object store に default branch の現在の先端が存在する必要はなく、HEAD が先端より古い（`ahead`）状態はそのまま受理される。したがって、1 本マージして default branch が前進しても、他の open PR の証跡投稿は停止しない。

### 判断2: 差分基点と trusted base SHA は単一の値として扱う

SPEC.md の要件本文は trusted base SHA を PR base SHA に固定することを求め、AC-4(a) は指定 base SHA が PR base SHA と一致することを求める。**本設計は、差分基点と trusted base SHA が常に同一値であることを設計上の不変として明示する。** 実現は次の 3 点の連鎖による。

1. 起動スクリプトは受け取った 1 つの base SHA 引数を、差分基点・証跡 base SHA・trusted base SHA の 3 つの環境変数すべてへ同じ値として渡す（変更前挙動を維持する）。
2. 記録処理は受理判定の先頭で、引数の base SHA と trusted base SHA が同一であることを検査し、異なる場合は投稿せず非0終了する。この検査が両者を結線する唯一の点である。
3. 記録処理は以降、差分基点・PR metadata 照合・launcher digest 算出・証跡への `execution.trusted_base_sha` 記録のすべてに同一の値を用いる。証跡には両者を別フィールドとして持たせない。

この結線により、trusted base SHA を PR base SHA へ固定する要件と、指定 base SHA を PR base SHA へ固定する AC-4(a) は同一の条件になる。証跡検証側も同じ値を trusted base SHA の期待値として用いるため、記録と検証で基準が分岐しない。

### 判断3: 各入力の供給元ツリーを固定する

AC-2 が一致を要求する対象は経路集合とコアレビュー要否分類だが、各成果物の内容・digest をどのツリーから読むかは規定されていない。**本設計は次の表を確定する。記録実行 worktree の作業ツリーは、成果物の内容・digest・経路集合・分類のいずれの供給元にもならない。**

| 入力 | 供給元ツリー | 読み取り手段 |
|---|---|---|
| 承認対象成果物の経路集合 | 差分基点コミットと target SHA の三点差分（コミット同士） | `git diff --name-only <差分基点>...<target SHA>` |
| コアレビュー要否分類の対象経路 | 同上 | 同上 |
| 各成果物の内容・digest | **target SHA のツリー** | `git show <target SHA>:<path>` |
| launcher 構成の digest | trusted base SHA のツリー | `git show <trusted base SHA>:<path>` |
| review policy・設定・light review scaffold | 記録実行 worktree の作業ツリー | ファイル読み取り（判断1 の公開済み HEAD 検査で由来を固定する） |

三点差分は merge-base を基点とするため、記録実行 worktree の HEAD が差分基点より前進していても、差分基点より後の default branch コミットが変更した経路は結果へ入らない。成果物の内容も target SHA のツリーから読むため、HEAD の位置に依存しない。

## 要件 → 設計要素の対応表

| 要件 / AC-ID | 対応する設計要素 | 備考 |
|---|---|---|
| 完全一致を要求せず到達可能性を受理条件とする | E1, E4 | 完全一致検査を削除し祖先判定へ置換 |
| PR metadata（base SHA・base ref・head SHA）との結線を維持 | E1, E2 | 既存検査を位置・内容とも維持 |
| 記録実行 worktree の default branch checkout を独立に確認 | E1, E3 | GitHub 応答の default branch 名と比較 |
| Issue worktree 実行の拒否・tracked clean 要求を維持 | E1, E3 | 既存検査を維持 |
| 経路集合と分類を三点差分で算出し HEAD 前進に不変 | E5 | 供給元ツリー表のとおり |
| 拒否理由を原因ごとに区別し次の操作を示す | E6 | `update-branch` を促さない |
| 証跡スキーマ・記録値の意味を変更しない | E2, E7 | 単一 base 値のまま 1 フィールドへ記録 |
| 起動スクリプトの受理条件・実行内容を変更しない | E8 | 本 Issue では一切変更しない |
| `AC-1` | E1, E4, E9 | HEAD が base SHA より前進していても投稿が成立する |
| `AC-2` | E5 | 2 構成で経路集合・分類が一致する |
| `AC-3` | E4, E6 | 未取得・履歴外のいずれも到達不能として拒否 |
| `AC-4` | E2, E6 | 3 構成すべてで PR metadata 不一致として拒否 |
| `AC-5` | E3, E6 | 別ブランチ・detached HEAD の 2 構成を拒否 |
| `AC-6` | E3, E6 | Issue worktree 実行・dirty を変更前挙動のまま拒否 |
| `AC-7` | E6 | 拒否理由表の 7 種が相互に区別できる |
| `AC-8` | E7 | 記録値・スキーマ不変により既存証跡の再検証が成立 |
| `AC-9` | E8 | 起動側は変更しないため 3 構成とも変更前挙動 |

## 責務・境界

### コンポーネント構成

- `E1 受理判定列`: 証跡記録処理の投稿前段。E2〜E4・E9 の検査を固定順序で実行し、最初に失敗した検査の理由だけを提示して非0終了する。検査の追加・削除はこの列の外で行わない。
- `E2 base 値結線`: 引数の base SHA と trusted base SHA の同一性検査と、PR metadata（base ref・base SHA・head SHA）照合。判断2 の 3 点連鎖のうち記録側 2 点を担う。
- `E3 実行場所検査`: 記録実行 worktree が main worktree であること、default branch を checkout していること（detached HEAD を含めて不一致は拒否）、tracked file が clean であること。
- `E4 ローカル到達可能性検査`: trusted base SHA が HEAD の祖先または同一であることの判定。Git object が無い場合も到達不能として扱う。
- `E9 公開済み HEAD 検査`: 公開状態問い合わせによる判定。応答が得られない場合は fail-closed で拒否する。
- `E5 供給元ツリー解決`: 判断3 の表に従い、経路集合・分類・成果物 digest・launcher digest を各コミットのツリーから読む。
- `E6 拒否理由表`: 拒否原因と日本語メッセージ・推奨操作の対応。
- `E7 証跡組立`: 変更前と同一のスキーマ・フィールド意味で証跡を構成し投稿する。
- `E8 起動側`: 本 Issue では変更しない境界。起動側は隔離 clone を trusted base SHA で作成し実行コードを構築する既存責務のままとする。

E1 は判定順序だけを持ち、個別判定は E2〜E4・E9 が持つ。判定に必要な GitHub 応答は E1 が 1 度だけ取得して各検査へ渡し、各検査は GitHub へ独自に問い合わせない（例外は E9 の公開状態問い合わせ 1 回）。

### 依存関係

```text
E1 受理判定列 → E2 base値結線 → E3 実行場所検査 → E4 ローカル到達可能性 → E9 公開済みHEAD検査 → E5 供給元ツリー解決 → E7 証跡組立 → GitHub PR Review API
E2/E3/E4/E9 → E6 拒否理由表（失敗時のみ）
E1 → GitHub PR/repository metadata（取得は1回）
```

### 図示要否の判断

- 判断: `不要`
- 根拠: 依存関係は上記の一方向の直列 1 本であり、分岐は「失敗時に E6 を経て非0終了する」1 種のみである。状態遷移は「受理して投稿」「拒否して非0終了」の 2 状態だが遷移は直列判定の終端に閉じており、責務境界は列挙したとおり記録処理の内部区分であって独立コンポーネント 3 つ以上の相互作用ではない。テキスト矢印で依存の全体が表現できるため図を要しない。

### 受理判定の順序と拒否理由

順序は固定とし、複数の不備が同時に存在する場合も先に評価した理由だけを提示する。これにより同一構成に対する拒否理由が一意に定まる。

| # | 検査 | 拒否理由 | SPEC の 5 原因との対応 | 推奨操作 |
|---|---|---|---|---|
| 1 | Issue worktree からの実行でない | Issue worktree からの実行 | (d) | default branch worktree から実行する |
| 2 | base SHA ＝ trusted base SHA | 指定値の不整合 | (b) | 起動スクリプト経由で実行する |
| 3 | PR metadata 照合 | PR metadata との不一致 | (b) | 対象 PR・target SHA を確認する |
| 4 | default branch を checkout している | default branch worktree でない | (c) | default branch を checkout する |
| 5 | trusted base SHA が HEAD から到達可能 | 到達不能 | (a) | 記録実行 worktree で `git fetch` と早送りを行う（`update-branch` は促さない） |
| 6 | 公開済み HEAD である | 未公開のローカルコミットを含む | 追加（判断1） | ローカルコミットを default branch worktree から取り除く |
| 7 | 公開状態問い合わせが成立した | 公開状態を確認できない | 追加（判断1） | GitHub への到達性・認証を確認して再実行する |
| 8 | tracked file が clean | dirty | (e) | 作業ツリーの変更を退避する |

## 関連ADR

```yaml
related_adrs: []
```

本 Issue の決定（記録側の受理条件を 3 条件の連言へ置き換えること、公開済み判定の根拠をローカル ref ではなく GitHub 応答に置くこと、差分基点と trusted base SHA を単一値として扱うこと、各入力の供給元ツリーを固定すること）は `docs/adr/ADR-0074-recorder-base-reachability-and-published-head.md` として `proposed` で記録した。`accepted` の ADR のみ構造化リストへ載せる規約に従い、設計ゲート承認前の本時点では上記リストを空とする。

なお起動側の同種の緩和は先行して行われており（`gate-local-review.sh` の attestation を HEAD 完全一致から default branch 到達可能性判定へ緩めた決定）、本 Issue はその決定を変更せず、記録側にのみ残っていた完全一致要求を対象とする。当該決定は `proposed` のままであるため構造化リストへは載せない。

## 障害・ロールバック考慮

- 想定される失敗モード1: 公開状態問い合わせが GitHub 側の障害・レート制限・認証切れで失敗し、証跡投稿が止まる。影響は当該レビュー実行 1 回分（判定は隔離 clone 内で完了済みだが投稿されない）。是正は再実行であり、成果物・PR の状態は変化しない。安全側の選択として、応答不明を受理へ倒さない。
- 想定される失敗モード2: 記録実行 worktree が default branch を checkout していない・古すぎる状態で運用され、拒否が続く。是正は当該 worktree の checkout と `git fetch`・早送りに限られ、open PR 側への操作（`update-branch`）は不要である。
- 想定される失敗モード3: 公開済み HEAD 検査が過剰に厳格で、正当な運用を止める。該当するのは記録実行 worktree に未 push のコミットがある場合のみであり、これは default branch への変更を PR 経由に限る不変条件 I4 に反する状態である。
- ロールバック手順: 変更は証跡記録処理の受理判定列と拒否メッセージに閉じるため、当該コミットの revert のみで変更前挙動へ戻る。証跡スキーマ・記録値・起動スクリプト・レビュア側は変更しないため、revert 後も本変更適用中に投稿された証跡はそのまま検証できる。
- 影響を受ける既存機能: 証跡記録処理のみ。証跡検証、ゲート集約、起動スクリプト、ローカルモードの記録経路、レビュアのプロンプト生成は入力・出力とも変わらない。

## 対象外

- マージ要件としての最新化（`update-branch`）と、その後の CI 再実行待ち。
- 証跡スキーマの拡張（差分基点と trusted base を別フィールドとして記録すること）。
- review policy・設定の供給元を作業ツリーから GitHub 応答へ移すこと。本設計は公開済み HEAD 検査により由来を固定するに留める。
- `wip.limit` の既定値、ワーカー終了後の writer lease 残存、ローカルモードのゲート記録経路。

## 未決事項

なし。SPEC.md が設計セグメントへ委ねた未決事項（未 push のローカルコミットの扱い）は判断1 で確定した。
