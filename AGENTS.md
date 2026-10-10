# agent-skill-chain 利用案内

このファイルは短い案内であり、規約を重複して定義しない。

**handoffを受け取った担当workerは、指定worktreeで`resume.command`のpreviewを一度実行してalternativesも含めHEAD・boundary・workUnitIdを照合し、`read.skill`へ直接進む。** 一致した場合、以下の初回案内や全Skill索引を読み直さず、root CLI help・directory一覧・journal全文から現在工程を再探索しない。必要な正式入力は`read.staging`と`resume`のpointerから読む。handoffはadvisoryであり、CLI gate・独立review・現在StepのSkill契約は省略しない。不一致・blockedなら再dispatchまたは原因解消を求める。`read.skill`がない旧handoffは[asc-step](.agent-skill-chain/skills/asc-step/SKILL.md)のfallbackに従う。

handoffのない初回開始時は、最初に[ディレクトリ利用案内のownerと編集](.agent-skill-chain/00_利用案内.md#ownerと編集)と[使い方](.agent-skill-chain/00_利用案内.md#使い方)だけでownerと入口を確認する。索引全文やdirectoryの再帰一覧を初期読込に含めず、導入保守・補助レビューなどの説明はその操作が必要なときに参照する。目的と成立条件、権限と所有権は[00_運用ポリシー.md](.agent-skill-chain/docs/00_運用ポリシー.md)、ステップ0〜11は[01_開発ワークフロー.md](.agent-skill-chain/docs/01_開発ワークフロー.md)（全文でなく、同文書の「読取と書込の量」節に従い節単位で読む）、開発・テスト・レビュー・安全ゲートは[02_品質基準.md](.agent-skill-chain/docs/02_品質基準.md)を読む。この3文書を規範的な正本とし、利用案内は正本を重複しない索引とする。

プロジェクト固有のポリシーとテストコマンドは利用側プロジェクトが所有する。現行の`.agents/skills/asc-step/SKILL.md`を除くアーカイブ済み`.agents`、旧`.workflow`のテンプレート以外の資産、ローカルの`memo/test/archive`を現在の実行規約として扱わない。
