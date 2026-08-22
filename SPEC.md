# SPEC: Sync issue artifacts at each checkpoint push

- Issue: `ISSUE-816`
- 作成者: `spec_worker`
- 対象ブランチ: `bugfix/816-checkpoint-artifact-sync`

## 目的・背景

GitHub モードで Issue 本文または PR 本文を成果物内容の正本として使う設定では、各セグメントの成果物が remote push 済みの commit に存在するだけでなく、GitHub 本文の固定同期マーカー内からも確認できなければならない。現状は同期が `gate publish` に依存するため、ゲート未到達、中断、またはゲート発行経路の制約で停止した Issue では、commit 済みの要求・設計・実装計画が GitHub 上に存在しないように見える。

本 Issue の目的は、各セグメントの checkpoint commit と remote push が成功した時点を成果物同期の契機に加え、ゲート発行前でも指定された GitHub 本文へ、その checkpoint の完全 SHA に固定した成果物内容を転記することである。checkpoint による耐久性の確保と GitHub 本文への転記は結果上独立させ、転記不能によって push 済み checkpoint を失敗扱いにしない。

関連する確定済み判断として、GitHub 本文の固定同期マーカー内に転記された成果物はゲートの判定軸へ読み戻してはならない。本仕様もこの境界を維持し、checkpoint 同期によってゲート状態を生成、承認、または変更しない。

## 用語

- checkpoint: セグメント成果物を commit し、その commit を対象 branch の remote へ push して、完全 SHA を確定する操作。
- checkpoint SHA: 当該 checkpoint が remote push に成功した commit の 40 桁完全 SHA。
- 成果物: checkpoint SHA の Git tree に存在する `SPEC.md`、`DESIGN.md`、`PLAN.md`、`VALIDATION.md`。
- 固定同期マーカー: GitHub Issue 本文または PR 本文内で、agent-skill-chain が排他的に生成内容を置換する開始・終了マーカーの区間。
- 対象本文: `issue_sync.target` が指定する `issue_body`、`pr_body`、または `both` のうち、対象 Issue または一意に特定できる open PR に実在する本文。
- 同期失敗: GitHub API エラー、対象 PR の不在・複数該当、競合の未解消、本文上限への安全な縮退不能などにより、対象本文の固定同期マーカーを更新できない状態。

## 入力・出力

### 入力

- Coordination Backend のモード。
- `issue_sync.enabled`、`issue_sync.target`、`issue_sync.max_body_chars` の実効設定値。
- Issue ID、対象 branch、および remote push に成功した checkpoint SHA。
- checkpoint SHA に存在する成果物の内容。
- 対象となる GitHub Issue 本文と、一意に特定できる場合の open PR 本文。
- checkpoint 時点で既に存在するゲート状態。

### 出力

- 有効条件を満たす場合、指定された各対象本文の固定同期マーカー内に、checkpoint SHA、実在する成果物の全文、および既存のゲート状態を反映した同期結果。
- 同期を完了できない場合、対象、理由、および checkpoint SHA を識別できる警告。
- 同期結果にかかわらず、commit と remote push が成功している checkpoint の成功結果と checkpoint SHA。

## 要求 → 要件 → 受入条件

### 要求

GitHub モードかつ `issue_sync.enabled: true` の Issue では、SPEC・DESIGN・PLAN・VALIDATION の作成または更新を含む各セグメントの checkpoint commit と push が成功した後、成功したゲートの発行を待たずに、指定された GitHub 本文へ成果物を同期する。同期は checkpoint SHA に固定された内容だけを用い、既存の競合保護、本文上限、マーカー外不変、対象選択、未作成成果物の除外、および `gate publish` 時の同期との互換性を維持する。

### 要件

- Coordination Backend が `github` であり、かつ `issue_sync.enabled` が `true` の場合だけ、成功した各セグメントの checkpoint push 後に同期を試行する。ローカルモードまたは明示的な無効化では GitHub 本文を変更しない。
- 同期元は branch の作業コピーや移動し得る branch tip ではなく、remote push に成功した checkpoint SHA の Git tree とする。同期結果にはその完全 SHA を含める。
- checkpoint SHA に存在する成果物だけを掲載し、存在する成果物は要約・抽出せず全文を掲載する。後続セグメントの未作成成果物について、空の節、推測した内容、またはプレースホルダーを生成しない。
- `issue_sync.target` の `issue_body`、`pr_body`、`both` を尊重する。PR 本文は対象 Issue に対応する open PR が一意に特定できる場合だけ更新する。`both` の一方を解決または更新できなくても、他方の同期は独立して試行する。
- 固定同期マーカーが無い対象本文にはマーカー区間を追加し、既にある場合はその区間だけを置換する。マーカー外の人間記述はバイト列として不変に保ち、同期の反復でマーカー区間を増殖させない。
- 書き込み直前の本文変更を compare-and-swap 相当で検知する。安全に解消できない競合では書き込まず、第三者の変更を保持して警告する。
- 生成後の本文全体が `issue_sync.max_body_chars` を超えないようにする。全文を収容できない場合は、checkpoint SHA を含む既存の安全な案内表示へ縮退し、上限超過を理由にマーカー外の内容を削除または切り詰めない。
- checkpoint 同期は既存のゲート状態を表示できるが、Check Run、ゲート承認、ゲート通過、または新たなゲート状態を生成・変更してはならない。転記内容を後続のゲート判定入力へ読み戻してはならない。
- 同期失敗は警告として観測可能にするが、commit と remote push が成功した checkpoint の成功結果を失敗へ変更しない。複数対象の一部失敗も、成功可能な他方の更新を取り消さない。
- `gate publish` による既存同期を維持する。checkpoint 同期の追加後も、ゲート発行時には発行対象 SHA と確定済みゲート状態を用いて同じ対象選択・固定マーカー保護・競合検知・上限処理を適用する。

### 受入条件（Acceptance Criteria）

#### AC-1: 有効条件を満たす checkpoint がゲート未到達でも同期される

- Given: Coordination Backend が GitHub、`issue_sync.enabled: true` であり、対象セグメントの成果物を含む commit がまだゲートを通過していない
- When: checkpoint の commit と remote push が成功する
- Then: `gate publish` を実行しなくても、設定された既存の対象本文の固定同期マーカー内へ checkpoint SHA とその SHA に存在する成果物が同期される
- 検証方法見込み: `automated`
- verification.mode: `automated`
- 想定証跡: ゲート未到達の SPEC、DESIGN、PLAN 各 checkpoint を順に実行し、各 push 後の GitHub API 書き込み内容と完全 SHA を検査する統合テストログ

#### AC-2: 無効条件では GitHub 本文を変更しない

- Given: Coordination Backend がローカル、または `issue_sync.enabled: false` である
- When: 成果物を含む checkpoint の commit と push が成功する
- Then: Issue 本文と PR 本文への読み書きによる成果物同期は行われず、checkpoint は従来どおり完了する
- 検証方法見込み: `automated`
- verification.mode: `automated`
- 想定証跡: backend と enabled の組合せごとに GitHub 本文の更新呼び出しが無いことを検査する自動テストログ

#### AC-3: 同期元を push 済み checkpoint SHA に固定する

- Given: checkpoint SHA と、その後に内容が異なる作業コピーまたは branch tip が存在する
- When: checkpoint 後の成果物同期が行われる
- Then: 同期される完全 SHA と各成果物の全文は checkpoint SHA の Git tree に一致し、後発の未 push 内容を含まない
- 検証方法見込み: `automated`
- verification.mode: `automated`
- 想定証跡: checkpoint SHA と作業コピーに異なる内容を置き、同期本文を checkpoint SHA の `git show` 結果と照合する統合テストログ

#### AC-4: target ごとの対象選択と独立性を守る

- Given: `issue_sync.target` が `issue_body`、`pr_body`、または `both` のいずれかであり、対象 Issue と open PR の有無・一意性が既知である
- When: checkpoint 後の同期が行われる
- Then: 指定された対象だけが更新され、PR は一意に特定できる場合だけ更新され、`both` の一方が未解決または失敗でも他方の同期は試行される
- 検証方法見込み: `automated`
- verification.mode: `automated`
- 想定証跡: 3 種の target、PR が 0 件・1 件・複数件、および一方の API エラーを組み合わせた統合テストログ

#### AC-5: マーカー外の内容と競合更新を保護する

- Given: 対象本文にマーカー外の人間記述があり、固定同期マーカーが無い場合または既に存在する場合があり、書き込み前に第三者更新が起こり得る
- When: checkpoint 同期を初回または反復実行する
- Then: マーカー外の内容は不変に保たれ、マーカー区間は一組だけ存在し、未解消の競合を検知した場合は書き込みをスキップして第三者更新を保持し警告する
- 検証方法見込み: `automated`
- verification.mode: `automated`
- 想定証跡: 初回追加、反復置換、同一内容再実行、および競合注入後の本文全体を比較する自動テストログ

#### AC-6: 本文サイズ上限を安全に守る

- Given: マーカー外の内容と checkpoint SHA の成果物全文を合わせると `issue_sync.max_body_chars` を超える
- When: checkpoint 同期が対象本文を生成する
- Then: 本文全体は上限内に収まり、マーカー外の内容は変更されず、固定同期マーカー内は checkpoint SHA を含む案内表示へ縮退し、上限超過が警告される
- 検証方法見込み: `automated`
- verification.mode: `automated`
- 想定証跡: 境界値以下・境界値超過の本文長、マーカー外文字列、案内表示、および警告を検査する自動テストログ

#### AC-7: 未作成成果物を掲載しない

- Given: checkpoint SHA には 4 成果物の一部だけが存在する
- When: checkpoint 同期が固定同期マーカーを生成する
- Then: 存在する成果物だけが全文掲載され、存在しない成果物の節、推測内容、またはプレースホルダーは掲載されない
- 検証方法見込み: `automated`
- verification.mode: `automated`
- 想定証跡: SPEC のみ、SPEC・DESIGN、SPEC・DESIGN・PLAN、4 成果物すべての各 Git tree に対する同期本文のスナップショット検査ログ

#### AC-8: checkpoint 同期がゲート状態を偽装せず判定入力にもならない

- Given: 対象 checkpoint のゲートが未到達、または既存の確定状態を持つ
- When: checkpoint 後の同期が行われる
- Then: 新たな Check Run、承認、通過、またはゲート状態変更は発生せず、表示する場合は既存状態だけに一致し、同期マーカー内の内容はゲート判定入力から除外される
- 検証方法見込み: `automated`
- verification.mode: `automated`
- 想定証跡: 同期前後の Check Run・ゲート状態を比較し、判定入力から同期区間が除外されることを検査する自動テストログ

#### AC-9: 同期失敗が push 済み checkpoint の耐久性を破壊しない

- Given: checkpoint の commit と remote push は成功し、その後の GitHub API エラー、競合、または対象解決不能により一部または全部の同期が失敗する
- When: checkpoint 処理が完了する
- Then: checkpoint は成功と完全 SHA を返し、remote branch はその SHA を指し、同期失敗の対象・理由・SHAが警告として観測でき、成功した別対象の更新は保持される
- 検証方法見込み: `automated`
- verification.mode: `automated`
- 想定証跡: 同期失敗を注入した checkpoint の終了コード、標準出力、警告、remote ref、および対象本文を検査する統合テストログ

#### AC-10: gate publish 時の既存同期が互換性を保つ

- Given: checkpoint 同期後に同じ Issue のゲートが発行され、`issue_sync` が有効である
- When: `gate publish` が実行される
- Then: 発行対象 SHA と確定済みゲート状態で固定同期マーカーが更新され、target、競合保護、マーカー外不変、本文上限、未作成成果物除外、および同期失敗の非致命性が checkpoint 同期と同じ契約を維持する
- 検証方法見込み: `automated`
- verification.mode: `automated`
- 想定証跡: checkpoint 同期後に各ゲートを発行し、既存 issue-sync 回帰テストと本文スナップショットが成功する統合テストログ

## 制約

- 成果物同期は Git から GitHub 本文への一方向転記であり、GitHub 本文を成果物ファイルへ逆同期しない。
- checkpoint の成功条件である commit と remote push を緩和しない。push 失敗時には同期を行わず、従来どおり checkpoint を失敗とする。
- 同期失敗を黙殺せず、後から失敗した対象と checkpoint SHA を特定できる診断を残す。
- 固定同期マーカーの文字列と、ゲート判定入力から同期区間を除外する契約を同時に維持する。
- 新たな設定項目を要求しない。既存の `enabled`、`target`、`max_body_chars` の意味を維持する。

## 完了条件・検証方法

- AC-1 から AC-10 が自動テストに一意に対応し、検証結果と実行ログが `VALIDATION.md` の同じ AC-ID の `verification.mode` と `evidence` に記録される。
- checkpoint 単体の成功・失敗、GitHub API を模擬する統合テスト、既存 issue-sync 回帰テスト、および repository の常時必須検査が成功する。
- spec checkpoint 前に、次の静的検査を foreground で完了し、すべて終了コード 0 を確認する。
  - `.agent-skill-chain/ci/verify-spec-bdd.sh SPEC.md`
  - `.agent-skill-chain/ci/verify-doc-length.sh`
  - `.agent-skill-chain/scripts/lint-vocab.sh`
  - `.agent-skill-chain/scripts/lint-references.sh`

## 未決事項

なし。本仕様で対象条件、同期契機、SHA の固定、対象選択、競合時・上限超過時・同期失敗時の挙動、およびゲート同期との関係を確定する。

## スコープ外

- 検出済みの #798 / PR #804、#808 / PR #809、#814 / PR #815 に対する補正転記。これらは既存同期機能による運用回復が完了しており、本 Issue は今後の checkpoint における再発防止だけを扱う。
- Issue/PR 本文の固定同期マーカー外を機械編集すること。
- GitHub 以外の Coordination Backend の成果物正本または耐久性モデルを変更すること。
- 同期された本文をゲート判定、成果物検証、または成果物ファイル生成の入力にすること。
- ゲートの通過条件、レビュー判定、Check Run の発行条件、または既存ゲート状態の意味を変更すること。
- #814 の reasoning effort policy の内容を変更すること。
- GitHub 本文上限を超える成果物をコメントや外部ストレージへ分割保存する新方式を追加すること。
