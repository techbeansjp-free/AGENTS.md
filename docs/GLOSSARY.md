# 用語集

> 正本: `AGENTS.md` §用語。3列（用語・定義・禁止同義語）、20行以内。禁止語混入は `.agent-skill-chain/scripts/lint-vocab.sh` が検査する。

| 用語 | 定義 | 禁止同義語 |
|---|---|---|
| Issue | GitHub Issue（またはローカルモードの Issue 状態ファイル） | チケット、永続化された Task |
| 成果物 | Issue に紐づく SPEC/DESIGN/PLAN/VALIDATION/ADR 等 | issue（小文字）、ドキュメント |
| worktree | 1 Issue = 1 worktree の git worktree | 作業ディレクトリ、ブランチディレクトリ |
| writer lease | 1 Issue に同時1つのみ許可される書込み権 | ロック、排他制御 |
| セグメント | 要求要件・設計実装計画・実装・独立検証の4区分 | フェーズ、ステージ |
| ゲート | 各セグメント完了時の conformance+falsification 判定 | チェックポイント、単独の「レビュー」 |
| Coordination Backend | 調整状態の唯一の正本（GitHub またはローカル） | バックエンド（汎用語としての使用） |
| 進行役 | Issue作成・状態遷移・worktree管理・マージのみを行う役 | orchestrator（英語表記のみでの言い換え）、オーケストレーター |
| Task | セッション内の揮発的作業単位（永続化禁止） | Issue、タスク管理（永続化含意） |
| agent-skill-chain | 本 npm パッケージ・CLI（`AGENTS.md` が正本） | Fable システム、skill chain、command chain、`.agent-skill-chain/source` |
| 軽量プロファイル | `init` 実行時に選択できる導入形態。`profile: lightweight`。`CLAUDE.md`常時import・強制層（`setup github`・`enforce on`）・セグメントゲート機械的検査機構を導入しない | ライトプロファイル、lightweightモード（英語表記のみでの言い換え） |
| 既定プロファイル | `init` 未指定時の既定導入形態。`profile: standard`。`CLAUDE.md` が `@AGENTS.md` を常時importする常時規律モデル | 標準モード、standardプロファイル（英語表記のみでの言い換え） |
