# 自己拡張の運用原則

## 責務境界

進行役は GitHub Issue、worktree、writer lease、PR、merge の調整だけを行う。成果物の作成と変更は、対象 Issue の writer lease を持つ segment worker が専用 branch で行う。レビューアは read-only で conformance と falsification の両方を確認する。

## 耐久性と可読性

- セグメントの完了ごとに checkpoint を push し、作業状態を Git から復元可能にする。
- project policy は manifest に登録した最小限の文書で完結させる。参照先は AGENTS.md、`.agent-skill-chain/`、または外部の公式一次情報に限定する。
- 継続作業で必要な情報は commit 済み成果物と Issue/PR に記録する。会話履歴や ignored memo にしかない決定を作らない。

## 安全側の判断

既定の autonomy は gated である。risk が normal 以外、または autonomy が full のときは strict review を要求する。設定・環境変数・ブランチ保護を変更して検査を回避してはならない。
