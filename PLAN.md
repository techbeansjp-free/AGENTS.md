# PLAN: PRマージのたびに他のopen PRのゲートレビューがbase SHA不一致で停止する

- Issue: `ISSUE-703`
- 対応する DESIGN: `DESIGN.md`

## 実装順序・変更単位

| # | 変更単位 | 内容 | 対応 AC-ID | 依存する変更単位 |
|---|---|---|---|---|
| 1 | `受理判定列の再構成` | 証跡記録処理の投稿前検査を DESIGN の順序表どおりに並べ替える。HEAD と trusted base SHA の完全一致検査を削除し、default branch checkout 検査（GitHub 応答の default branch 名と `git symbolic-ref --quiet --short HEAD` の比較。detached HEAD は不一致）と、trusted base SHA の到達可能性検査（`git merge-base --is-ancestor <trusted base SHA> HEAD`。非0終了はすべて到達不能として扱う）を追加する。base SHA と trusted base SHA の同一性を単独で検査していた箇所を削除し、PR metadata 照合で両者を当該 PR の `base.sha` と照合する 1 つの検査へ統合する。既存の Issue worktree 拒否・tracked clean 検査は位置と内容を維持する | `AC-1, AC-3, AC-4, AC-5, AC-6` | なし |
| 2 | `拒否理由の整備` | DESIGN の拒否理由表に従い、5 原因それぞれに区別できる日本語メッセージと推奨操作を与える。到達不能のメッセージは記録実行 worktree の取得と早送りを促し、`update-branch` に言及しない。base SHA・trusted base SHA の食い違いは PR metadata との不一致として提示する | `AC-3, AC-4, AC-5, AC-7` | `#1` |
| 3 | `入力の供給元をコミットのツリーへ固定` | 記録処理が review policy（project policy manifest）とその検証スキーマを作業ツリーから読む経路を、`git show <trusted base SHA>:<path>` による読み取りへ置き換える。作業ツリーへ戻る fallback を残さない。設定ファイルの読み取りを廃し、Coordination Backend を GitHub 固定として扱う。あわせて、経路集合と分類が差分基点と target SHA の三点差分から、成果物の内容・digest が target SHA のツリーから、launcher digest が trusted base SHA のツリーから読まれていることを確認し、逸脱があれば是正する | `AC-2` | `#1` |
| 4 | `テスト補助の拡張` | 統合テストで、記録実行 worktree を default branch checkout・別ブランチ・detached HEAD の 3 構成で用意できるようにする。差分基点より後の default branch コミットが review policy を変更した構成を作れるようにする。既存の gh スタブの応答と解決規則は変更しない | 前提（#5・#6 の実行に必要） | `#1` |
| 5 | `受理・拒否の自動テスト` | 記録処理の統合テストを追加・更新する。受理側は、HEAD が PR base SHA より後の default branch コミットである構成で証跡が投稿されること。拒否側は、到達不能・PR metadata 不一致 3 構成・別ブランチ・detached HEAD・Issue worktree・dirty の各構成で、投稿されず非0終了し、原因ごとに異なるメッセージが出ること。とくに base SHA だけを PR の `base.sha` と食い違わせた構成で、PR metadata との不一致を示すメッセージが出ること | `AC-1, AC-3, AC-4, AC-5, AC-6, AC-7` | `#1, #2, #4` |
| 6 | `判定不変性と既存証跡の自動テスト` | HEAD が差分基点と一致する構成と前進した構成の 2 つで、経路集合とコアレビュー要否分類が一致することを表明する。前進側では、差分基点より後の default branch コミットが review policy を変更している構成を用いる。変更適用前の形式で作成した証跡（`execution.trusted_base_sha` が当時の PR base SHA）が、変更後の実装でも有効な証跡として検証されることを表明する | `AC-2, AC-8` | `#3, #4` |
| 7 | `起動側の非変更確認` | 起動スクリプトと、その既存テスト（default branch 先端が指定 base SHA より前進している構成、記録実行 worktree が default branch でない構成、指定 base SHA が到達不能な構成）を変更せずに緑であることを確認する | `AC-9` | `#1, #3` |

## 実装時の注意

- review policy を作業ツリーから読む経路が 1 つでも残ると AC-2 が成立しない。記録処理からの読み取り経路を 1 か所へ集約し、ファイルが見つからないときに作業ツリーを探す fallback を持たせない。記録処理以外の呼び出し元の挙動は変更しない。
- `git merge-base --is-ancestor` は「祖先でない」場合と「object が存在しない」場合で終了コードが異なる。SPEC はいずれも到達不能として同一の扱いを求めるため、成功以外をすべて到達不能へ寄せる。
- 検査の順序は拒否理由の一意性を決めるため、順序自体をテストで固定する（複数の不備が同時に存在する構成で、先に評価される理由が出ること）。
- SPEC.md は spec-gate 承認済みであり変更しない。ADR-0074 は `proposed` のまま実装セグメントへ持ち越し、設計ゲート承認時に `accepted` へ遷移させる。

## 実装順序の見直しについて

作業順序（上記の変更単位の並び）のみを見直す場合は本ファイルのみを更新する。設計要素・責務・境界そのもの（受理条件の集合、入力の供給元ツリーの割り当て）を変更する場合は DESIGN.md の更新と設計ゲートの再通過が必要になる。
