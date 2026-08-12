# DESIGN: worker完了確認がreported_sha != started_shaの場合に祖先関係を検証せずrollback/履歴書き換えを正当な新規作業として誤通過させる

- Issue: `ISSUE-671`
- 対応する SPEC: `SPEC.md`

## 要件 → 設計要素の対応表

SPEC.md の全要件・全 AC-ID は、単一の設計要素「祖先関係検証ブロック」（`_verify_worker_completion_report` 内、`reported_sha != started_sha` の分岐に追加する）へ対応する。呼び出し元・スキーマ・CLI引数は変更しない。

| 要件 / AC-ID | 対応する設計要素 | 備考 |
|---|---|---|
| 要件1（祖先関係検証を行う） | 祖先関係検証ブロック（`_verify_worker_completion_report`） | `git merge-base --is-ancestor` を利用 |
| 要件2（不成立ならblocked） | 同上、`rc==1` 分岐 | AC-1, AC-2 |
| 要件3（判定不能ならblocked） | 同上、`rc>=2` 分岐 | AC-4 |
| 要件4（成立時は既存判定へ進める、回帰なし） | 同上、`rc==0` 分岐 | AC-3 |
| 要件5（無変更completedの既存判定を変更しない） | `reported_sha == started_sha` の既存分岐（ISSUE-644, ADR-0062） | 変更しない。祖先関係検証ブロックは `else` 側にのみ追加する | AC-5 |
| 要件6（他の既存安全側チェックを後退させない） | 鮮度チェック・dispatchトークン一致チェック（既存、ADR-0060/0061） | 祖先関係検証ブロックの挿入位置はこれら既存チェックの間に限定し、既存分岐自体は変更しない |
| AC-1（rollbackはblocked） | 祖先関係検証ブロック、`rc==1` 分岐 | - |
| AC-2（rebase/amendによる非祖先もblocked） | 同上 | - |
| AC-3（正当な子孫commitは通過、回帰なし） | 同上、`rc==0` 分岐 | 既存テストの前提修正を伴う（PLAN.md変更単位3） |
| AC-4（判定不能はblocked） | 同上、`rc>=2` 分岐 | - |
| AC-5（無変更completedの既存動作に回帰なし） | `reported_sha == started_sha` の既存分岐 | 変更しない |

## 責務・境界

### コンポーネント構成

- `_verify_worker_completion_report`（`.agent-skill-chain/adapters/claude.sh`）: worker完了確認の唯一の判定関数。既存の `target_sha` とcurrent HEADの一致チェックの直後、`reported_sha == started_sha`（無変更completed、ISSUE-644/ADR-0062で追加済み）判定の `else` 側に、新規の祖先関係検証ブロックを追加する。既存の鮮度チェック・dispatchトークン一致チェック・`started_sha` 自体の形式検査（40桁16進数）は変更しない。
  - 祖先関係検証ブロックの責務: `reported_sha != started_sha` の場合にのみ、`git merge-base --is-ancestor "$started_sha" "$reported_sha"` を実行し、その終了コードだけを根拠に3値判定する（`git merge-base --is-ancestor` は「祖先である」場合に `0`、「祖先でない（到達不能）」場合に `1`、いずれかのSHAが有効なcommitとして解決できない等の異常時に `1` 以外の非0値〔通常 `128`〕を返す、という仕様上保証された終了コードの区別を利用する）。
    - `0`（祖先関係が成立）: このブロックをpassし、既存の後続チェック（dispatchトークン一致等）へ進む（要件4、AC-3）。
    - `1`（祖先関係が不成立、到達不能）: fail。「rollback・履歴書き換えの可能性」を示す具体的理由文字列を返す（要件2、AC-1・AC-2）。
    - それ以外の非0値（判定コマンド自体が異常終了、`started_sha`・`reported_sha` のいずれかがobjectとして解決不能等）: fail。「祖先関係を判定できない」ことを示す具体的理由文字列を返す（要件3、AC-4）。
  - `set -euo pipefail` が有効なファイル内であるため、`git merge-base --is-ancestor` は既存コード（例: `current_sha="$(git rev-parse HEAD 2>/dev/null || echo '')"`）と同じ慣用形（`cmd || rc=$?` で終了コードを変数へ退避してから分岐する形）で呼び出し、非0終了によるスクリプト全体の異常終了を避ける。
- `launch_worker`（同ファイル、直接spawn経路）と `worker-launch-verify.sh`（Agent tool dispatch経路）: いずれも `_verify_worker_completion_report` の戻り値（0=完了確認OK、非0=標準出力の理由文字列を伴うfail）を既存の `_fail_blocked` ヘルパー（blocked報告 + `human_escalation_requested: true` + writer lease解放、ADR-0060で確立済み）へそのまま渡す既存の汎用エラー伝播機構を持つ。祖先関係検証ブロックが返す新しい理由文字列も、この既存の汎用文字列伝播経路にそのまま乗るため、両呼び出し元のコード自体は変更しない（要件1後段「同等の完了判定を行う全経路」を、関数を共有することで自動的に満たす）。

### 依存関係

```text
_verify_worker_completion_report
  → git merge-base --is-ancestor（既存の git rev-parse HEAD 呼び出しと同じ、gitバイナリへの依存の拡張利用。新規の外部依存ではない）
  → 呼び出し元の既存フェイルセーフ経路（launch_worker の _fail_blocked / worker-launch-verify.sh の _fail_blocked、いずれも変更なし）
```

循環依存は無い（`_verify_worker_completion_report` は呼び出し元へ戻り値を返すのみで、呼び出し元へ逆依存しない）。

### 図示要否の判断

- 判断: `不要`
- 根拠: 変更を加える責務境界（コンポーネント）は `_verify_worker_completion_report` 内の1ブロックのみであり、3つ未満。呼び出し元2経路（`launch_worker`・`worker-launch-verify.sh`）はいずれもコード変更を伴わず既存の汎用エラー伝播経路を再利用するだけであり、新規の依存関係・新規の永続的な状態は生じない。祖先関係検証ブロック自体も「1回の外部コマンド呼び出し→終了コードによる3分岐→pass/fail」という単一の判定であり、状態遷移が2つ以上連なる複雑なフローではない。

## 関連ADR

```yaml
related_adrs:
  - id: ADR-0060
    relation: references
  - id: ADR-0061
    relation: references
  - id: ADR-0062
    relation: references
```

ADR-0060（worker completion reportの契約とdispatch鮮度）・ADR-0061（dispatchトークン一致による機械的照合）・ADR-0062（着手時SHA記録と無変更completed検出）は、本Issueが拡張する `_verify_worker_completion_report` の既存判定ロジックの前提を定めた決定であり、本Issueはこれらを置き換えずに新しい判定ブロックを追加する。本Issue自体の決定は `docs/adr/ADR-0063-worker-completion-report-ancestor-verification.md`（`status: proposed`）として別途新規作成する。

## 障害・ロールバック考慮

- 想定される失敗モード:
  - `git merge-base --is-ancestor` 自体が予期しない形（リポジトリ破損等）で異常終了する場合も、終了コードが `0` 以外である限り安全側（blocked）へ倒れるため、個別の異常処理分岐を追加する必要はない（要件3・AC-4の判定不能ケースに包含される）。
  - リポジトリが浅いclone（`git clone --depth=`）である環境では、`started_sha` が実際には祖先であっても history が切り詰められているために `git merge-base --is-ancestor` が誤って `1`（不成立）を返し、正当な完了報告を誤ってblockedにする可能性がある。本Issueが対象とするworktree（`git worktree add` で作成された作業ディレクトリ）は通常フルhistoryを持つmain clone由来のため、通常運用でこの事象は発生しない想定だが、浅いcloneでの運用は本Issueのスコープ外の既知の限界としてADRのConsequencesに記録する。
- ロールバック手順: 変更は `_verify_worker_completion_report` 内に追加する `else` ブロック1箇所に閉じている。既存の分岐（無変更completed判定・鮮度チェック・dispatchトークン一致チェック・`started_sha` 形式検査）、呼び出し元2経路のコード、`worker-report.schema.yaml`、`report status`/`report latest` CLIの引数はいずれも変更しないため、問題が発覚した場合は追加した `else` ブロックのみをrevertすれば、本Issue適用前の「祖先関係を検証しない」旧来動作へ即座に戻せる。
- 影響を受ける既存機能: worker完了確認全般（`launch_worker` 直接起動経路・`worker-launch-verify.sh` 経由のAgent tool dispatch経路の両方。両者が同一の `_verify_worker_completion_report` を共有するため）。既存の正当な「`started_sha` の上に1つ以上commitを積んで完了」フローは、祖先関係が成立する限り影響を受けない（AC-3、回帰なし）。`reported_sha == started_sha`（無変更completed、ISSUE-644/ADR-0062）の既存フローは本ブロックの対象外であり無影響（AC-5）。
