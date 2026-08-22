# 由来: AGENTS.mdが定める不変条件I7（仕様⇔検証の追跡）の規約に基づく検証報告である。
# 本ファイルは純粋なYAMLとして記述する（verify ac-coverage が単一YAML文書として読むため）。
#
# 目的: Issue ISSUE-798「root成果物の削除がLLMワーカー1ラウンドを消費し、claude adapterでは
#       完走できない」の実装を、実装セグメントとは独立に受入・回帰の観点で検証し、SPEC.md が
#       定める AC-1〜AC-12 それぞれの充足可否と証跡を確定する。
#
# 対象範囲: 新設した決定的コマンド `root-cleanup branch <issue_id>` とその薄いラッパー、
#       root成果物の3状態区分を与える純関数、`.agent-skill-chain/config/roles.yaml` の
#       root_artifact_cleanup_worker（ロール定義と入出力契約の双方）、writer lease スキーマの
#       segment enum 拡張、worktree削除コマンドが有効leaseを探す走査方法の置換、および
#       claude adapter のセグメント作業ワーカー既定許可コマンド列挙。
#
# 対象外（本検証で判定しないもの）:
#   - 既定ブランチへのpushを契機とする事後清掃自動化と root残存検査の内部設計そのもの。
#     本検証はそれらの外部挙動が変わっていないこと（AC-11）だけを判定する。
#   - ADR status更新コマンドが、対応するロール定義でlease取得能力を宣言しながら実装では
#     writer leaseを取得していないという既存の宣言・実装不一致。DESIGN.md が本Issueの範囲外と
#     明示しており、本検証でも是正せず観測事実として扱う。
#   - codex adapter の sandbox 境界、進行役の権限、4セグメント・4ゲートの構成。
#
# 用語（本ファイル内での定義）:
#   - root成果物: repository root 直下の SPEC.md・DESIGN.md・PLAN.md・VALIDATION.md の4ファイル。
#   - 本コマンド: 新設した CLI サブコマンド `root-cleanup branch <issue_id>` と、その薄いラッパー
#     .agent-skill-chain/scripts/root-cleanup-branch.sh。
#   - 削除対象 / 内容喪失リスクあり / 不在: SPEC.md が定める対象ファイルの3状態区分。
#   - 全量実行: 対象SHAの作業ツリーで `npm test` を前景で1回だけ完走させた実行。
#
# 入力: SPEC.md（AC-1〜AC-12）、DESIGN.md（D1〜D14）、PLAN.md、および対象SHA
#       3c7149eab1bd7bd8b481f7a8073563669fa7985b の実装・自動テスト。
# 出力: 本ファイルの acceptance_criteria（ACごとの検証方法・結果・証跡）と regression。
#
# 検証方法と前提:
#   - 全12 ACの検証方法は automated である。SPEC.md の各ACの「検証方法見込み」と一致する。
#   - 判定の基礎は、対象SHAの作業ツリーでの `npm test` 全量実行1回である。実測結果は
#     tests 1638 / pass 1637 / fail 0 / cancelled 0 / skipped 1 / todo 0、duration 745128ms、
#     終了コード0。`npm test` は pretest で `npm run build`（tsc）を実行するため、型検査の
#     成功もこの終了コード0に含まれる。
#   - 制約（証跡の粒度）: 全量実行の標準出力は末尾のみを保持したため、AC別テストの個別
#     「✔」行は保持していない。したがってAC別の pass 判定は「当該テストが対象SHAに存在すること」
#     と「全量実行が fail 0 かつ終了コード0であること」の連言から導いている。個別行の欠落を
#     判定の根拠にはしていない。
#   - 上記に加えて、テスト結果に依存しない独立確認を実施した。内訳は各ACの evidence に記す。
#     これは自動テストが主張どおりの対象を見ているかを、テストを介さずに確かめるためである。
#   - ゲート対象SHAと本ファイルの target_sha の関係: 本ファイルの target_sha は実装SHA
#     3c7149eab1bd7bd8b481f7a8073563669fa7985b であり、ゲート対象は本ファイルを追加した
#     a72e5513af4f166131ef7db46af8ef27a6334e96 である。両者の関係は次の2点の実測で確定している。
#     (a) git merge-base --is-ancestor 3c7149eab1bd7bd8b481f7a8073563669fa7985b
#         a72e5513af4f166131ef7db46af8ef27a6334e96 の終了コードは0であり、実装SHAはゲート対象SHAの
#         祖先である。すなわち実装SHAの内容はゲート対象SHAに巻き戻されず含まれている。
#     (b) git diff --name-status a72e5513af4f166131ef7db46af8ef27a6334e96
#         3c7149eab1bd7bd8b481f7a8073563669fa7985b の出力は、D とタブ区切りで VALIDATION.md を示す
#         1行のみである。両SHAの差は VALIDATION.md の有無だけであり、他のファイルは1件も差が無い。
#     VALIDATION.md は検証報告であって src/ ・ test/ のいずれからも読み込まれず、tsconfig のビルド対象
#     にも含まれない。したがって 3c7149ea で得た型検査・自動テストの結果は a72e5513 でも同じ入力に
#     対する同じ結果として成立する。
#   - 全量実行の skipped 1 件の同定: skip した1件は test/integration/cli-resolve.test.ts の
#     'GitHub導入元へ実際に到達してpackage versionを取得できる' である。根拠は次の連言である。
#     (a) test/ 配下を skip で全走査した結果、skip 指定は t.skip( の9箇所のみで、node:test の
#         skip オプション形式による指定は1件も無い。したがって候補集合はこの9箇所で閉じている。
#     (b) 9箇所のうち6箇所（test/integration/upgrade.test.ts の2箇所・test/unit/stale-assets.test.ts の
#         4箇所）は isRunningAsRoot()、すなわち process.getuid() === 0 を条件とする。実行環境の
#         id -u は 1000 であり、この6箇所は成立しない。
#     (c) 残る3箇所の条件は、ASC_TEST_LIVE_CLI_INSTALL_SOURCE が '1' でないこと（上記の1件）、
#         setsid(1) の不在、script(1) の不在である。ASC_TEST_LIVE_CLI_INSTALL_SOURCE は
#         リポジトリ全体を走査しても当該テストの読み取り箇所以外に一切現れず、package.json の
#         test スクリプトも環境変数を設定しない。素の npm test では未設定であり、この1件は必ず skip する。
#     (d) 実測の skipped が1であることから、残る2箇所（setsid・script）は skip していない。すなわち
#         実行環境には setsid(1) と script(1) が存在した。
#     この1件は実ネットワークでGitHub導入元へ到達する明示オプトインのテストであり、既定スイートを
#     ネットワーク障害で不安定にしないため通常は skip する設計である。本Issueの AC-1〜AC-12 の
#     いずれとも対応せず、AC別の判定に影響しない。
#
# 完了条件: 全AC-IDに verification.result と evidence が対応し、regression の実行結果が
#       記録されていること。
#
# 未決事項:
#   - 本コマンドを本番のIssueブランチに対して実地起動する検証は行っていない。実地起動は
#     root成果物を削除しcommit・pushするため、本検証セグメントの成果物である本ファイル自身を
#     消す。統合テストが一時リポジトリ上で同じ経路を実行しており、実地起動はPRをReadyへ移す
#     直前に進行役が行う運用上の手順である。

schema_version: agent-skill-chain/validation-report/v1
issue_id: ISSUE-798
target_sha: 3c7149eab1bd7bd8b481f7a8073563669fa7985b

acceptance_criteria:
  - ac_id: AC-1
    verification: {mode: automated, result: pass}
    evidence:
      - "test/unit/roles.test.ts: 'loadRoles (AC-1): root_artifact_cleanup_worker が scope 限定の書込みロールとして定義されている'"
      - "test/unit/roles.test.ts: 'loadRoles: role_contracts に全必須ロールが存在する' / 'loadRoles: 各 role_contract は inputs/outputs/rules/completion/forbidden を持つ'"
      - "独立確認: .agent-skill-chain/config/roles.yaml を直接読み、roles: 配下に root_artifact_cleanup_worker（lease: writer、scope: root_artifacts_only、capabilities は lease.acquire/renew/release と branch.commit/branch.push のみ、forbidden に out_of_scope.change と root_artifact.content_edit）が、role_contracts: 配下に同名の inputs/outputs/rules/completion/forbidden が、既存の adr_finalization_worker と同構造で存在することを確認した"
      - "local-test-run: npm test @ 3c7149ea（tests 1638 / pass 1637 / fail 0 / skipped 1 / 終了コード0）"

  - ac_id: AC-2
    verification: {mode: automated, result: pass}
    evidence:
      - "test/integration/root-cleanup-branch.test.ts: 'root-cleanup branch (AC-2): 引数がissue_id 1個以外のときは使い方エラーで非ゼロ終了する'"
      - "test/integration/root-cleanup-branch.test.ts: 'root-cleanup branch (AC-2): 標準入力を与えても結果が変わらない（内容入力経路を持たない）'"
      - "test/unit/root-cleanup-branch-closure.test.ts: 'AC-2 (D13): 本コマンドの推移的import閉包に、アダプタ・ワーカー・レビュアの起動実装が現れない' / 'AC-2: 本コマンドは標準入力を読む経路を持たない'"
      - "独立確認: src/commands/root-cleanup-branch.ts が args.length !== 1 を CliError で拒否し、可変部が parseIssueId で [0-9]+ へ限定された Issue 番号だけの固定commitメッセージ定数を用いることを直接読んで確認した"
      - "独立確認: src/commands/root-cleanup-branch.ts・src/lib/root-artifact-state.ts・.agent-skill-chain/scripts/root-cleanup-branch.sh を process.stdin / readFileSync(0 / /dev/stdin / readSync(0 で走査し、標準入力の読み取り経路が1件も無いことを確認した"
      - "local-test-run: npm test @ 3c7149ea（tests 1638 / pass 1637 / fail 0 / skipped 1 / 終了コード0）"

  - ac_id: AC-3
    verification: {mode: automated, result: pass}
    evidence:
      - "test/integration/root-cleanup-branch.test.ts: 'root-cleanup branch (AC-3/AC-9): 削除のみのcommitを作りpushし、SHAを出力して終了コード0'"
      - "test/integration/root-cleanup-branch.test.ts: 'root-cleanup branch (AC-3境界): 起動時点で作業ツリーから消えていてもno-opにならない'"
      - "test/unit/root-artifact-state.test.ts: '作業ツリー上に存在し HEAD と一致するものは削除対象になる' / 'index へ未記録の削除（作業ツリーから消えているだけ）は削除対象になる' / 'index へ記録済みの削除（HEADにのみ残る）は削除対象になり、index 不在として扱われる'"
      - "独立確認: src/commands/root-cleanup-branch.ts の commit 直前段が index と HEAD の差分を再取得し、全エントリが削除であること・削除対象集合と完全一致することの2点を満たさなければ commit しない構造であることを直接読んで確認した"
      - "local-test-run: npm test @ 3c7149ea（tests 1638 / pass 1637 / fail 0 / skipped 1 / 終了コード0）"

  - ac_id: AC-4
    verification: {mode: automated, result: pass}
    evidence:
      - "test/integration/root-cleanup-branch.test.ts: 'root-cleanup branch (AC-4): 対象4ファイル以外がindexへ記録されているときはcommitせず停止する'"
      - "独立確認: src/commands/root-cleanup-branch.ts の index スコープ検査が、削除ステージングより前に git diff --cached --name-only HEAD の結果から対象4ファイルを除いたパスを列挙し、1件でもあれば worktree・index を変更せず日本語診断とともに非ゼロ終了する順序であることを直接読んで確認した"
      - "local-test-run: npm test @ 3c7149ea（tests 1638 / pass 1637 / fail 0 / skipped 1 / 終了コード0）"

  - ac_id: AC-5
    verification: {mode: automated, result: pass}
    evidence:
      - "test/integration/root-cleanup-branch.test.ts: 'root-cleanup branch (AC-5): 対象4ファイルが全て不在のときだけcommitもpushもせず終了コード0'"
      - "test/unit/root-artifact-state.test.ts: 'どこにも存在しないものは不在になる' / '分類は常に対象4ファイルちょうどを、相互排他な1区分ずつで返す'"
      - "独立確認: src/commands/root-cleanup-branch.ts で no-op 経路（削除対象0件）も remote 同期・事後条件検査の無条件段を必ず通り、作業ツリーに1件も無くとも HEAD の tree に残存があれば終了コード0を返さない構造であることを直接読んで確認した。AC-5 の境界（作業ツリー不在かつ HEAD 存在）は削除対象へ分類され AC-3 経路をとる"
      - "local-test-run: npm test @ 3c7149ea（tests 1638 / pass 1637 / fail 0 / skipped 1 / 終了コード0）"

  - ac_id: AC-6
    verification: {mode: automated, result: pass}
    evidence:
      - "test/integration/root-cleanup-branch.test.ts: 'root-cleanup branch (AC-6): 内容が変更された対象ファイルがあるときは削除せず停止する' / 'root-cleanup branch (AC-6): 未追跡の対象ファイルがあるときは削除せず停止する'"
      - "test/unit/root-artifact-state.test.ts: '未追跡ファイルとして存在するものは内容喪失リスクありになる' / 'HEAD に存在せず index にのみ存在する（新規記録済み）ものは内容喪失リスクありになる' / 'index の内容が HEAD と異なるものは内容喪失リスクありになる' / 'index の file mode が HEAD と異なるものは内容喪失リスクありになる' / '作業ツリーの内容変更・型変更は内容喪失リスクありになる' / '未マージエントリは内容喪失リスクありになる' / '解釈できない git 出力は対象4ファイルすべてを内容喪失リスクありへ倒す'"
      - "独立確認: src/lib/root-artifact-state.ts の決定表が、解釈できない git 出力・未マージ・非blob・blob OID差・file mode差をすべて content_loss_risk へ倒す一方、追跡済みファイルの未ステージ削除・ステージ済み削除は deletable へ落とすことを直接読んで確認した。停止判定は no-op 判定より前段にある"
      - "local-test-run: npm test @ 3c7149ea（tests 1638 / pass 1637 / fail 0 / skipped 1 / 終了コード0）"

  - ac_id: AC-7
    verification: {mode: automated, result: pass}
    evidence:
      - "test/integration/root-cleanup-branch.test.ts: 'root-cleanup branch (AC-7): 対象外パスの未記録の変更・未追跡ファイルを巻き込まず実行後も保持する'"
      - "独立確認: src/commands/root-cleanup-branch.ts の削除ステージングが --literal-pathspecs 付きで対象4ファイルのリテラルのみを pathspec に与える git rm であり、対象外パスを構造的に巻き込めないことを直接読んで確認した"
      - "local-test-run: npm test @ 3c7149ea（tests 1638 / pass 1637 / fail 0 / skipped 1 / 終了コード0）"

  - ac_id: AC-8
    verification: {mode: automated, result: pass}
    evidence:
      - "test/integration/root-cleanup-branch.test.ts (a): 'root-cleanup branch (AC-8a): 対象worktreeが既定ブランチをチェックアウトしている場合は拒否する' / '(AC-8a): detached HEADの対象worktreeでは実行しない' / '(AC-8a): remote先頭が存在しないときはcommitもpushもせず停止する' / '(AC-8a): remoteが先行している場合はcommitもpushもせず停止する' / '(AC-8a): 対象外の未pushcommitがあるときはcommitもpushもせず停止する'"
      - "test/integration/root-cleanup-branch.test.ts (b): 'root-cleanup branch (AC-8b, ローカルモード): 他segmentの有効leaseがあれば削除・commit・pushせず停止する' / '(AC-8b, ローカルモード): 期限切れleaseでも停止し、回収しない' / '(AC-8b, GitHubモード): 他segmentの有効leaseがあれば停止する' / '(AC-8b, GitHubモード): 取得直後の再走査で他leaseを検出したら自leaseを解放して譲る'"
      - "test/integration/cleanup-lease-scan.test.ts: 'AC-8 (D11): cleanup は新segment root_artifact_cleanup の有効leaseを検出して削除を拒否する' / 'AC-8 (D11): cleanup は既存segmentの有効leaseも従来どおり検出する' / 'AC-8 (D11): 期限切れleaseは cleanup の停止理由にならない（既存挙動を緩めも強めもしない）'"
      - "独立確認: src/commands/root-cleanup-branch.ts の lease 判定が segment を列挙せず Issue 番号 prefix の ref 走査で行われ、1件でも検出すれば取得を試みずに保持者・segment・失効時刻を提示して停止すること、および src/commands/cleanup.ts の有効lease探索が segment名5件の直書き列挙から activeLeasesFor(issueNumber) へ置換されていることを直接読んで確認した"
      - "local-test-run: npm test @ 3c7149ea（tests 1638 / pass 1637 / fail 0 / skipped 1 / 終了コード0）"

  - ac_id: AC-9
    verification: {mode: automated, result: pass}
    evidence:
      - "test/integration/root-cleanup-branch.test.ts: 'root-cleanup branch (AC-3/AC-9): 削除のみのcommitを作りpushし、SHAを出力して終了コード0'"
      - "test/integration/root-cleanup-branch.test.ts: 'root-cleanup branch (AC-9): push失敗は非ゼロ終了し、ローカルだけがcleanな状態で0を返さない'"
      - "独立確認: 既存の残存検査 verify root-clean は repoRoot 直下の対象4ファイルの存在のみを見る実装である（src/commands/verify.ts の rootClean）。本コマンドの終了コード0直前の事後条件検査は remote 先頭の tree・local HEAD の tree・作業ツリーの3点を見るため、verify root-clean が見る集合を包含する。したがって終了コード0は削除経路・no-op経路のいずれでも verify root-clean の成功を含意する"
      - "local-test-run: npm test @ 3c7149ea（tests 1638 / pass 1637 / fail 0 / skipped 1 / 終了コード0）"

  - ac_id: AC-10
    verification: {mode: automated, result: pass}
    evidence:
      - "test/integration/worker-allowlist.test.ts: 'AC-10: ci/ 配下の実行が scripts/ 配下と同じ2表記で許可されている' / 'AC-10: ファイル削除系のコマンドと無制限自動承認は列挙されていない' / 'AC-10: 削除系を意図的に列挙しない理由が列挙の近傍に記述されている'"
      - "test/integration/root-cleanup-branch.test.ts: 'root-cleanup branch (AC-8b/AC-10): ワーカーがlease保持中にラッパーを起動しても削除は成立しない'"
      - "独立確認: .agent-skill-chain/adapters/claude.sh の WORKER_ALLOWED_TOOLS_DEFAULT を直接読み、Bash(.agent-skill-chain/ci/*) と Bash(bash .agent-skill-chain/ci/*) が scripts/ 側と同じ2表記で加わっていることを確認した。同定義行を Bash\\((rm|git rm|find|git update-index)[^)]*\\) で走査した結果は0件であり、bypassPermissions は既定に用いない旨のコメント3箇所のみで既定指定としては現れない"
      - "local-test-run: npm test @ 3c7149ea（tests 1638 / pass 1637 / fail 0 / skipped 1 / 終了コード0）"

  - ac_id: AC-11
    verification: {mode: automated, result: pass}
    evidence:
      - "test/integration/worker-allowlist.test.ts: 'AC-11: 既存の事後清掃自動化・root残存検査のラッパーが同じサブコマンドへ委譲し続ける' / 'AC-11: 既存の事後清掃自動化・root残存検査の実装が新設モジュールへ依存しない'"
      - "独立確認（着手前基点の同定）: 本Issue着手前の基点は既定ブランチ main の先頭 1c6c3cdc3a3ba7924779fdaff7dda8aba9cd7d5d である。git merge-base main HEAD の出力が同SHAであり、本ブランチの全commit（spec 2件・merge 1件・design 2件・implementation 1件・validation 1件の計7件）はこの基点以降に積まれている。git rev-parse origin/main も同一SHAを返す"
      - "独立確認（着手前基点との累積差分・AC-11の主証跡）: 実行コマンドは git diff --stat 1c6c3cdc3a3ba7924779fdaff7dda8aba9cd7d5d...a72e5513af4f166131ef7db46af8ef27a6334e96 -- src/commands/root-cleanup.ts src/commands/verify.ts src/lib/root-artifacts.ts src/commands/lease.ts .agent-skill-chain/scripts/root-cleanup.sh .agent-skill-chain/ci/verify-root-clean.sh である。標準出力は空、終了コード0。--stat を --name-status へ置換した同一実行も標準出力は空・終了コード0であった。三点差分は単一commitの差分ではなく基点からゲート対象SHAまでの累積結果を示すため、PLAN.md が許す複数commitへの分割で積み上げられた場合も含めて、対象6パスに変更が無いことを判定できる。比較の技法は src/commands/verify.ts の checkOutputExists が用いる base と HEAD の三点差分と同型である"
      - "独立確認（上記が空振りでないことの確認）: 同一の commit 対・同一のオプションのまま、pathspec へ既知の変更パス src/commands/cleanup.ts を1件だけ加えて再実行すると、出力は M とタブ区切りで src/commands/cleanup.ts を示す1行・終了コード0となる。したがって対象6パスでの空の出力は、pathspec が何にも一致しなかったことによる空振りではなく、当該6パスに差分が存在しないことを示す"
      - "独立確認（対象6パスの実在）: 6パスはいずれもゲート対象SHAの作業ツリーに実在する（ls -l で6件すべてのサイズ・モードを確認。作業ツリーは git status --short が空でHEADと一致する）。かつ上記 --name-status の出力に追加を示す A エントリが1件も無いため、6パスは基点 1c6c3cdc の時点でも同一内容で存在していた"
      - "上記により、既存の事後清掃自動化（root-cleanup）・root残存検査（verify root-clean）・lease acquire の実装は、本Issue着手前の基点からゲート対象SHAまでの全commitを通じて1行も変わっていない"
      - "回帰: 既存テストは期待値を変更せずに成功している。全量実行の fail は0件であり、既存の verify-root-clean 関連テスト（'verify-root-clean (merge-ready)' ステップの存在・if条件・配置順を検査する6件）も pass した"
      - "local-test-run: npm test @ 3c7149ea（tests 1638 / pass 1637 / fail 0 / skipped 1 / 終了コード0）"

  - ac_id: AC-12
    verification: {mode: automated, result: pass}
    evidence:
      - "test/unit/roles.test.ts: 'loadRoles (AC-12): 進行役の forbidden が不変で、新ロールに著述・内容編集能力が無い'"
      - "独立確認: git show 3c7149ea -- .agent-skill-chain/config/roles.yaml の差分が root_artifact_cleanup_worker の追加2ブロックのみで構成され、進行役のロール定義には1行の変更も無いことを確認した。新ロールの capabilities は lease.acquire・lease.renew・lease.release・branch.commit・branch.push の5件のみで、成果物の著述・内容編集に相当する能力を含まない"
      - "独立確認: 本コマンドは対象Issueの識別子1個以外の入力経路を持たないため、進行役が本コマンドを経由して成果物を著述する経路が構造的に存在しない（AC-2の独立確認と同一の根拠）"
      - "local-test-run: npm test @ 3c7149ea（tests 1638 / pass 1637 / fail 0 / skipped 1 / 終了コード0）"

regression:
  executed: true
  evidence:
    - "local-test-run: npm test @ 3c7149eab1bd7bd8b481f7a8073563669fa7985b。実測 tests 1638 / suites 0 / pass 1637 / fail 0 / cancelled 0 / skipped 1 / todo 0 / duration_ms 745128.763492、終了コード0"
    - "型検査・ビルド: npm test の pretest が npm run build（tsc）を実行し成功。単独実行でも終了コード0"
    - "機械検査（いずれも前景実行・終了コード0）: .agent-skill-chain/ci/verify-doc-length.sh / .agent-skill-chain/ci/verify-template-sync.sh / .agent-skill-chain/ci/verify-config-doc-sync.sh / .agent-skill-chain/scripts/lint-references.sh / .agent-skill-chain/scripts/lint-vocab.sh / .agent-skill-chain/scripts/adr-lint.sh check"
    - "AC対応・スキーマ適合の機械検査: .agent-skill-chain/ci/verify-ac-coverage.sh ISSUE-798 を前景で実行した。標準出力・標準エラーとも空、終了コード0。PLAN.md は本検査を設計セグメントでは実行できない（VALIDATION.md が独立検証セグメントの成果物であるため）として独立検証セグメントへ割り当てており、本セグメントで実行した。同スクリプトは agent-skill-chain CLI の verify ac-coverage サブコマンドへの薄いラッパーであり、SPEC.md の全 AC-ID に検証方法と証跡が対応していること（孤児AC・孤児テスト参照の不在）と、本ファイルの validation-report スキーマ適合を機械判定する"
    - "上記が無条件成功でないことの確認: 同じスクリプトへ実在しない ISSUE-999999 を与えると、ISSUE-999999 の worktree が見つかりません と出力して終了コード1で停止する。したがって ISSUE-798 での終了コード0は、検査が実行された上での成功である"
    - "既存挙動の非回帰: 既存の事後清掃自動化・root残存検査・lease acquire の実装6パスに、本Issue着手前の基点 1c6c3cdc3a3ba7924779fdaff7dda8aba9cd7d5d からゲート対象SHA a72e5513af4f166131ef7db46af8ef27a6334e96 までの累積差分（三点差分・pathspec限定）が無いこと（標準出力が空・終了コード0。詳細と空振りでないことの確認は AC-11 の evidence に記載）と、それらの既存テストが期待値変更なしに成功したこと"
