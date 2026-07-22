<!--
正本: AGENTS.md 4セグメント・4ゲート
このファイルは Issue 毎に複製して使う雛形である（セグメント: design、成果物: DESIGN.md（PLAN.md は別ファイル）、ゲート: design-gate）。
-->

# DESIGN: setupバックエンド分岐是正・doctor網羅性拡張・PRテンプレート実運用徹底・ADR手順逸脱ガード

- Issue: `ISSUE-188`
- 対応する SPEC: `SPEC.md`

本 Issue は相互に独立した4件の運用品質ギャップを解消する。各設計要素は他の3件と結合を持たず、単独で実装・レビュー・切り戻しが可能である。

## 要件 → 設計要素の対応表

| 要件 / AC-ID | 対応する設計要素 | 備考 |
|---|---|---|
| AC-1 | `setup()` の coordination backend 分岐 | local 時は github 副作用群をスキップし情報行を出力 |
| AC-2 | 同上（github 時は現行 `githubBundle()` を無変更で維持） | 分岐追加のみで既存経路を通す |
| AC-3 | `doctor` 追加検査 D1〜D5 | 各検査が不整合を検知し正常時は沈黙 |
| AC-4 | `VALIDATION.md` の対象外観点・理由節 | 未実装と判断した3観点＋2観点の部分除外を記録 |
| AC-5 | `claude.sh` の worker allowlist 既定値から `gh pr create` を除去 | 生成経路を `pr create` ラッパーへ一本化 |
| AC-6 | 既存 `pr create` ラッパー（`buildIssueBody`）を正規経路化 | ラッパー実装は無変更。徹底策で経路を強制 |
| AC-7 | `verify adr` への finalize 経路ガード（git 履歴署名照合） | 逸脱 commit を検知 |
| AC-8 | 同ガードの署名条件（3条件の論理積） | 正規 finalize を誤検知しない |
| AC-9 | 全変更反映後のテストスイート実行 | 回帰なしを実測 |

## 責務・境界

### コンポーネント構成

- `setup()`（`src/commands/setup.ts`）: 資産コピー後、コピー済み config の `coordination.backend` を読み、github 副作用群（テンプレート同期・label 作成・ruleset 適用）を実行するか判断する。判断ロジックは純関数として切り出し、副作用の実行と分離する。
- `doctor`（`src/commands/doctor.ts`）: 既存9カテゴリの検査配列へ追加検査 D1〜D5 を append する。各検査は独立した try/catch で囲み、1検査の失敗が他検査の実行を妨げない現行方針を踏襲する。
- `claude.sh` worker allowlist（`.agent-skill-chain/adapters/claude.sh`）: `WORKER_ALLOWED_TOOLS_DEFAULT` から `Bash(gh pr create:*)` を除去する。除去理由と正規経路（`pr create` ラッパー）をアダプタ内コメントへ自己完結して明記する。
- ADR finalize ガード（`src/commands/verify.ts` の `verify adr`＋補助ロジック）: 対象 ADR が accepted の場合のみ、status を accepted へ遷移させた commit を git 履歴から特定し、finalize 経路の署名を満たすか判定する。git 履歴走査ロジックは検査対象ディレクトリを基点とする補助関数へ切り出す。

### 依存関係

```text
setup()          → config loader → コピー済み config（coordination.backend）
doctor 追加検査   → config loader / worktree 列挙 / git / lint adr 相当ロジック / lease 状態ファイル
claude.sh        → （変更は定数1行の除去とコメントのみ。実行時依存の追加なし）
verify adr ガード → git log 走査 → commit メッセージ・変更ファイル集合・status 行差分
```

`pr create` ラッパーは内部で `gh` を Node 子プロセスとして直接起動するため、worker allowlist（Bash ツールの自動承認範囲）から `gh pr create` を除いてもラッパー自身の PR 作成は影響を受けない。循環依存は無い。

## 4論点の設計判断

**論点1（setup 分岐）**: local backend 時は github 副作用群を「スキップし情報行を出力」する（確認プロンプトは出さない）。理由は、`setup`（引数無し）は既に非推奨であること、CLI は非対話ヘッドレスで駆動されプロンプトは CI をハングさせること、安全側既定は「不要な外部副作用を起こさない＝スキップ」であること。config が読めない場合も安全側でスキップし、github 副作用が必要なら `setup github` を明示実行するよう促す。github が明示設定された場合のみ現行 `githubBundle()` を通し、AC-2 の後退なしを担保する。

**論点2（doctor 網羅性）**: 8観点を「実装」「部分実装」「対象外」に判別する。技術的に実装可能で backend 非依存またはローカル完結し、かつ不整合をオフライン再現できる観点のみ実装する。

- 実装（D1〜D5）: D1=branch 名規約（各 Issue worktree の checkout ブランチが branch.pattern に適合）／D2=Durability Backend 疎通（durability.backend=remote は `git ls-remote` 到達性、local_mirror はミラー先の存在）／D3=writer lease 状態（local backend で lease 状態ファイルの expires_at 失効検知）／D4=requirement ID 採番一貫性の軽量版（各 Issue worktree の SPEC.md 内 AC-ID の重複検知）／D5=ADR 整合性（supersedes と superseded-by の対称性・status enum 妥当性を doctor へ surface）。
- 対象外（理由は VALIDATION.md へ記録、AC-4）: Check Run 状態（github backend 固有・要ネットワーク・要 PR/SHA 解決。ゲートの正本が Check Run そのものであり doctor による再導出は重複）／label projection（github backend 固有・要ネットワーク。label 適用はべき等な setup-labels が正本で常時再適用可能）／system-spec manifest 整合性（system-spec の実体が未構築のため検査対象が存在しない）。
- 部分除外: D3 は github backend の git-ref lease を対象外（要ネットワーク、ローカル状態ファイルのみ検査）。D4 は system-spec 安定 ID の一貫性を対象外（未構築のため）とし SPEC 内 AC-ID 重複のみを見る。

**論点3（PR テンプレート徹底）**: worker allowlist 既定値から `Bash(gh pr create:*)` を除去する方式を採る。lint 検査方式との比較では、lint は PR 作成後の事後検知に留まり作成方法自体を観測しづらいのに対し、allowlist からの除去は生 `gh pr create` の自動承認を事前に断ち、正規経路（`pr create` ラッパー）以外を非対話で実行不能にする。ワーカーが生 `gh pr create` を正当に要する経路は存在しない（Draft PR 作成は SPEC ワーカーがラッパー経由で行い、ラッパーは allowlist の管理外である Node 子プロセスとして `gh` を起動する）。allowlist は責務スコープ allowlist 既定という確立方針の一項目であり、その方針自体は維持する（1項目の除去は方針の強化であって変更ではない）。`gh pr view/edit/comment` は PR 作成ではなく更新・参照用途のため残す。env による allowlist 完全上書き余地も従来どおり残す。

**論点4（ADR 逸脱ガード）**: finalize 経路か否かを git 履歴の commit 署名で機械検出する。対象 ADR が accepted の場合のみ、status 行を proposed から accepted へ変えた commit を `git log` で特定し、次の3条件の論理積を満たすときのみ正規 finalize と判定する。(1) commit メッセージが finalize が発行する固定形式（`chore(adr): ADR-<番号> を accepted へ更新`）に一致、(2) その commit が当該 ADR ファイル1件のみを変更、(3) その commit の当該ファイル差分が status 行の proposed→accepted のみで本文を変更していない。いずれかを欠く場合は手順逸脱として finding を報告し非ゼロ終了する。3条件はいずれも正規 finalize の実装が構造的に満たす不変であり（単一ファイル add・固定メッセージ commit・digest 一致による本文不変）、正規経由の誤検知を避けつつ、設計文書と同一 commit で status を直接編集する典型的逸脱を捕捉する。squash/rebase により履歴署名が失われうる点はトレードオフだが、ガードは PR head での軽量な最善検知であり、既存逸脱事例の遡及是正は本 Issue の対象外である。

## 関連ADR

新規 ADR は作成しない。本 Issue の4件はいずれも既存機能の是正・運用品質の底上げであり、新たな恒久的アーキテクチャ判断を導入しない。各設計判断の根拠は本 DESIGN.md 内に自己完結して記載済みである。論点3の allowlist 変更は、責務スコープ allowlist を既定とする既存決定の枠内で1項目を除去し方針を強化するものであり、当該決定を覆さない。論点4の finalize ガードは既存 ADR ライフサイクル規約に対する検査の追加であり、規約自体を変更しない。

```yaml
related_adrs:
  - id: ADR-0002
    relation: references
```

（論点3が根拠とする「責務スコープ allowlist を既定とする」決定は現在 proposed 状態であり、`accepted` のみ参照可能な `related_adrs` へは登録できないため、その根拠は本文中に自己完結して記載した。上記 `related_adrs` には accepted 済みの ADR のみを登録している。writer lease 状態を検査する D3 の対象は同 ADR が定める lease モデルに基づく。）

## 障害・ロールバック考慮

- 想定される失敗モード: setup 分岐が config 誤読で github 副作用を誤スキップ／doctor 追加検査の偽陽性で正常環境が NG 判定／allowlist 除去で正規 PR 作成経路が阻害／finalize ガードの偽陽性で正規 accepted ADR を逸脱誤検知。
- ロールバック手順: 4件は独立実装・独立ファイルのため個別に revert 可能。allowlist 除去が問題化した場合は env `WORKER_ALLOWED_TOOLS` での一時上書き、または当該定数行の復元で即時回避できる。doctor・finalize ガードは追加検査であり、当該検査の削除で影響を除去できる。
- 影響を受ける既存機能: `setup`（引数無し。非推奨経路）／`doctor` 出力（追加行）／worker のヘッドレス自動承認範囲／`verify adr` の終了コード。既存テストスイート全件の緑維持を AC-9 で担保する。
