# Claude Code hook 実機 E2E 手順（保守者向け）

本書は、Claude Code の PreToolUse hook（`.agents/enforcement/claude/PreToolUse.sh`）が**実機の Claude Code 上で**期待どおり違反操作を block / 正当操作を allow することを確認する手順を示す。**保守者（自己拡張）向けの非配布ドキュメント**であり、CI・パッケージには含めない。

合成環境での自動検証は `test/e2e-claude-hook.sh`（settings.json 配線経由で hook プロセスへ stdin JSON を注入）で行う。本書はそれを**実機 Claude Code で追認する**ための手順を補う（合成は SC 対象、実機実行は SC 対象外）。

## 前提

- Node.js（`npx` 利用可能）と bash・sqlite3。
- 検証は**使い捨てのテスト用ディレクトリ**で行う（本番リポジトリを汚さない）。

## 手順

1. テスト用ディレクトリを作り、パッケージを配備する。

   ```bash
   mkdir -p /tmp/hook-e2e && cd /tmp/hook-e2e
   npx agent-skill-chain init
   ```

2. enforcement を opt-in で有効化する（`.claude/settings.json` に PreToolUse/PostToolUse を配線）。

   ```bash
   npx agent-skill-chain enforce on
   npx agent-skill-chain enforce status   # on（配線あり）・hook スクリプト実在を確認
   ```

3. Claude Code を当該ディレクトリで起動する（settings.json を読み込ませるため再起動が必要）。

4. 実機で次を確認する。

   - **orchestrator の直接 Write/Edit が block される**: メイン（orchestrator ロール）で `00_要求定義.md` 等の成果物を直接編集しようとすると、PreToolUse hook が exit 2 で停止する。
   - **正当な Read/Grep は通る**: ファイル参照・検索は allow される。
   - **scribe 以外の Bash は block される**: 書記以外のロールでの Bash 実行は停止する。
   - **配備先の write-workflow-log.sh 単独実行のみ allow**: 相対パス偽装・symlink 別実体・`bash -c` 経由は block される（C-4a パス正規化）。

5. AGENT_ROLE 偽装の確認（C-4b）。

   - シェルで手動 `export AGENT_ROLE=scribe` しても、env の実 nonce（`AGENTS_SCRIBE_NONCE`）が**ファイル出所の期待 nonce**（`${AGENTS_ROOT}/.scribe-nonce`・`0600`・`enforce on` が生成）と一致しない限り、PreToolUse は scribe として扱わず unknown へ降格し、`write-workflow-log.sh` 実行を block する。期待値はファイルから読むため、env だけを揃えても（実 nonce と env 期待 nonce を同値にしても）ファイルを書けない限り一致できない。
   - 正規の scribe 経路（ファイル出所の期待 nonce と一致する env 実 nonce）でのみ書記実行が allow される。
   - **限界（正直化）**: この出所制御は素朴な手動 export を遮断するに留まり、env 空間全体＋`0600` ファイル読取まで掌握できる相手への完全防御ではない。最終保証は CI audit ＋ 外部証跡が担う。

## 既知の限界（正直記述）

- **CI audit は AGENT_ROLE 偽装 INSERT を完全検知できない既知残存リスク**である。`workflow_log` には「誰が AGENT_ROLE を設定したか」の出所情報が無く、schema の `CHECK (actor_role='scribe')` / `CHECK (delegated_by_role='orchestrator')` により全行が必ず `scribe`/`orchestrator` で記録されるため、偽装 INSERT 行も audit の actor_role/delegated_by_role チェックを PASS してしまう。
- env 偽装の事後検知の主経路は、**runtime hook の env 出所制御（C-4b・主防御）**と、**`agents-md export` で NDJSON を外部（Git append-only・コミット署名）へ保全して突合する外部証跡補強**である。doctor の hash チェーン検証は逐次改ざん・行削除の痕跡を検出するが、DB 丸ごと差し替えには不完全であり、外部証跡で補う。

## 関連

- 合成 E2E: `test/e2e-claude-hook.sh`
- hook 単体テスト: `test/test-pretooluse-hook.sh`
- C-4 バイパス耐性: `test/test-c4-bypass-resistance.sh`
- enforcement 正本: `.agents/enforcement/README.md`、`.agents/enforcement/claude/PreToolUse.sh`
