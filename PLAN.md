<!--
正本: AGENTS.md 4セグメント・4ゲート
このファイルは Issue 毎に複製して使う雛形である（セグメント: design、成果物: PLAN.md。DESIGN.md とは別ファイル）。
-->

# PLAN: setupバックエンド分岐是正・doctor網羅性拡張・PRテンプレート実運用徹底・ADR手順逸脱ガード

- Issue: `ISSUE-188`
- 対応する DESIGN: `DESIGN.md`

## 実装順序・変更単位

4件の是正は相互に独立しており、変更単位1〜4はどの順序でも実装できる。単位5（doctor 対象外理由の記録）は doctor 実装の確定後に、単位6（回帰確認）は全実装の後に行う。各実装単位は自身の AC を実測で満たすテストを同時に追加する。

| # | 変更単位 | 内容 | 対応 AC-ID | 依存する変更単位 |
|---|---|---|---|---|
| 1 | `setup()` の coordination backend 分岐 | 資産コピー後にコピー済み config の `coordination.backend` を読む純関数を追加し、local または config 不読時は `githubBundle()` をスキップして情報行を出力、github 時は現行どおり実行する。判定関数と副作用実行を分離。分岐前後の挙動差をテストで実測 | `AC-1`, `AC-2` | なし |
| 2 | `doctor` 追加検査 D1〜D5 | D1=各 Issue worktree の checkout ブランチが branch.pattern に適合／D2=durability.backend=remote は `git ls-remote` 到達性・local_mirror はミラー先存在／D3=local backend の lease 状態ファイル失効検知／D4=各 worktree の SPEC.md 内 AC-ID 重複検知／D5=ADR の supersedes⇔superseded-by 対称性・status enum 妥当性を surface。各検査を独立 try/catch で追加。各観点につき不整合を再現したフィクスチャで NG 検知・正常時沈黙を実測 | `AC-3` | なし |
| 3 | `claude.sh` allowlist から `gh pr create` 除去 | `WORKER_ALLOWED_TOOLS_DEFAULT` から `Bash(gh pr create:*)` を除去し、除去理由と正規経路（`pr create` ラッパー）をアダプタ内コメントへ自己完結記載。`gh pr view/edit/comment` は残す。既定値に生 `gh pr create` が無いことをテストで実測 | `AC-5` | なし |
| 4 | `verify adr` finalize 経路ガード | git 履歴走査の補助関数を追加し、status=accepted の ADR について accepted 化 commit を特定、(1)固定メッセージ一致・(2)単一 ADR ファイルのみ変更・(3)status 行のみの差分、の3条件論理積を満たさなければ手順逸脱として非ゼロ終了。正規 finalize 由来 commit を誤検知しないことも実測 | `AC-7`, `AC-8` | なし |
| 5 | doctor 対象外観点の理由記録 | 実装しなかった観点（Check Run 状態・label projection・system-spec manifest 整合性）と部分除外（D3 の github lease・D4 の system-spec 安定 ID）の対象外理由を `VALIDATION.md` へ記録 | `AC-4` | `#2` |
| 6 | PR テンプレート本文の実測・全体回帰 | 徹底策適用後、使い捨て PR を規定手順（`pr create` ラッパー）で作成しテンプレート各節を含む本文が生成されることを実測（`AC-6`）。`npm run build && npm test` を全件実行し全通過を確認（`AC-9`） | `AC-6`, `AC-9` | `#1`〜`#5` |

## 実装順序の見直しについて

作業順序（上記の並び）のみを見直す場合は本ファイルのみを更新すればよい。設計要素・責務・境界そのもの（例: doctor 検査の実装/対象外の判別、finalize ガードの検出方式、allowlist 徹底の手段）を変更する場合は、DESIGN.md の更新および設計ゲートの再通過が必要になる。
