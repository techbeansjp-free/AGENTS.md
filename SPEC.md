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

- 回復対象は観測した Issue、segment、holder、branch、worktree に完全一致する active lease だけとする。
- 回復前に worker process 不在、worktree clean、未push commit 不在、completion report の不在または lease 取得時点以前かつ HEAD 一致を全て立証する。
- どれかを検査できない、実行中/不明 process、dirty/unpushed 状態、report の競合/不一致、または対象不一致なら回復しない。
- holder を含む明示確認と GitHub Issue の監査コメントを必須とし、credential は表示・保存しない。

### 受入条件（Acceptance Criteria）

#### AC-1: 安全条件を満たす orphaned lease だけを回復する

- Given: active lease の worker process が不在で、対象 worktree は clean、未push commit は無く、completion report は lease 取得後に無いか HEAD と整合する
- When: holder を指定した明示確認付き回復を実行する
- Then: 対象 lease だけが CAS で削除され、holder、根拠、時刻を含む監査コメントが記録される
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

- Given: lease 取得後の report、HEAD と異なる report、または複数 report の解釈不能な状態がある
- When: 回復を実行する
- Then: lease は保持され、理由付き非0終了となる
- 検証方法見込み: `automated`

#### AC-5: 対象同一性と確認を強制する

- Given: Issue、segment、holder、branch、worktree のいずれかが lease と異なる、または holder に束縛された確認が無い
- When: 回復を実行する
- Then: cross-Issue を含む全ての回復を拒否し、他の active lease は変化しない
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
