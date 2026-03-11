# enforcement/ci — CI 用監査の正本

**配置するもの**: 証跡・CONTRACT 違反を検出するスクリプト（例: audit.sh）。workflow.db 以外へのログ記録検出など。

**展開先**: CI ワークフローから参照するパスに配置するか、setup で CI 設定を生成する。

**責務**: 監査観点（PHASES）に沿った検出。失敗条件・差し戻し先は親 [enforcement/README.md](../README.md) の「失敗条件と差し戻し」に従う。
