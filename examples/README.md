# examples - 導入レベル別の構成例（コピペ可能）

利用者は「説明より先に実物を見る」ため、導入レベル別の**コピペでそのまま実行できる手順**を置いています。

| ディレクトリ | レベル | 内容 | 目安 |
|--------------|--------|------|------|
| [minimal/](./minimal/) | Minimal | AGENTS.md + .agents（boot, platforms） | **3 分で試す**。AI が規約に従う最小構成。 |
| [standard/](./standard/) | Standard | minimal ＋ workers, .workflow/templates, skills | 通常の開発フロー。00〜04 とテンプレートで issue を進める。 |
| [advanced/](./advanced/) | Advanced | standard ＋ scribe, ledger, .review | ログ一元化（workflow.db）・監査・CI。 |

**使い方**: 各ディレクトリの README に **コピペで実行できるコマンド** を記載しています。AGENTS-spec を clone したリポジトリのルート（実行元）から、導入先プロジェクトのルート（実行先）へ `cp` を実行するだけで、そのレベルまで導入できます。実際のファイルは本リポジトリ（AGENTS-spec）のルートからコピーするため、examples 内に実ファイルの二重配置はありません。
