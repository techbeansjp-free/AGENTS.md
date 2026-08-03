# 正本: AGENTS.md §不変条件I7
#
# このファイルは Issue 毎に複製して使う雛形である（セグメント: validation、ゲート: validation-gate）。

schema_version: agent-skill-chain/validation-report/v1
issue_id: ISSUE-369
target_sha: 5ae5d5b4bf204cda45a502783c79d4213ff1941c

acceptance_criteria:
  - ac_id: AC-1
    verification:
      mode: automated
      result: pass
    evidence:
      - "src/commands/gate.ts:1820 buildReviewerPrompt()内のgit diff呼び出しに--full-indexを追加済み（core.abbrevの自動伸長機構に一切依存しない完全40桁hex digestを常に出力）"
      - "test/integration/gate-judgment.test.ts:385 'gate reviewer-prompt: 全index行をfull hashで出力し、hash表記以外は修正前goldenと一致する' — 出力中の全index行が40桁未満の省略hashを含まないことをテキストパターン照合で機械検証。実行結果: pass"

  - ac_id: AC-2
    verification:
      mode: automated
      result: pass
    evidence:
      - "test/integration/gate-reviewer-prompt-determinism.test.ts:86 'gate reviewer-prompt: auto abbrevが実際に伸長したcloneでも出力とdigestが完全一致する'（主検証）— 一意な内容のblobを機械的に大量投入し、git rev-parse --shortの既定abbrev桁数がベースラインcloneを上回ること（一意性伸長の実発生）を事前条件アサーションで確認したclone、および追加投入していないベースラインcloneの両方でbuildReviewerPrompt()を実行し、出力バイト列・evidencePromptDigest()の両方が完全一致することを検証。実行結果: pass"
      - "test/integration/gate-reviewer-prompt-determinism.test.ts:123 'gate reviewer-prompt: core.abbrev=7・12・未設定のcloneで出力とdigestが完全一致する'（補助検証）— core.abbrevを異なる値に明示固定した複数cloneでも出力とdigestが一致することを検証。実行結果: pass"

  - ac_id: AC-3
    verification:
      mode: automated
      result: pass
    evidence:
      - "test/integration/gate-evidence.test.ts:375 'gate evidence: reviewer-prompt生成cloneと検証cloneのauto abbrev桁数が異なっても往復に成功する' — 総オブジェクト数が異なる2つの別cloneでreviewer-prompt生成側のgate submit-evidenceと検証側のgate verify-evidenceを分離実行し、'review ${review.id} のprompt digestが一致しません' エラーが発生せずに往復が成功することを検証。実行結果: pass"

  - ac_id: AC-4
    verification:
      mode: automated
      result: pass
    evidence:
      - "test/fixtures/gate-reviewer-prompt-golden.txt — --full-index追加前（PLAN.md変更単位#1、修正前コード）のbuildReviewerPrompt()出力を固定コミットしたgolden snapshot"
      - "test/integration/gate-judgment.test.ts:385 'gate reviewer-prompt: 全index行をfull hashで出力し、hash表記以外は修正前goldenと一致する' — --full-index追加後の出力からindex行のhash桁数表記のみを正規化した文字列が、goldenファイルの同一箇所を同じ正規化にかけた文字列と完全一致することを検証（ルーブリック文言・AC-ID一覧・出力JSON契約・成果物本文が修正前後で不変であることの証跡）。実行結果: pass"
      - "test/integration/gate-judgment.test.ts:367 'gate reviewer-prompt: AC-ID・conformance/falsification ルーブリック・出力 JSON 契約を含む' の継続pass"

regression:
  executed: true
  evidence:
    - "npm test（test/unit + test/integration 全件、688件）— 687件pass・1件fail、2回連続で同一結果を再現の上で確定した。failしたtest/unit/paths.test.ts:39 'repoRoot: .git がどこにも見つからない場合は例外を投げる（AC-2）'は本Issueの変更（buildReviewerPrompt --full-index化）と無関係。当該テストはfs.mkdtempSync(os.tmpdir())配下にfixtureを作りrepoRoot()を呼ぶため、worktreeの祖先ディレクトリは走査経路に含まれない（旧記載の『worktree配下では祖先ディレクトリに.gitが存在するため』は誤りであり、strictレビューの指摘により訂正）。repoRoot(orphan)を本ホストで直接実行し原因を確定: os.tmpdir()が返す/tmpの直下に空の.gitディレクトリ（drwxr-xr-x、中身なし、mtime 2026-08-03 13:17、本Issueおよびagent-skill-chainのいずれのコードにも由来しない共有ホスト側の残留物）が実在し、repoRoot()の祖先探索がorphan→/tmpまで遡った時点でこれを検出して例外を投げずに'/tmp'を返す。テストは『os.tmpdir()がgitリポジトリ外である』という、共有ホストでは常に成立するとは限らない前提に依存しており、本Issueの変更ともtest/unit/paths.test.ts自体の内容とも無関係な、ホスト環境固有の既存flakyである。実行日時: 2026-08-03、実行環境: ローカルworktree。全出力を test-execution.log としてcommitし証跡を耐久化。"
    - "node --import tsx --test test/integration/gate-judgment.test.ts test/integration/gate-reviewer-prompt-determinism.test.ts test/integration/gate-evidence.test.ts — 23件全pass（duration_ms 17876）、AC-1〜AC-4関連テストを含む"
    - "npm run build（tsc） — エラーなし"
    - "npm run typecheck（tsc --noEmit -p tsconfig.test.json） — エラーなし（test/配下の型検査を含む）"
    - "agent-skill-chain verify doc-length — pass（AGENTS.md 150行・各テンプレート100行の文書量上限を維持）"

test_applicability:
  - category: "API・サービス境界"
    applicable: false
    reason: "本Issueの変更はGitHub Actionsワークフロー内で実行されるgit diffコマンドライン引数の変更のみであり、HTTPサービス境界・APIエンドポイントの追加/変更を伴わない"
  - category: "認証・認可・秘密情報"
    applicable: false
    reason: "認証情報・secretの取り扱いに変更なし。--full-indexはgit blob内容のhash表現形式のみに影響する"
  - category: "性能"
    applicable: false
    reason: "--full-indexはdiff出力中のhash桁数を伸長するのみで、計算量・実行時間へ実質的な影響を与えない（AC-1〜AC-3のテストで実測差分なしを確認済み）"
  - category: "DBマイグレーション"
    applicable: false
    reason: "データベーススキーマ・永続化データへの変更を伴わない"
  - category: "後方互換性"
    applicable: true
    reason: "AC-1・AC-4でgolden snapshotとの完全一致（ルーブリック文言・AC-ID一覧・出力JSON契約・成果物本文が不変）を検証済み"
  - category: "secretスキャン"
    applicable: true
    reason: "CI（agent-skill-chain / ci）が機械的に実行。本PRの変更差分に新規secretの混入なし"
  - category: "依存関係スキャン"
    applicable: true
    reason: "CI（agent-skill-chain / ci）が機械的に実行。本Issueはpackage.json/package-lock.jsonを変更しない"
