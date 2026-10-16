# ASC v0.5 開発入口

[利用案内](.agent-skill-chain/00_利用案内.md)から、権限・実行・品質の契約を確認する。固定StepやStep専用Agentは使用しない。

製品実装は`src/`、CLIは`bin/`、テストは`test/`、利用者向け能力は`skills/`。実行方法は[v0.5手順](v05/USAGE.md)、移行と復旧は[移行手順](v05/MIGRATION_PLAN.md)を参照する。

専用worktreeで作業し、他Issue・worktreeの成果を変更しない。プロジェクト固有契約、独立レビュー、実検証、提出対象とEvidenceの一致を維持する。未許可のpush・merge・releaseは行わない。旧版資料や実験ログを現行の実行規約として扱わない。
