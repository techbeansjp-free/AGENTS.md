# DESIGN: codex adapterのlaunch_gate_reviewerが`codex exec`未対応の`--ask-for-approval`オプションでゲートレビュー起動に即座に失敗する

- Issue: `ISSUE-356`
- 対応する SPEC: `SPEC.md`
- 対象ブランチ: `bugfix/356-codex-exec-ask-for-approval-unsupported`

## 目的・対象範囲

`.agent-skill-chain/adapters/codex.sh` の `launch_gate_reviewer` 関数が組み立てる `codex exec` コマンドラインから、対象codex CLI（codex-cli 0.146.0相当）の `codex exec` サブコマンドが受理しない `--ask-for-approval never` を除去し、同等の効果を持つ受理可能な指定へ置き換える。対象は同関数内の `GATE_REVIEWER_CMD` 組み立て箇所（既定コマンドライン生成部）のみであり、`launch_worker`（`--ask-for-approval` 不使用）、`_codex_fail_safe`・認証検査・core reviewer属性検査等の周辺ロジック、4セグメント構成、writer lease、Check Runの状態遷移には一切変更を加えない。

## 前提

- `codex exec --strict-config -c approval_policy=\"never\" ...` は未知キー拒否モード下でもエラーなく受理され、セッションヘッダーに `approval: never` と反映されることを実機検証で確認済みである（検証手順・結果はADR-0016のContextに一次記録がある）。
- `codex exec --help` には `--ask-for-approval` が存在せず、`-s/--sandbox`・`-c/--config <key=value>` は存在する。`--ask-for-approval`（`-a`）はルートの `codex` コマンドの `--help` にのみ存在する。
- `GATE_REVIEWER_CMD` は `codex.sh` の `launch_gate_reviewer` 内で、`CODEX_REVIEWER_CMD`・`GATE_REVIEWER_CMD` のいずれもテスト用完全上書きとして与えられていない場合にのみ、既定コマンドラインとして組み立てられる（`launch_gate_reviewer`内の`GATE_REVIEWER_CMD`組み立て箇所のうち、テスト用完全上書きが無い場合の分岐）。この分岐が本Issueの変更対象である。
- 同じ組み立て箇所には既に `-c 'shell_environment_policy.inherit="none"'` 等、複数の `-c key=value` 形式のconfig override が同一エスケープ規約（シングルクォート内で値をダブルクォートする）で並んでおり、今回追加する指定もこの規約に合わせる。
- `_codex_fail_safe`（認証不成立・CLI不在の検知）、core reviewer時のmodel/effort一致検査、`_codex_gate_lifecycle` へのlifecycle委譲は、`GATE_REVIEWER_CMD` の中身に依存しない別処理であり、本Issueの変更の影響を受けない。

## 用語

- `GATE_REVIEWER_CMD`: `launch_gate_reviewer` がゲートレビュー起動時に実行するシェルコマンド文字列を保持する変数。テスト用完全上書き（`CODEX_REVIEWER_CMD`/`GATE_REVIEWER_CMD`環境変数）が無い場合、同関数内でcodex CLI呼び出しとして組み立てられる。
- config override: `codex exec -c <key>=<value>` の形式で `~/.codex/config.toml`相当の設定値を個別に上書きする指定。本Issueで扱う `approval_policy` もこの形式で指定する。
- fakeなcodex実行ファイル: 検証で用いる、実際のcodex CLIの引数受理仕様（`--ask-for-approval`を拒否し`-c`は受理する）を模したテスト用スタブ実行ファイル。実際のモデル呼び出しは行わない。

## 要件 → 設計要素の対応表

| 要件 / AC-ID | 対応する設計要素 | 備考 |
|---|---|---|
| AC-1 `codex exec`未対応オプションの不使用 | `GATE_REVIEWER_CMD`組み立て箇所（`codex.sh` `launch_gate_reviewer`内） | `--ask-for-approval never` を除去 |
| AC-2 引数エラーで即時失敗しない | 同上 + 回帰テスト（fakeなcodex実行ファイル） | 除去により対象CLIのサブコマンド仕様と一致させる |
| AC-3 承認プロンプトで停止しない挙動の維持 | 同上（`-c 'approval_policy="never"'` を追加） | 既存の `-c` 指定と同一エスケープ規約 |
| AC-4 `launch_worker`の非破壊 | `launch_worker`（変更対象外）+ 既存回帰テスト | コード変更なし。既存テストが固定確認する |
| AC-5 既存フェイルセーフ経路の維持 | `_codex_fail_safe`・認証/CLI存在検査（変更対象外）+ 既存回帰テスト | コード変更なし。既存の認証不成立・CLI不在テストで再確認する |
| AC-6 既存動作への非破壊 | 既存テストスイート全体（`npm test`） | 変更範囲がコマンドライン文字列の一部置換に閉じることを既存テストで担保する |

## 責務・境界

### コンポーネント構成

- `GATE_REVIEWER_CMD`組み立てロジック（`.agent-skill-chain/adapters/codex.sh` `launch_gate_reviewer`関数、既定コマンドライン生成部）: ゲートレビュー起動時に実行するcodex execコマンドライン文字列を組み立てる責務のみを持つ。認証検査・fail-safe・lifecycle委譲・isolated home管理は同関数内の別ブロックが担い、本Issueでは変更しない。
- 回帰テスト（`test/integration/gate-adapters.test.ts`、fakeなcodex実行ファイルを用いる新規テストケース）: 対象codex CLIバージョンの引数受理仕様（`--ask-for-approval`拒否・`-c`受理）を模したスタブ実行ファイルを用意し、`launch_gate_reviewer`の既定コマンドライン生成部を実際に起動して、引数エラーで即時終了しないこと・`approval_policy="never"`相当のconfig overrideが渡されていることを機械検証する。

1つのコンポーネントに責務が集中していないか（反証観点）: `GATE_REVIEWER_CMD`組み立てロジックはコマンドライン文字列の生成のみを担い、認証判定・実行・エラー処理は`launch_gate_reviewer`内の別ブロックおよび`_codex_gate_lifecycle`（`claude.sh`由来のlifecycle）に残ったままであり、本Issueによる責務の集中・拡散は生じない。

### 依存関係

```text
GATE_REVIEWER_CMD組み立てロジック(codex.sh) → codex exec（外部CLI）
回帰テスト(gate-adapters.test.ts) → fakeなcodex実行ファイル → GATE_REVIEWER_CMD組み立てロジック(codex.sh)
```

循環依存は無い。回帰テストは`codex.sh`の出力（組み立てられたコマンドライン）をfakeバイナリ経由で観測するのみであり、`codex.sh`側がテストコードに依存することはない。

## 関連ADR

```yaml
related_adrs:
  - id: ADR-0016
    relation: adopts
```

ADR-0016は本Issueの設計セグメントで `status: proposed` として作成し、設計ゲート承認時にfinalizationを経て `accepted` へ遷移する。

## 障害・ロールバック考慮

想定される失敗モード:

- `approval_policy` のconfigキー名が将来のcodex CLIバージョンで変更される: 本Issueのスコープ外（SPEC.md「スコープ外」に明記）。発生した場合は同じ「`-c key=value`への置換」パターンを踏襲する別Issueとして扱う。
- fakeなcodex実行ファイルが実際のcodex CLIの引数受理仕様と乖離する: 回帰テストが偽陽性で成功する可能性があるが、ADR-0016のContextに記録した実機検証結果（`--strict-config`付きでの受理確認）に基づいてfakeバイナリの拒否/受理条件を定義するため、乖離を最小化する。乖離が疑われる場合は実機での再検証が必要になる旨をテストコードのコメントとして残す。
- `-c` の値エスケープを誤り、`approval_policy` 以外のキーとして解釈される、またはシェル構文エラーになる: 既存の隣接する `-c` 指定と全く同じクォート規約（シングルクォート内でキー全体、値をダブルクォート）を踏襲することで回避する。回帰テストが組み立てられた文字列中の該当箇所を直接検証する。

ロールバック手順:

- 本Issueのcommitをrevertする。`GATE_REVIEWER_CMD`組み立て箇所の1オプション置換のみであり、永続状態・migrationを伴わないため、revertにより`--ask-for-approval never`を含む従来の（対象CLIでは動作しない）コマンドラインへ機械的に戻る。
- 成果物digestの変化により下流ゲートは自動的に無効化され、再通過が要求される。

影響を受ける既存機能: `launch_gate_reviewer`経由のゲートレビュー起動（codexアダプタ選択時）のみ。`launch_worker`、他アダプタ（claude/human）、writer lease、Check Run、4セグメント構成には影響しない。

## 検証方法

- 単体/結合: `test/integration/gate-adapters.test.ts`に、fakeなcodex実行ファイル（`--ask-for-approval`を含む引数列を拒否し、`approval_policy="never"`相当のconfig overrideを含む場合のみ正常応答を返すスタブ）を`CODEX_EXECUTABLE`として指定し、`CODEX_REVIEWER_CMD`/`GATE_REVIEWER_CMD`のテスト用完全上書きを使わずに`launch_gate_reviewer`を起動するテストケースを追加する。これによりAC-1〜AC-3を自動検証する。
- 回帰: 既存の「認証不成立」「CLI不在」テスト（`test/integration/gate-adapters.test.ts`）、`launch_worker`関連の既存アサーション（`test/integration/gate-adapters.test.ts`・`test/integration/worker-adapters.test.ts`）が変更後も成立することを確認し、AC-4・AC-5を担保する。
- 常時必須: lint / format、型検査、単体テスト、変更範囲の結合テスト（`npm test`実行によりAC-6を確認）。

## 完了条件

SPEC.mdのAC-1〜AC-6に対応する設計要素が本文書に定義され、実装単位と順序がPLAN.mdに定義され、判断の根拠がADR-0016に記録されていること。

## 未決事項

なし。SPEC.mdが設計セグメントへ委ねた事項（具体的な置換形と回帰テストの検証手段）は本文書で確定した。

## 対象外

`launch_worker`のコマンド組み立て自体の変更、`.agent-skill-chain/config/roles.yaml`等のgate reviewerアダプタ割当設定の変更、codex CLIバージョン間の互換性を自動追従する汎用レイヤーの導入、`-m`に指定するモデル名（`gpt-5.6`等）のChatGPTアカウント対応可否の調査。
