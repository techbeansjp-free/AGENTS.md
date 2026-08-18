# PLAN: PRマージのたびに他のopen PRのゲートレビューがbase SHA不一致で停止する

- Issue: `ISSUE-703`
- 対応する DESIGN: `DESIGN.md`

## 実装順序・変更単位

| # | 変更単位 | 内容 | 対応 AC-ID | 依存する変更単位 |
|---|---|---|---|---|
| 1 | `受理判定列の再構成` | 証跡記録処理の投稿前検査を DESIGN の順序表どおりに並べ替える。HEAD と trusted base SHA の完全一致検査を削除し、default branch checkout 検査（GitHub 応答の default branch 名と `git symbolic-ref --quiet --short HEAD` の比較。detached HEAD は不一致）と、trusted base SHA の到達可能性検査（`git merge-base --is-ancestor <trusted base SHA> HEAD`。非0終了はすべて到達不能として扱う）を追加する。既存の Issue worktree 拒否・base SHA と trusted base SHA の同一性検査・PR metadata 照合・tracked clean 検査は位置と内容を維持する | `AC-1, AC-3, AC-4, AC-5, AC-6` | なし |
| 2 | `拒否理由の整備` | DESIGN の拒否理由表に従い、原因ごとに区別できる日本語メッセージと推奨操作を与える。到達不能のメッセージは記録実行 worktree の取得と早送りを促し、`update-branch` に言及しない | `AC-3, AC-4, AC-5, AC-7` | `#1` |
| 3 | `公開済み HEAD 検査` | GitHub の commit 比較エンドポイントを 1 回呼び、応答の関係が同一または「default branch が HEAD より進んでいる」場合のみ受理する。呼び出しは base 側に HEAD の SHA、head 側に GitHub 応答の default branch 名を置く。応答を得られない場合は受理せず、公開状態を確認できない旨の専用メッセージで非0終了する | `AC-1, AC-7` | `#1, #2` |
| 4 | `供給元ツリーの固定確認` | DESIGN の供給元ツリー表と実装の一致を確認する。経路集合・分類は差分基点と target SHA の三点差分、成果物の内容・digest は target SHA のツリー、launcher digest は trusted base SHA のツリーから読む。作業ツリーからの読み取りが review policy・設定・light review scaffold に限られることを確認し、逸脱があれば是正する | `AC-2` | `#1` |
| 5 | `テスト補助の拡張` | 統合テストの gh スタブが、記録処理の新しい比較呼び出しに対して構成ごとの応答（公開済み／未公開／問い合わせ失敗）を返せるようにする。既存呼び出し（マージ最新性判定）の既定応答と解決規則は変更しない。テスト用リポジトリを default branch checkout・別ブランチ・detached HEAD の 3 構成で用意できるようにする | 前提（#6 の実行に必要） | `#3` |
| 6 | `受理・拒否の自動テスト` | 記録処理の統合テストを追加・更新する。受理側は、HEAD が PR base SHA より後の default branch コミットである構成で証跡が投稿されること。拒否側は、到達不能・PR metadata 不一致 3 構成・別ブランチ・detached HEAD・Issue worktree・dirty・未公開ローカルコミット・問い合わせ失敗の各構成で、投稿されず非0終了し、原因ごとに異なるメッセージが出ること | `AC-1, AC-3, AC-4, AC-5, AC-6, AC-7` | `#1, #2, #3, #5` |
| 7 | `判定不変性と既存証跡の自動テスト` | HEAD が差分基点と一致する構成と前進した構成の 2 つで、経路集合とコアレビュー要否分類が一致することを表明する。変更適用前の形式で作成した証跡（`execution.trusted_base_sha` が当時の PR base SHA）が、変更後の実装でも有効な証跡として検証されることを表明する | `AC-2, AC-8` | `#4, #5` |
| 8 | `起動側の非変更確認` | 起動スクリプトと、その既存テスト（default branch 先端が指定 base SHA より前進している構成、記録実行 worktree が default branch でない構成、指定 base SHA が到達不能な構成）を変更せずに緑であることを確認する | `AC-9` | `#1, #3` |

## 実装時の注意

- 比較エンドポイントの引数順序を取り違えると検査の向きが反転し、未公開のローカルコミットを受理して公開済み HEAD を拒否する。base 側が記録実行 worktree の HEAD、head 側が default branch 名であることと、受理する関係が同一および「head 側が進んでいる」の 2 つであることを、実装とテストの双方で明示する。
- `git merge-base --is-ancestor` は「祖先でない」場合と「object が存在しない」場合で終了コードが異なる。SPEC はいずれも到達不能として同一の扱いを求めるため、成功以外をすべて到達不能へ寄せる。
- 検査の順序は拒否理由の一意性を決めるため、順序自体をテストで固定する（複数の不備が同時に存在する構成で、先に評価される理由が出ること）。
- SPEC.md は spec-gate 承認済みであり変更しない。ADR-0074 は `proposed` のまま実装セグメントへ持ち越し、設計ゲート承認時に `accepted` へ遷移させる。

## 実装順序の見直しについて

作業順序（上記の変更単位の並び）のみを見直す場合は本ファイルのみを更新する。設計要素・責務・境界そのもの（受理条件の集合、公開済み判定の根拠、供給元ツリーの割り当て）を変更する場合は DESIGN.md の更新と設計ゲートの再通過が必要になる。
