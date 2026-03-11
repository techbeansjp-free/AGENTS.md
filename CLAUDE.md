# CLAUDE.md — Claude Code 向け

- 本プロジェクトでは [AGENTS.md](AGENTS.md) および [.agents/](.agents/) に従うこと。**プロジェクト固有ルールは .agents-project/ が最優先**（.agents より優先。同名・同目的は .agents-project を採用）。
- **ユーザーの依頼が作業要求である場合、明示がなくても必ず本 agents に従い、進行役として phase 判定・command 選択・委譲を行うこと。** 正本は CORE §デフォルト起動 と LOAD_POLICY の「ユーザーから作業依頼を受けた」トリガー。
- 応答は日本語とする。
- 実行契約の正本は [.agents/boot/CORE.md](.agents/boot/CORE.md)。読込順は [.agents/boot/LOAD_POLICY.md](.agents/boot/LOAD_POLICY.md) に委譲。
- 作業は **command**（skill chain）で実行する。command 実行時は run_command と commands/{name}.md を読むこと。
- プロジェクト概要・詳細は .agents/README.md および boot / workflow / commands / skills を参照すること。
