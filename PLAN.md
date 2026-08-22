# PLAN: Sync issue artifacts at each checkpoint push

- Issue: `ISSUE-816`
- 対応する DESIGN: `DESIGN.md`

## 目的・前提・完了条件

承認済み SPEC と DESIGN の責務境界を、共有同期ロジックの純粋化、対象別安全処理、checkpoint 後置接続、回帰検証の順に実装する。commit/push の成功条件を先に維持し、同期失敗を後から checkpoint 失敗へ昇格させない。

入力は既存 `issue_sync` 設定、branch、push 済み完全 SHA、同 SHA の4成果物、既存ゲート記録、GitHub stub 本文である。出力はコード、対象別結果、非致命警告、自動テストログである。新 ADR・設定・schema は作らず、全 AC と常時検査が成功した時点を実装完了とする。

## 実装順序・変更単位

| # | 変更単位 | 内容 | 対応 AC-ID | 依存する変更単位 |
|---|---|---|---|---|
| 1 | branch から Issue 番号を解決 | `branch.pattern` を尊重して `{issue_id}` を一意抽出する共有関数を追加し、標準 branch、custom pattern、不一致を unit test する | AC-1, AC-2 | なし |
| 2 | payload と境界 parser の純粋化 | 規定順序の可逆 marker codec、0組/正常1組/欠落/重複/逆転を分類する parser、marker 外を不変にする置換関数を実装する | AC-5, AC-7 | なし |
| 3 | backend 正準ゲート状態 resolver | 入力を backend、repository、checkpoint SHA、gate id→Check 名、trusted recorder identity、既存 schema として固定する。GitHub は Check Run だけを正本とし、到達可能な新しい commit から gate ごとの completed record を選び、同一 commit は完了時刻・ID順で1件に決定後、name/head/target SHA、identity、構文、schema、gate id、final/conclusion を検証する。不在・取得不能・不正はすべて理由付き `unknown` とし、古い record や一時 file へ fallback しない。local は Git 管理下 record を維持する | AC-8, AC-10 | なし |
| 4 | SHA固定スナップショットとゲート表示 | `git show` で実在成果物だけを読み、検証済み record target SHA と checkpoint SHA の同一/祖先/証明不能を `current` / `older` / `unjudged` と描画する。`unknown` に final state や target SHA を補わない | AC-3, AC-7, AC-8 | #2, #3 |
| 5 | 対象別本文トランザクション | full/fallback/no-write の排他的上限判定、本文全体 CAS、1回再試行、古い/順序不明 SHA の no-write、同一内容 no-op、型付き結果を実装する | AC-4, AC-5, AC-6, AC-9, AC-10 | #2, #4 |
| 6 | 共有同期サービスへ統合 | checkpoint と `gate publish` が同じ resolver 入力、record 選択、identity/schema 検査、renderer を必ず通る trigger 非依存入口へ置換し、target 解決と対象別処理を束ねる。CAS 再試行時も正準状態を再解決する | AC-2, AC-4, AC-8, AC-10 | #1, #3, #5 |
| 7 | checkpoint 後置フック | push 成功後に完全 SHA と Issue 番号で共有同期を呼ぶ。全結果/例外を SHA 付き stderr 警告へ変換し、stdout 1行 SHA・終了コード0・remote ref を維持する。push 失敗時は呼ばない | AC-1, AC-2, AC-3, AC-9 | #1, #6 |
| 8 | gate publish 接続を維持 | Check Run 発行試行後、成否と独立して発行 target SHA で同じ共有入口を呼ぶ。一時 report を直接 renderer へ渡さず、発行成否にかかわらず正準 Check Run resolver の結果だけを描画する | AC-8, AC-10 | #6 |
| 9 | GitHub stub の観測点拡張 | 本文競合・対象別失敗に加え、commit 別 Check Run、別プロセス実行、API失敗、malformed output、identity/name/head SHA 不一致を注入・観測可能にする | AC-4, AC-5, AC-8, AC-9 | #3, #5 |
| 10 | checkpoint 統合テスト | SPEC→DESIGN→PLAN→VALIDATION を順に checkpoint し、各 push 直後の完全 SHA、存在成果物だけの本文、gate 未到達、remote ref を検査する | AC-1, AC-3, AC-7, AC-9 | #7, #9 |
| 11 | 正準状態・回帰統合テスト | gate publish 終了後に一時 file が無いことを確認して checkpoint を別プロセス実行し、Check Run だけから再現する。gate ごとの completed record 選択、absent/API unavailable/malformed/wrong name/head/target SHA/gate/identity、current/older/unjudged、unknown が状態と SHA を合成しないこと、local record 維持、3 target、CAS、上限、重複を網羅する | AC-2, AC-4, AC-5, AC-6, AC-7, AC-8, AC-10 | #8, #9 |
| 12 | 全体検証と証跡整理 | build、対象テスト、全テスト、常時 lint を foreground 実行し、AC別ログを validation worker へ渡す | AC-1〜AC-10 | #10, #11 |

## テスト配置とケース行列

### GitHub gate resolver の具体作業

resolver API の入力を backend、repository、checkpoint SHA、gate id→設定済み Check 名、信頼する recorder identity、既存 gate-report schema として固定する。GitHub backend は gate ごとに到達可能 commit を新しい順で照会し、最初に completed record がある commit を採用する。同一 commit では完了時刻、次いで Check Run ID の降順で最新1件を選択してから、name、head SHA、recorder identity、output 構文、schema、gate id、record target SHA、final/conclusion の整合性を検証する。API・branch 範囲・応答の取得または解釈不能は理由付き `unavailable`、record 不在、malformed、wrong name/head/target SHA/gate/identity は理由付き `unknown` とし、より古い record や一時ファイルから状態を合成しない。

checkpoint と `gate publish` の入口を同じ resolver と renderer に接続する。検証済み record target SHA と checkpoint SHA の比較は同一を `current`、祖先を `older`、関係を証明不能なら `unjudged` とし、`unknown` / `unavailable` には final state と target SHA を描画しない。local backend は Git 管理下 record の既存経路を維持し、GitHub Check Run と相互 fallback しない。

### 既存テストの拡張先

- `test/integration/issue-sync.test.ts`: 既存 gate publish 回帰を残したまま checkpoint 主経路、3 target、両対象の独立性、CAS、marker、本文上限、別プロセスの Check Run 正準状態解決とゲート表示を追加する。
- `test/helpers/gh-stub.ts`: 本文 read/edit、PR 一意選択、Check Run の既存 stub に、commit/identity/output 別応答、取得失敗、対象別失敗、本文全体競合の注入・呼出し観測を追加する。
- `test/unit/worktree.test.ts`: branch pattern からの Issue 番号抽出を標準/custom/detached由来文字列/不一致で検査する。
- `test/integration/verify.test.ts`: 既存 checkpoint の attached/detached・push SHA 契約を回帰基準として維持し、必要なら disabled/local で同期 API が無いことの最小ケースを追加する。

### 必須ケース

| 観点 | ケース | 主な検査 |
|---|---|---|
| 4 checkpoint | SPECのみ、+DESIGN、+PLAN、+VALIDATION | 各 push SHA と本文 SHA 一致、未作成節なし、gate publish 不要 |
| SHA固定 | checkpoint 後に作業コピーと branch tip を変更 | payload が `git show <checkpointSha>` と一致 |
| target | `issue_body` / `pr_body` / `both` | 指定先だけ更新、PR 0/複数は no-write、片側失敗でも他方成功 |
| CAS | marker 外変更、marker 内変更、連続競合 | 再取得で第三者変更保持、未解消時 edit なし、警告に対象と SHA |
| 重複 | 同一 SHA checkpoint 再試行、同一 SHA gate publish、古い gate publish と新 checkpoint | marker 1組、同一候補 no-op、新しい SHA を古い候補で巻き戻さない |
| marker | 開始/終了文字列、`&amp;`、`&#60;` を成果物へ混在 | payload に生 marker なし、逆変換が元全文と一致 |
| 境界 | 0組、正常1組、片側欠落、重複、逆転 | 追加/区間置換/no-write が排他的、marker 外全文一致 |
| 本文上限 | full が上限ちょうど、full 1文字超過で fallback 可能、fallback も超過 | `synced_full` / `synced_fallback` / `sync_failed_no_write`、最後は edit なし |
| gate正本 | gate publish を子プロセスで完了して終了し、一時 report が存在しない状態で checkpoint を別プロセス実行 | 作業ディレクトリやプロセス間 temp file を使わず、4ゲートそれぞれを Check Run だけから同じ状態へ復元 |
| record選択 | 各 gate で複数 commit、同一 commit の複数 completed、in-progress と completed を混在 | checkpoint から到達可能な最新 commit、同一 commit の最新 completed 1件を完了時刻・ID順で選び、他 gate と混同しない |
| gate不在・取得不能 | Check Run 無し、completed 無し、Check Run API/branch 範囲/応答失敗 | 不在は理由付き unknown、取得不能は unavailable、final state・target SHA無し、temp/local/本文から補完せず Check Run 生成なし |
| gate不正 | malformed JSON/YAML、schema 不適合、wrong gate/name/head/target SHA/identity、final/conclusion 不整合 | 選択 record を理由付き unknown とし、より古い valid record へ fallbackせず、状態・SHAを捏造しない |
| gate表示 | record target SHA が checkpoint と同一、祖先、関係を証明不能 | 検証済み target SHA と current/older/unjudged を表示し、stale record は older、unknown は比較表示なし |
| backend分離 | 同じ fixture で GitHub backend と local backend | GitHub は Check Run のみ、local は Git 管理下 record のみを読み、相互 fallback なし |
| 非致命性 | API、境界、上限、CAS、PR解決失敗 | checkpoint は0、stdoutは完全 SHA 1行、remote ref一致、stderr診断 |
| gate分離 | checkpoint のみ実行 | Check Run、承認、gate record の生成・変更が0件 |
| 無効条件 | local、GitHub+disabled | Issue/PR の read/edit 0件、従来 checkpoint 結果 |

## 実装上の検査順序

1. 純粋関数と unit test を実装し、codec・境界・branch 解決を先に固定する。
2. GitHub Check Run resolver と local resolver を固定し、別プロセス・absent・malformed・wrong-SHA/identity を先に反証する。
3. 対象別トランザクションを既存 gate publish テストで回帰確認する。
4. checkpoint 後置フックを接続し、4 checkpoint、current/older/unjudged、`both`、CAS、上限を確認する。
5. `npm run build`、対象テスト、`npm test`、`.agent-skill-chain/ci/verify-doc-length.sh`、`.agent-skill-chain/scripts/lint-references.sh`、`.agent-skill-chain/scripts/lint-vocab.sh`、`.agent-skill-chain/scripts/adr-lint.sh check` をすべて foreground で実行する。

## 障害時の切り戻し単位

- #1〜#4 は純粋/共有処理なので個別に戻せる。
- checkpoint 回帰があれば #6 の後置フックだけを外し、push 契約を即時復元する。
- gate publish 回帰があれば #7 の接続を従来入口へ戻せるが、共有 renderer のデータ形式は維持して本文移行を不要にする。
- GitHub stub 拡張は本番動作へ影響しない。いずれの切り戻しでも設定・schema・既存本文・remote commit は削除しない。

## 制約・未決事項・対象外

明示対象以外を stage せず、実装セグメントでは設計要素を変更しない。新設定、ADR、同期先、コメント分割、過去 Issue 補正、ゲート判定変更は対象外である。未決事項はなく、実装中に責務・境界の変更が必要になった場合は DESIGN.md を更新して設計ゲート再通過を要求する。

## 実装順序の見直しについて

実装中に変更単位の順序だけを見直す場合は PLAN.md のみを更新する。同期の非致命境界、SHA 固定、対象別独立性、共有サービス、CAS/no-write の責務を変える場合は DESIGN.md も更新する。
