# .agent-skill-chain/ci/fixtures/

`.agent-skill-chain/ci/verify-*.sh` は `agent-skill-chain verify <サブコマンド>`
（`src/agents-md.ts` のCLI実装）への薄いラッパーとして実装済みである。本ディレクトリは
その検査対象となるテスト用固定データ（fixture）を格納する場所であり、実体（`test/`
配下のテストスイート自体の再構築ステップ）はまだ追加されていない。

想定する内容（`test/` 再構築時に追加）:

- ブランチ名・worktree パスの適合例・違反例（`verify-branch-name.sh` / `verify-worktree-path.sh`）
- `.agent-skill-chain/templates/github/.github/` と `.github/` の同期例・差分例（`verify-template-sync.sh`）
- AC-ID と検証方法・証跡の対応例・孤児 AC/孤児テスト参照例
  （`verify-ac-coverage.sh`、`.agent-skill-chain/schemas/validation-report.schema.yaml` 準拠）
- `.agent-skill-chain/schemas/gate-report.schema.yaml` 準拠の gate-report サンプル（適合例・違反例）
  （`verify-gate-report.sh`）
- 各セグメントの成果物一式の存在例・欠落例（`verify-artifacts.sh`、`.agent-skill-chain/config/segments.yaml` 準拠）
- ADR のライフサイクル遵守例・不変項目違反例・stale `related_adrs` 参照例
  （`verify-adr.sh`、`.agent-skill-chain/templates/adr/ADR.md` 準拠）

fixture 自体がまだ用意されていないため、本ディレクトリは現時点では空である。
