# enforcement/claude — Claude Code 用フックの正本

**配置するもの**: PreToolUse / PostToolUse 等、Claude Code がツール実行前後に呼ぶフックの正本。

**展開先**: setup 実行後は .claude/hooks/ 等へコピーされる。

**責務**: フェーズゲート・command 実行前の読了確認、証跡（memo プレフィックス）未実行の検出など。矯正するものは enforcement/README.md に記載する。
