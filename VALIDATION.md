# 正本: AGENTS.md §不変条件I7
#
# Issue #221: lint-references.sh が .github/workflows/ を検査対象外にしており、
# 実デプロイ済みワークフローの § 参照違反を検出できていなかった問題の独立検証報告。
# 検証者は実装ワーカーとは別人格（validation-worker）であり、実装ワーカーの報告を
# 転記せず、npm run build 実施後に自分でコマンドを再実行して確認した。
#
# フィールドは .agent-skill-chain/schemas/validation-report.schema.yaml
# （agent-skill-chain/validation-report/v1）と完全一致させている。

schema_version: agent-skill-chain/validation-report/v1
issue_id: ISSUE-221
target_sha: db7522a6a41dae74ccd263fd2deda060fbad9603

acceptance_criteria:
  # AC-1: 是正前に本体ワークフローの違反が再現できる（回帰テスト）
  - ac_id: AC-1
    verification:
      mode: hybrid
      result: pass
      reason: "自動テスト（test/integration/lint.test.ts の該当ケース）は分離tmpリポジトリ上で
        「.github/workflows が対象拡張前は走査されなかった」ことを模した違反検出を確認するに
        とどまるため、Issueで実際に問題となった旧commit内容そのものでの回帰再現は別途手動で
        実施し、双方の証跡を合わせて判定した。"
      procedure: "git log --oneline で commit 系列を確認（eab33ec=SPEC, c660317=DESIGN,
        db7522a=fix）。是正前内容は eab33ec/c660317 の時点（fix commit db7522a の2つ前
        =HEAD~2）に存在することを確認し、git show HEAD~2:.github/workflows/agent-skill-chain-root-cleanup.yml
        をscratchpad配下の一時ファイルへ出力（1行目が是正前表記
        '§不変条件I4・§ディレクトリ構成' であることを確認）。
        node bin/agents-md.js lint references AGENTS.md <一時ファイルのディレクトリ> を実行し、
        禁止参照 '§不変条件I4・§ディレクトリ構成'（見出しテキストで解決できないセクション番号参照）
        が検出され終了コード1になることを確認した。"
      executor: "validation-worker (claude)"
    evidence:
      - "test/integration/lint.test.ts:336 'lint references: path省略時のデフォルト対象は本体 .github/workflows/ を含み、そこに置かれた解決不能な§参照を検出する（Issue #221）' — npm test で pass"
      - "手動再現: git show HEAD~2:.github/workflows/agent-skill-chain-root-cleanup.yml の出力に対する node bin/agents-md.js lint references 実行結果（終了コード1、'禁止参照 §不変条件I4・§ディレクトリ構成' を検出）"

  # AC-2: 是正後に本体・テンプレート正本の両方で lint が成功する
  - ac_id: AC-2
    verification:
      mode: hybrid
      result: pass
      reason: "検証対象のworktree自体がADR-0004設計上の linked worktree であり、
        src/lib/paths.ts の repoRoot() は linked worktree では git の共通(main)ツリー
        （/home/adachi/projects/AGENTS.md）を返す設計になっている（resolveMainWorktreeRoot、
        Issue #185由来の既知挙動、test/unit/scan.test.ts が worktreeRoot() を使う理由として
        明記済み）。そのため cwd をこのworktreeにして引数省略で
        `node bin/agents-md.js lint references` を実行すると、defaultReferenceFileRoots が
        main側の未マージ・旧表記（'§不変条件I4・§ディレクトリ構成'）を含む
        .github/workflows/agent-skill-chain-root-cleanup.yml を拾ってしまい、実際に終了コード1
        となった（実測済み）。これはこのworktreeの実装不備ではなく、main未マージによる
        linked-worktree特有の検証環境上の制約であることを確認したうえで、
        このworktree自身の状態を対象化するために defaultReferenceFileRoots を直接呼び出し、
        得られた絶対パス群を明示指定して検証した（自動テストはこの制約の影響を受けない
        分離tmpリポジトリで実施されているため、上記手動確認と合わせて判定する）。"
      procedure: "1) node --input-type=module -e \"import { defaultReferenceFileRoots } from
        '<worktree>/bin/lib/scan.js'; console.log(JSON.stringify(defaultReferenceFileRoots('<worktree>')))\"
        で、このworktree自身を起点にした走査ルート一覧（AGENTS.md, docs/GLOSSARY.md,
        .agent-skill-chain/{standards,templates,config,schemas,scripts,ci}, src,
        .github/workflows の10エントリ、全て絶対パス）を取得。
        2) 取得した絶対パス群をそのまま node bin/agents-md.js lint references の引数として渡し実行。
        終了コード0・違反出力なしを確認した（これは本体 .github/workflows/agent-skill-chain-root-cleanup.yml
        と .agent-skill-chain/templates 配下のテンプレート正本コピーの両方を含む）。
        3) 参考として、引数省略のデフォルト実行（cwd=このworktree）は repoRoot() の
        linked-worktree挙動により main 側の旧内容を拾って終了コード1になることも別途確認し、
        これがこのworktreeの是正結果とは無関係であることを2)の結果と突き合わせて判定した。"
      executor: "validation-worker (claude)"
    evidence:
      - "手動実行ログ: defaultReferenceFileRoots(<このworktreeの絶対パス>) の返り値10エントリを明示指定した lint references 実行（終了コード0、違反0件）"
      - "diff .github/workflows/agent-skill-chain-root-cleanup.yml .agent-skill-chain/templates/github/.github/workflows/agent-skill-chain-root-cleanup.yml（差分なし、両ファイルとも是正後表記）"
      - "test/unit/scan.test.ts の defaultReferenceFileRoots 関連3ケース（.github/workflows を含む／非存在時は除外／存在時は末尾追加）— npm test で pass"

  # AC-3: verify-template-sync が引き続き成功する
  - ac_id: AC-3
    verification:
      mode: automated
      result: pass
    evidence:
      - "diff .github/workflows/agent-skill-chain-root-cleanup.yml .agent-skill-chain/templates/github/.github/workflows/agent-skill-chain-root-cleanup.yml（終了コード0、差分なし）"
      - "./.agent-skill-chain/ci/verify-template-sync.sh（終了コード0）"

  # AC-4: 走査対象拡張により他ワークフロー YAML で新規違反が発生しない
  - ac_id: AC-4
    verification:
      mode: hybrid
      result: pass
      reason: "AC-2と同一の制約（このworktreeがlinked worktreeであり、引数省略実行では
        repoRoot() がmain共通ツリーを指してしまう）により、他5本の実workflowファイル
        （ci/reconcile/gate/release/risk）についてもこのworktree自身の内容に対する
        ゼロ違反確認は明示パス指定での手動実行が必要だった。"
      procedure: "AC-2の手順2)で実行した defaultReferenceFileRoots(<このworktree>) の
        全絶対パス指定による lint references 実行結果（終了コード0・違反出力なし）には
        .github/workflows 配下の6本（root-cleanup.yml含む）全てが含まれており、
        ci/reconcile/gate/release/risk の5本について新規違反が発生していないことを
        同一実行結果から確認した。"
      executor: "validation-worker (claude)"
    evidence:
      - "手動実行ログ: defaultReferenceFileRoots(<このworktreeの絶対パス>) を明示指定した lint references 実行（終了コード0、.github/workflows/agent-skill-chain-{ci,reconcile,gate,release,risk}.yml を含め違反0件）"

regression:
  executed: true
  evidence:
    - "npm test 実行1回目: 1..508 / tests 508 / pass 508 / fail 0 / duration_ms 211858.99"
    - "npm test 実行2回目: 1..508 / tests 508 / pass 508 / fail 0 / duration_ms 217933.27"
    - "前回セッションで報告された『508〜512件中1件が間欠的に失敗する』flaky疑いは、今回2回の
      フル実行ではいずれも508/508 passで再現せず。本Issueの変更（scan.ts/lint.ts/2本のYAML/
      追加テスト）と無関係な既知課題として扱い、本検証の合否判定には影響させていない。"
    - "./.agent-skill-chain/scripts/lint-vocab.sh（終了コード0、走査対象拡張が vocab 検査へ波及していないことを確認。defaultVocabFileRoots・defaultLiveFileRoots は設計通り不変）"
    - "npm run build（終了コード0、tscエラーなし）"
