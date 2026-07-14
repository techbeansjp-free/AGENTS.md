# CLAUDE.md — Claude Code 向け

- 本プロジェクトでは [AGENTS.md](AGENTS.md) および [.agent-skill-chain/source/](.agent-skill-chain/source/) に従うこと。**プロジェクト固有ルールは .agent-skill-chain/project/ が最優先**（.agents より優先。同名・同目的は .agent-skill-chain/project を採用）。
- **ユーザーの依頼が作業要求である場合、明示がなくても必ず本 agents に従い、進行役として phase 判定・command 選択・委譲を行うこと。** 正本は CORE §デフォルト起動 と LOAD_POLICY の「ユーザーから作業依頼を受けた」トリガー。
- 応答は日本語とする。
- 実行契約の正本は [.agent-skill-chain/source/boot/CORE.md](.agent-skill-chain/source/boot/CORE.md)。読込順は [.agent-skill-chain/source/boot/LOAD_POLICY.md](.agent-skill-chain/source/boot/LOAD_POLICY.md) に委譲。
- 作業は **command**（skill chain）で実行する。command 実行時は run_command と commands/{name}.md を読むこと。
- プロジェクト概要・詳細は .agent-skill-chain/source/README.md および boot / workflow / commands / skills を参照すること。
- セットアップ・アップデート（`init`/`upgrade`/`enforce`/`uninstall` の実行コマンド自体）は [.agent-skill-chain/source/SETUP.md](.agent-skill-chain/source/SETUP.md) を参照すること。
- **実装・編集を伴う作業は、常に `git worktree` で `main` から新規ブランチを切って行うこと（メインの作業ツリーを直接変更してはならない）。** 詳細・例外は [.agent-skill-chain/project/自己拡張ワークフロー.md](.agent-skill-chain/project/自己拡張ワークフロー.md) §作業ツリーの worktree 必須化 を参照。

---

## issue 作成タスク受領時の標準フロー

サブエージェントが issue 作成タスク（例: issue_create 相当）を受領した場合の標準挙動。

> **コンテキスト効率**: 大規模一括起票時のコンテキスト肥大防止の汎用原理は [.agent-skill-chain/source/CONTEXT_EFFICIENCY.md](.agent-skill-chain/source/CONTEXT_EFFICIENCY.md) を参照（本ファイルには再記述しない）。

- **作成場所の上書き最優先**: `.agent-skill-chain/project/` に issue 作成場所の上書き定義がある場合は、下記の汎用標準より**それを最優先で参照**する（上書き定義の有無・具体的な内容はプロジェクトごとに異なるため、本ファイルには具体パスを記載しない）。
- **作成先（汎用標準・消費者ランタイムの既定）**: `.agent-skill-chain/project/` に上書き定義が無い場合、**単一 issue** は `.agent-skill-chain/runtime/<timestamp>_<title>/`、**サブ issue**（PR 指摘対応等）は `.agent-skill-chain/runtime/{parent}/90_issues/{ディレクトリ名}/` に作成する（例: `{parent}` = `20260314_064719_PR4指摘対応`、`{ディレクトリ名}` = `20260314_PR4_PR指摘対応`）。`<timestamp>` は実行環境の現在時刻（JST）を取得して付与（例: `TZ=Asia/Tokyo date +%Y%m%d_%H%M%S`）。`<title>` は issue 名に相当する短い識別子。
- **作成・更新するファイル**: 単一 issue は `00_要求定義.md`（必須）、`01_要件定義.md`（必要に応じて）、`02_設計.md`、`03_実装計画.md`。サブ issue は同様のファイルセットを当該 90_issues 配下に。`90_issues.md` は複数サブ issue を束ねる親ワークフローにのみ使用。
- **Orchestrator への返却フォーマット**: 作成完了後、**タイトル**・**概要**（1〜2 文）・**保存場所**を返す。詳細は本ファイルの §issue 作成タスク受領時の標準フロー を参照。
