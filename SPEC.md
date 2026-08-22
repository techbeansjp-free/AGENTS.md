# SPEC: Orphaned active writer lease recovery

- Issue: `ISSUE-820`
- 作成者: `emergency_orchestrator`
- 対象ブランチ: `bugfix/820-orphaned-writer-lease-recovery`

## 目的・背景

worker が終了して one-time credential も失われた場合、期限前の active writer lease を安全に解放できず、同じ Issue の自走が TTL まで停止する。この Issue は、実行中 writer を奪わず、保存されていない成果物を失わず、監査可能に orphaned lease だけを回復する。

## 要求 → 要件 → 受入条件

### 要求

進行役は、credential を持たない orphaned writer lease を、厳密な安全条件を満たす場合だけ期限前に回収し、同じ Issue の作業を直ちに再開できる。

### 要件

- 回復判定の入力は、正本から一度に観測した active lease 全体とする。Issue、segment、holder、branch、worktree、`acquired_at`、`expires_at` および credential を公開せず正本 lease 全体を一意に束縛する digest を観測スナップショットとして固定する。
- 回復可能な report 状態は次のどちらかだけとする。(a) `acquired_at` 以後の completion report が無い、または (b) 同時点以後の report が1件だけあり、その segment、holder が観測スナップショットと一致し、status は `completed`、target SHA は対象 worktree の HEAD と一致する。`acquired_at` より前の report は観測 lease の判定対象外とする。
- 回復前に worker process 不在、worktree clean、未push commit 不在、前項の report 状態を全て立証する。検査不能、実行中または不明の process、dirty/unpushed 状態、時刻不明、複数、競合、不一致または `completed` 以外の report があれば回復しない。
- holder と観測スナップショットに束縛した明示確認を必須とする。削除は観測 digest を含む全スナップショットが直前の正本と一致する場合だけ CAS で行い、更新・延長・再取得された lease は削除しない。
- CAS 削除前に、回復 attempt、holder、観測 digest、判定根拠、時刻を含む GitHub Issue 上の耐久化された監査予約を記録し、読み戻しで確認する。予約の記録または確認が失敗したら lease を変更しない。削除後は同じ attempt に最終結果を記録・確認し、それが失敗した場合は部分成功の理由付き非0終了として「回復完了」を報告しない。
- credential の実値は表示・保存・確認入力しない。

### 受入条件（Acceptance Criteria）

#### AC-1: 安全条件を満たす orphaned lease だけを回復する

- Given: worker process が不在で、worktree は clean、未push commit は無く、`acquired_at` 以後の report が無い、または唯一の report が観測した segment・holder・HEAD に一致する `completed` である
- When: holder と観測 digest に束縛した明示確認付き回復を実行する
- Then: 監査予約が確認された後だけ対象 lease が CAS で削除され、同じ attempt の最終結果と holder・根拠・時刻が監査可能になる
- 検証方法見込み: `automated`

#### AC-2: process が実行中または検査不能なら回復しない

- Given: process が存在する、または process 検査が失敗・不明である
- When: 回復を実行する
- Then: lease と worktree は変更されず、理由付き非0終了となる
- 検証方法見込み: `automated`

#### AC-3: 未保存または未push の作業があれば回復しない

- Given: 対象 worktree に未commit変更または remote に存在しない commit がある
- When: 回復を実行する
- Then: lease は保持され、変更と commit は一切削除されない
- 検証方法見込み: `automated`

#### AC-4: completion report の不整合時は回復しない

- Given: `acquired_at` 以後の report が複数ある、時刻・segment・holder・target SHA・status のいずれかが不明または不一致である、あるいは status が `completed` 以外である
- When: 回復を実行する
- Then: lease は保持され、理由付き非0終了となる
- 検証方法見込み: `automated`

#### AC-5: 対象同一性と監査順序を強制する

- Given: 明示確認が無い、Issue・segment・holder・branch・worktree・`acquired_at`・`expires_at`・digest のいずれかが直前の正本と異なる、または監査予約を記録・確認できない
- When: 回復を実行する
- Then: CAS 削除を拒否し、対象と他の active lease は変化せず、理由付き非0終了となる。CAS 削除後の最終監査結果の記録・確認失敗は部分成功の非0終了となり、回復完了と報告されない
- 検証方法見込み: `automated`

#### AC-6: 回復後は1 writer のまま直ちに再取得できる

- Given: AC-1 を満たして lease が回復された
- When: 同じ Issue の新しい writer が lease acquire を実行し、並行する別 acquire も実行する
- Then: 1つだけが成功し、成功した writer は直ちに作業を再開でき、credential は出力されない
- 検証方法見込み: `automated`

## スコープ外

- TTL の短縮または無効化。
- writer credential の出力、共有、永続化。
- 1 Issue の複数 writer 許可。
- 保存済み成果物や GitHub audit 証跡の削除。
