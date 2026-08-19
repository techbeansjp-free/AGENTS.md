# VALIDATION: gate-local-review の信頼 clone が consumer project のビルド成功を前提とし、
#             ローカルゲートレビューを実行できない（ISSUE-759 / 独立検証セグメント）
#
# 由来: AGENTS.md 不変条件I7（仕様⇔検証の追跡）。形式は
# .agent-skill-chain/schemas/validation-report.schema.yaml（agent-skill-chain/validation-report/v1）。
# 本ファイルは verify ac-coverage が単一のYAML文書として読み込むため、純粋なYAMLで記述し、
# 散文はコメントで表現する（Markdown見出し・コードフェンスを混在させない）。
#
# ============================================================================
# 目的
# ============================================================================
# 本成果物は、ISSUE-759 の受入条件 AC-1 から AC-16 のそれぞれについて、検証方法と検証証跡を
# 一意に対応づけ、その実行結果を記録する。あわせて回帰の有無を全件テストの実行結果で示す。
# 判定は本ファイルの記載と、ここで指名する自動テストの実行結果のみで完結する。
#
# 対象範囲
# --------
# 対象は、ローカルゲートレビューの準備段が consumer project 固有のビルド構成・ビルド成否・
# 依存導入成否に依存せずレビュア起動段へ到達すること、およびその到達を信頼境界を弱めずに
# 成立させる機構（調達実行コードの由来・完全性の検証、調達候補の採否を決める2つのパス条件、
# launcher digest の算出対象、隔離環境の健全性検査、prompt 生成が読み込む asset の解決基点、
# 実行時依存の解決先の観測）である。
#
# 対象外
# ------
# 実装の是正、SPEC.md・DESIGN.md・PLAN.md・ADR-0077 の変更、要件およびAC-IDの追加。
# 審査対象以外から供給される依存閉包の供給網の完全性（Issue #772 の射程）。
# レビュア起動後の証跡投稿が無言で失敗する事象（Issue #762 の射程）。
#
# ============================================================================
# 検証対象SHA と本成果物の関係（レビュア判定の前提となる不変）
# ============================================================================
# 検証対象の実装SHA: 98ae472976460330997aec30380f6293a5b7889d
#
# 本成果物は、自身を載せるコミットのSHAを内容として持つことができない。したがって本ファイルが
# 宣言する target_sha（検証を実施した実装SHA）と、本ファイルを含むコミットに対して実行される
# ゲートの target_sha は必ず異なる値になる。この差異は欠落や不整合ではなく、独立検証セグメントの
# 成果物が持つ構造的な性質である。
#
# そこで本成果物は次の不変を宣言する。
#
#   本成果物を追加するコミットは、検証対象の実装SHA（98ae472976460330997aec30380f6293a5b7889d）
#   に VALIDATION.md のみを追加した差分であり、実装ファイル・SPEC.md・DESIGN.md・PLAN.md・
#   docs/adr/ 配下を一切変更しない。
#
# この不変が成立する限り、本ファイルに記録した検証結果は、ゲートが対象とするコミットの実装内容に
# 対してそのまま妥当である。根拠となる実測出力は regression.evidence へ原文のまま収めた
# （コマンド行に続けて標準出力をそのまま置いた。前置き記号による加工をしていない）。
#
# 判定に用いる決定的な出力は次の1件である。VALIDATION.md をindexへ加えた状態で、検証対象SHAと
# 作業ツリーの差分から VALIDATION.md を除外すると、差分は0件になる。すなわち VALIDATION.md 以外の
# いかなるパスも変更されていない。この性質は本ファイル自身の行数に影響されないため、本ファイルを
# 編集しても成立し続ける。
#
# 本成果物のコミット後の状態: 検証対象SHAからHEADまでのコミットはちょうど1件（本成果物の追加）で
# あり、その差分に含まれるパスは VALIDATION.md のみである。
#
# ============================================================================
# 実行環境と実行方法
# ============================================================================
# 実行は本Issueのworktree（ブランチ bugfix/759-trusted-clone-build-prerequisite、
# HEAD 98ae472976460330997aec30380f6293a5b7889d、upstream と ahead/behind ともに0）で行った。
# 進行役が default branch の main（74ae980d0c9627a2f81fcd16fc6bc6d940a34764）を取り込み済みの
# 状態である。実行前に npm run build（tsc）を実行し、bin/ 配下のCLI実体を最新の src から再生成した。
#
# 全件テストの実行について（実行環境由来の汚染とその除去）
# ------------------------------------------------------
# 独立検証セグメントは差分種別によらず全件テストを要求する。最初の npm test は8件が失敗した。
# 失敗は8件すべて test/integration/worker-adapters.test.ts の codex launch_worker 系であり、
# 原因は本ブランチの変更ではなく、本ワーカーを起動した実行環境が持ち込んだ環境変数である。
#
# .agent-skill-chain/adapters/claude.sh は launch_worker の起動系を環境変数 WORKER_CMD で
# 上書きできる（`local worker_cmd="${WORKER_CMD:-}"`）。これはテスト用のモック境界であり、
# .agent-skill-chain/adapters/codex.sh も同じ経路を共有する。本ワーカーを claude CLI の
# headless で起動した親プロセスが WORKER_CMD を export しており、その値が npm test の子プロセスへ
# そのまま継承されたため、当該テスト群が用意したモックではなく親プロセスの起動スクリプトが
# 実行され、`ASC_WORKER_ALLOWED_TOOLS: 未割り当ての変数です` で失敗していた。実測値は
# regression.evidence に収めた。
#
# WORKER_CMD と CODEX_WORKER_CMD を取り除いて同一の worktree・同一のHEADで再実行したところ、
# 1477件中1476件成功・0件失敗・1件スキップとなった。したがって当該8件は本ブランチの回帰ではなく、
# 実行環境の汚染である。regression.evidence には汚染前後の両方の実測を収め、汚染された実行を
# 隠していない。
#
# 唯一のスキップは test/integration/cli-resolve.test.ts の
# 「GitHub導入元へ実際に到達してpackage versionを取得できる」であり、環境変数
# ASC_TEST_LIVE_CLI_INSTALL_SOURCE=1 を明示した場合だけ実ネットワークへ接続する意図的な
# オプトインである。本Issueのいずれの受入条件とも対応しない。
#
# ============================================================================
# 検証で発見した事項（実装の是正は行っていない）
# ============================================================================
# 発見1: 全件テストが実行環境の環境変数から隔離されていない。
#   origin: implementation
#   内容: test/integration/worker-adapters.test.ts の codex launch_worker 系テストは、
#     起動系の上書き経路（WORKER_CMD）を実行環境から遮断しない。呼び出し元が当該変数を
#     export している環境では、テストが用意したモックではなく呼び出し元の値が使われ、
#     テストが失敗する。本ブランチが持ち込んだ性質ではなく、default branch にも同じ形で存在する。
#   本Issueとの関係: 射程外である。本Issueの要件・受入条件のいずれもテストの環境隔離を扱わない。
#     進行役の差し戻し判断を待つ。是正するなら別Issueが適切である。
#   影響: 本成果物の判定には影響しない。汚染を除いた実行で全件成功を確認済みである。
#
# 発見2: DESIGN.md の関連ADR節が ADR-0077 を proposed と記述しているが、実際は accepted である。
#   origin: design
#   内容: docs/adr/ADR-0077-procured-candidate-dependency-reference-scope.md の status は
#     accepted であり、DESIGN.md の記述と食い違う。design-gate の両slotと前回の独立検証も
#     同じ事実を指摘している（識別子 ADR0077-STATUS-DESCRIPTION-STALE）。
#   本ラウンドでの扱い: 進行役がマージ直前のラウンドで処理すると決定済みであり、本セグメントでは
#     是正しない。lint adr check は終了コード0であり機械的失敗ではない。
#
# いずれも Issue の目的の阻害・データ喪失・既存挙動の回帰・セキュリティ低下のいずれにも該当しない。
#
# ============================================================================
# 機械的検査の実行結果（いずれも終了コード0）
# ============================================================================
# npm run build（tsc）／ lint references ／ lint vocab ／ lint secrets --diff origin/main ／
# lint adr check ／ verify doc-length ／ verify spec-bdd SPEC.md ／ verify design-diagram DESIGN.md ／
# verify template-sync ／ verify root-clean ／ verify ac-coverage ISSUE-759。
# 実測は regression.evidence に収めた。
#
# ============================================================================
# 検証方法の凡例
# ============================================================================
# 全16件の受入条件は mode: automated である。SPEC.md が全ACについて検証方法見込みを automated と
# 定めており、各ACのGiven/When/Thenが自動テストで構成可能な観測だけで書かれているためである。
# したがって reason / procedure / executor は記載しない（スキーマ上、automated では不要）。
# evidence は「テストファイル」と「そのファイル内のテスト名」の組で指名する。テスト名は実行時の
# 出力に現れる文字列そのものであり、行番号に依存しない。

schema_version: agent-skill-chain/validation-report/v1
issue_id: ISSUE-759
target_sha: 98ae472976460330997aec30380f6293a5b7889d

acceptance_criteria:
  # AC-1: package.json も lockfile も持たない consumer で準備段が成立し、npm 呼び出し記録に
  # `ci --ignore-scripts` と `run build` のいずれも現れない。
  - ac_id: AC-1
    verification: {mode: automated, result: pass}
    evidence:
      - "test/integration/gate-local-review.test.ts: 'gate-local-review: package.jsonもlockfileも持たないconsumerで準備段が成立し証跡が投稿される（AC-1, AC-14）' — npm呼び出し記録に `ci --ignore-scripts` と `run build` のいずれも現れないことと、レビュア起動段への到達・証跡投稿を同時に観測する"

  # AC-2: build script が痕跡ファイルを作成してから非0終了する consumer で、当該 build を起動せず
  # 痕跡ファイルも隔離 clone 内に生じない。
  - ac_id: AC-2
    verification: {mode: automated, result: pass}
    evidence:
      - "test/integration/gate-local-review.test.ts: 'gate-local-review: consumerのbuild scriptを起動せず痕跡も残さないまま証跡が投稿される（AC-2, AC-14）' — npm呼び出し記録に `run build` が現れないことに加え、build script の痕跡ファイルが隔離clone内に存在しないことを観測し、終了コードの握り潰しでの充足を排除する"

  # AC-3: レビュア起動スクリプトと adapter の解決元が Issue worktree ではなく base SHA の隔離 clone
  # であることを実行時の値で確認する。自リポジトリ形状と consumer 形状の双方で観測する。
  - ac_id: AC-3
    verification: {mode: automated, result: pass}
    evidence:
      - "test/integration/gate-local-review.test.ts: 'gate-local-review: 自リポジトリ形状ではclone_build経路で従来どおりbuildし、隔離cloneのremoteが空である（AC-3, AC-4, AC-6, AC-11 / Issue #703 AC-9）' — 実行時トレースの launcher_script・adapters_dir・review_root がいずれも隔離cloneの一時ディレクトリ配下であることを観測する"
      - "test/integration/gate-local-review.test.ts: 'gate-local-review: 隔離clone外の非正規実体は実行されず隔離clone配下の実体だけが実行される（AC-3, AC-10）' — consumer形状でも launcher_script と adapters_dir が隔離clone配下であることを観測する"

  # AC-4: 既存3拒否経路のメッセージが失われておらず、かつ対照（recorder HEAD が default branch 上で
  # trusted base SHA より前進しているだけの状態）は拒否せず証跡を投稿する。
  - ac_id: AC-4
    verification: {mode: automated, result: pass}
    evidence:
      - "test/integration/gate-local-review.test.ts: 'gate-local-review: protected base worktreeがdirtyなら引き続き拒否する（AC-4）' — `protected base worktreeがdirtyです` で非0終了し、隔離cloneのbuildにもレビュア起動にも進まないことを観測する"
      - "test/integration/gate-procurement-evidence.test.ts: 'submit-evidence: trusted base SHAがrecorder HEADから到達不能なら拒否する（AC-4）' — 到達不能なtrusted base SHAの拒否経路を固定する"
      - "test/integration/gate-procurement-evidence.test.ts: 'submit-evidence: Issue worktreeのcandidate recorderからは投稿できない（AC-4）' — `Issue worktreeのcandidate recorderからevidenceを投稿できません` の拒否経路を固定する"
      - "test/integration/gate-submit-evidence-reachability.test.ts: 'gate submit-evidence: recorderの前進を許容しつつ受理条件と入力をtrusted baseへ固定する（Issue #703 AC-1〜AC-7）' — 対照側。recorder HEAD が trusted base SHA より前進しているだけの状態を拒否せず証跡を投稿することを観測し、完全一致を要求する判定への回帰を防ぐ"

  # AC-5: 信頼実行環境を用意できない場合に、レビュアを起動しないまま非0終了し、不成立の前提と
  # 是正手段、および探索した候補の識別子と探索先を全件含む日本語メッセージを出す。
  - ac_id: AC-5
    verification: {mode: automated, result: pass}
    evidence:
      - "test/integration/gate-local-review.test.ts: 'gate-local-review: 供給元が存在しない実行環境では探索した候補と探索先を全件示して非0終了する（AC-5）' — 候補(a)(b)(c) の識別子と探索先が全件出力され、レビュアが起動されず証跡も投稿されないことを観測する"
      - "test/integration/gate-local-review.test.ts: 'gate-local-review: ローカルpackageキャッシュにのみ配布物がある実行環境は供給元なしとして扱う（AC-5）' — キャッシュのみの実行環境が供給元不在として扱われ、キャッシュ構造を候補にしないことを観測する"
      - "test/integration/gate-local-review.test.ts: 'gate-local-review: 導入マーカーがbase SHAに無ければ調達せず是正手段を示して非0終了する（AC-5）' — 期待値の供給元が無い場合の停止と是正手段の提示を観測する"
      - "test/integration/cli-resolve.test.ts: 'ASC_TRUSTED_CLI_ROOT配下に実体が無ければPATHへ落ちず自動導入もせず非0終了する' — 審査対象コードへのフォールバックが起きないことを解決層で固定する"

  # AC-6: 本リポジトリ（agent-skill-chain 自身）での実行が回帰せず、従来どおり base SHA の隔離 clone
  # から解決した CLI と adapter で動作する。
  - ac_id: AC-6
    verification: {mode: automated, result: pass}
    evidence:
      - "test/integration/gate-local-review.test.ts: 'gate-local-review: 自リポジトリ形状ではclone_build経路で従来どおりbuildし、隔離cloneのremoteが空である（AC-3, AC-4, AC-6, AC-11 / Issue #703 AC-9）' — npm呼び出し記録が従来どおり `ci --ignore-scripts` と `run build` の2件であること、共有worktreeのHEAD・remote・内容が変化しないこと、trusted_base が base SHA であることを観測する"

  # AC-7: .agent-skill-chain/project/MODEL_TIER_TABLE.md を持たない consumer 形状で、証跡の execution が
  # trusted_base_sha・launcher_digest・isolation を持つ。
  - ac_id: AC-7
    verification: {mode: automated, result: pass}
    evidence:
      - "test/integration/gate-local-review.test.ts: 'gate-local-review: consumer形状でレビュア起動段へ到達し、調達元と実体digestを含む証跡が投稿される（AC-7, AC-13(i), AC-14）' — 投稿された証跡の execution が trusted_base_sha に当該SHA、launcher_digest に `sha256:` で始まる非空値、isolation に ephemeral_clone を持つことを観測する"
      - "test/integration/gate-launcher-digest.test.ts: 'launcher digest: consumer固有文書の有無・内容で値が変わらず算出も失敗しない（AC-8, AC-7）' — `.agent-skill-chain/project/` 配下の文書を取得できないことを理由に算出が停止しないことを観測する"

  # AC-8: 配布集合の内容が同一で `.agent-skill-chain/project/` 配下の有無・内容だけが異なる2状態で
  # launcher digest が一致し、いずれでも算出が失敗しない。
  - ac_id: AC-8
    verification: {mode: automated, result: pass}
    evidence:
      - "test/integration/gate-launcher-digest.test.ts: 'launcher digest: consumer固有文書の有無・内容で値が変わらず算出も失敗しない（AC-8, AC-7）' — 2状態の digest 値の一致と、両状態での算出成功を観測する"
      - "test/integration/gate-launcher-digest.test.ts: 'launcher digest: 算出対象は配布集合の10要素であり .agent-skill-chain/project/ を含まない' — 算出対象の固定列挙が配布集合の上限の内側にあることを固定する"

  # AC-9: consumer 自身の依存導入が必ず失敗する構成でも、その終了コードが準備段の成否条件にならない。
  - ac_id: AC-9
    verification: {mode: automated, result: pass}
    evidence:
      - "test/integration/gate-local-review.test.ts: 'gate-local-review: consumerの依存導入が必ず失敗する構成でも証跡投稿まで到達する（AC-9, AC-14）' — 依存導入が失敗する構成でレビュア起動段への到達と証跡投稿を観測する"

  # AC-10: prompt 生成・verdict 記録に使う CLI の実体パスが隔離 clone 配下にあり、用意した隔離 clone 外の
  # 2実体（依存ディレクトリ配下・PATH上）はいずれも実行されない。
  - ac_id: AC-10
    verification: {mode: automated, result: pass}
    evidence:
      - "test/integration/gate-local-review.test.ts: 'gate-local-review: 隔離clone外の非正規実体は実行されず隔離clone配下の実体だけが実行される（AC-3, AC-10）' — 実行されたCLI実体のパスが隔離clone配下であること、外部2実体のトレースが空であることを観測する"
      - "test/integration/cli-resolve.test.ts: 'ASC_TRUSTED_CLI_ROOT指定時は隔離clone配下のbin/agents-md.jsを最優先で解決する' — 信頼実行の文脈での解決先の限定を固定する"
      - "test/integration/cli-resolve.test.ts: 'ASC_TRUSTED_CLI_ROOT配下に実体が無ければPATHへ落ちず自動導入もせず非0終了する' — 隔離clone内に実体を用意できない場合に外部実体へ落ちず停止することを固定する"

  # AC-11: 隔離 clone に登録された remote が1件も存在しない（remote の不在そのものを積極的に検査する）。
  - ac_id: AC-11
    verification: {mode: automated, result: pass}
    evidence:
      - "test/integration/gate-local-review.test.ts: 'gate-local-review: 自リポジトリ形状ではclone_build経路で従来どおりbuildし、隔離cloneのremoteが空である（AC-3, AC-4, AC-6, AC-11 / Issue #703 AC-9）' — 実行時トレースの remotes 欄が空であることを観測し、削除処理の存在ではなく不在という状態を検査対象にする"

  # AC-12: 要件6 が下限として定めた算出対象要素のいずれか1件が trusted base SHA で取得できない場合、
  # 部分集合で算出せず非0終了し、取得できなかった要素を日本語で示す。
  - ac_id: AC-12
    verification: {mode: automated, result: pass}
    evidence:
      - "test/integration/gate-launcher-digest.test.ts: 'launcher digest: 算出対象の要素が1件でも欠けると部分集合で算出せず欠落要素を示して失敗する（AC-12）' — 算出対象10要素のそれぞれについて、その要素だけを欠いた状態で停止することと、欠落要素が示されることを観測する"

  # AC-13: 調達実行コードの由来と完全性が検証され、調達元識別子と実体digestが新規投稿の証跡へ記録される。
  # (i) 正規実体での到達と記録、(ii) 1バイト改変での非0終了と証跡非投稿。
  - ac_id: AC-13
    verification: {mode: automated, result: pass}
    evidence:
      - "test/integration/gate-local-review.test.ts: 'gate-local-review: consumer形状でレビュア起動段へ到達し、調達元と実体digestを含む証跡が投稿される（AC-7, AC-13(i), AC-14）' — (i) 証跡の execution.procurement に調達元識別子と実体digestが非空値で記録されることを観測する"
      - "test/integration/gate-local-review.test.ts: 'gate-local-review: 調達元の実体を1バイト改変するとレビュアを起動せず証跡も投稿しない（AC-13(ii)）' — (ii) 完全性検証の失敗で停止し、レビュア起動も証跡投稿も行われないことを観測する"
      - "test/integration/gate-procurement-evidence.test.ts: 'submit-evidence: 調達情報を欠くlauncher tokenでは証跡を新規投稿できない（要件7(c), AC-13）' — 新規投稿における記録の必須性を記録経路の側で固定する"
      - "test/integration/gate-procurement-evidence.test.ts: 'submit-evidence: 新規に投稿される証跡には必ず調達元識別子が非空値で記録される（要件7(c), AC-13(i)）' — 新規投稿の証跡が調達元識別子を必ず持つことを固定する"
      - "test/unit/review-evidence.test.ts: 'procurement: 導入前の投稿済み証跡は受理し、記録済みは形式検査したうえでattempt内一致を要求する' — 本機構の導入より前に投稿済みの証跡を形式不適合にしない境界（AC-13 が明示的に不充足として扱わない範囲）を固定する"
      - "test/unit/tree-digest.test.ts: 正準ツリーdigestの6件（CLI実装と準備段実装の同値、実行ビット・内容・相対パスの変化の検出、配置場所と時刻への非依存、走査根直下の node_modules と .git のエントリ自体を含めた除外、対象範囲内のsymbolic linkでの算出中止、実配布物での両実装一致） — 完全性検証の基礎となるdigestの性質を固定する"
      - "test/unit/trusted-cli-marker.test.ts: 導入マーカーの5件（配布集合の外への配置、name・version・正準ツリーdigestの記録、dry-runでの非書き出し、期待値を算出できない実行元での既存マーカー非上書き、形式検査） — 要件7(b) の期待値の供給元を固定する"

  # AC-14: AC-1・AC-2・AC-9 が定める3構成のそれぞれで、信頼実行コード一式を隔離clone配下へ実際に用意した
  # うえでレビュア起動段へ到達し、verdict が証跡へ投稿される。事前条件を持たない下限の受入条件である。
  - ac_id: AC-14
    verification: {mode: automated, result: pass}
    evidence:
      - "test/integration/gate-local-review.test.ts: 'gate-local-review: package.jsonもlockfileも持たないconsumerで準備段が成立し証跡が投稿される（AC-1, AC-14）' — 構成1（package.json も lockfile も持たない）でのレビュア起動段への到達と証跡投稿を観測する"
      - "test/integration/gate-local-review.test.ts: 'gate-local-review: consumerのbuild scriptを起動せず痕跡も残さないまま証跡が投稿される（AC-2, AC-14）' — 構成2（build script が痕跡ファイルを作成してから非0終了する）での到達と証跡投稿を観測する"
      - "test/integration/gate-local-review.test.ts: 'gate-local-review: consumerの依存導入が必ず失敗する構成でも証跡投稿まで到達する（AC-9, AC-14）' — 構成3（依存導入が必ず失敗する）での到達と証跡投稿を観測する"
      - "test/integration/gate-local-review.test.ts: 'gate-local-review: PATH上の実体からも調達でき、node_modules/をtrackしないconsumerで隔離cloneがdirtyにならない（AC-14）' — 実行コード実体がPATH上にある供給形態でも到達することを観測する"
      - "test/integration/gate-local-review.test.ts: 'gate-local-review: consumer形状でレビュア起動段へ到達し、調達元と実体digestを含む証跡が投稿される（AC-7, AC-13(i), AC-14）' — 信頼実行コード一式を隔離clone配下へ用意したうえでの到達と証跡投稿を観測する"

  # AC-15: prompt 生成が読み込む asset の解決元が審査対象でない。連言の第1項（解決された各assetのパスが
  # Issue worktree 配下でない）と第2項（生成された prompt に審査対象側の改変内容が現れない）の双方。
  - ac_id: AC-15
    verification: {mode: automated, result: pass}
    evidence:
      - "test/integration/gate-local-review.test.ts: 'gate-local-review: 実生成したpromptとその読み込みassetの解決元が審査対象でない（AC-15）' — Issue worktree を linked worktree として登録し同一相対パスへ識別可能な改変assetを置いた状態で、本番経路のprompt生成を実際に駆動する。asset観測点が記録した解決済みパスがいずれもIssue worktree配下でないこと（第1項）と、生成されたprompt本文に改変内容が現れないこと（第2項）を観測し、証跡のprompt digestが固定文字列ではなく生成されたprompt本文由来であることも確認する"

  # AC-16: 審査対象の依存実体が実行時に解決されない。Given が必須とする2状態、すなわち (i) 依存を
  # Issue worktree 配下でない実体から解決する状態と、(ii) 供給元に置いた参照経路を Issue worktree 配下の
  # 悪意ある依存実体へ向けた状態の双方で観測する。
  - ac_id: AC-16
    verification: {mode: automated, result: pass}
    evidence:
      - "test/integration/gate-local-review.test.ts: 'gate-local-review: 審査対象の依存実体は参照経路の解決後まで照合して実行時に解決させない（AC-16）' — 2状態を1つのテストで構成する。(i) では linked worktree 外の候補でレビュア起動段へ到達し、依存観測点が記録した各実体パスがいずれもIssue worktree配下でないこと、隔離cloneから作られた参照経路がいずれもIssue worktreeを指さないことを観測する。(ii) では当該候補も採用されず非0終了することを観測する。(i)(ii) で候補の正準ツリーdigestが一致することを先に実測し、digest照合だけでは検出できない経路であることを固定する"
      - "test/integration/cli-resolve.test.ts: '要件7(d)第二条件: 供給元2か所の自身・直下エントリ・スコープ直下を照合し、候補自身は重ねない' — 照合対象の集合を固定する"
      - "test/integration/cli-resolve.test.ts: '要件7(d)第二条件: 解決後の実体パスが審査対象のlinked worktree配下なら候補を除外する' — 参照経路を解決した後の実体パスによる除外を固定する"
      - "test/integration/cli-resolve.test.ts: '要件7(d)第二条件: スコープ名ディレクトリ直下の参照経路も照合する' — スコープ名ディレクトリ配下の照合範囲を固定する"
      - "test/integration/cli-resolve.test.ts: '要件7(d)第二条件: 解決できない参照経路は安全側へ倒して候補を除外する' — 解決できない参照経路での安全側の停止を固定する"
      - "test/integration/cli-resolve.test.ts: '要件7(d): 候補の実体パスと依存の参照先はいずれも同一の判定関数で照合する' — 判定規則を候補用と依存用に分けないことを固定する"
      - "test/unit/dependency-trace.test.ts: 実行時依存の解決先の観測点4件（未設定時の無出力、参照経路を全て解決した実体パスの追記、解決できない指定のunresolved記録、追記失敗時の非例外） — 観測が判定の入力にならない境界を固定する"

regression:
  executed: true
  evidence:
    # ---- 全件テスト（実行環境の汚染を取り除いた実行。これが本セグメントの回帰判定の正本） ----
    - |
      $ npm test
      ℹ tests 1477
      ℹ suites 0
      ℹ pass 1476
      ℹ fail 0
      ℹ cancelled 0
      ℹ skipped 1
      ℹ todo 0
      ℹ duration_ms 404325.41511
      EXIT=0
    # ---- 唯一のスキップ（意図的なオプトイン。本Issueのいずれの受入条件とも対応しない） ----
    - |
      ﹣ GitHub導入元へ実際に到達してpackage versionを取得できる (0.268409ms) # ASC_TEST_LIVE_CLI_INSTALL_SOURCE=1 が指定された場合だけlive到達性を確認する
    # ---- 汚染された最初の実行（隠さず記録する。8件失敗はすべて実行環境由来） ----
    - |
      $ npm test   # 本ワーカーの起動環境が export した WORKER_CMD を継承したままの実行
      ℹ tests 1477
      ℹ pass 1468
      ℹ fail 8
      失敗8件はすべて test/integration/worker-adapters.test.ts の codex launch_worker 系。
      共通の失敗出力:
      /tmp/claude-1000/-home-tatsuru-Projects-techbeansjp-free-AGENTS-md/93f315f4-3bc0-463f-8d43-34c419169a23/scratchpad/worker-cmd.sh: 行 12: ASC_WORKER_ALLOWED_TOOLS: 未割り当ての変数です
      launch_worker: worker起動が失敗またはtimeoutしました（rc=1, timeout=7200s）（フェイルセーフでblockedへ倒します）
    # ---- 汚染の原因となった継承値の実測 ----
    - |
      WORKER_CMD=bash /tmp/claude-1000/-home-tatsuru-Projects-techbeansjp-free-AGENTS-md/93f315f4-3bc0-463f-8d43-34c419169a23/scratchpad/worker-cmd.sh
      CODEX_WORKER_CMD=<unset>
    # ---- 上書き経路の所在（.agent-skill-chain/adapters/claude.sh、codex adapter も同経路を共有） ----
    - |
      local worker_cmd="${WORKER_CMD:-}"
      if [[ -z "$worker_cmd" ]]; then
        if ! worker_cmd="$(_worker_default_cmd "$segment" "$contract")"; then
          _fail_blocked "worker既定起動コマンドを組み立てられず WORKER_CMD も未設定です"
          return
        fi
      fi
    # ---- ビルド ----
    - |
      $ npm run build
      > agent-skill-chain@0.2.133 build
      > tsc
    # ---- 機械的検査（いずれも終了コード0・出力なし） ----
    - |
      $ bash .agent-skill-chain/scripts/lint-references.sh        -> 0
      $ bash .agent-skill-chain/scripts/lint-vocab.sh             -> 0
      $ bash .agent-skill-chain/scripts/lint-secrets.sh --diff origin/main -> 0
      $ node bin/agents-md.js lint adr check                      -> 0
      $ node bin/agents-md.js verify doc-length                   -> 0
      $ node bin/agents-md.js verify spec-bdd SPEC.md             -> 0
      $ node bin/agents-md.js verify design-diagram DESIGN.md     -> 0
      $ node bin/agents-md.js verify template-sync                -> 0
      $ node bin/agents-md.js verify root-clean                   -> 0
      $ node bin/agents-md.js verify ac-coverage ISSUE-759        -> 0
    # ---- 検証対象SHAと本成果物の関係（実測。本ファイルをindexへ加えた状態で測定） ----
    - |
      $ git rev-parse HEAD
      98ae472976460330997aec30380f6293a5b7889d
    - |
      $ git log --oneline -3
      98ae472 Merge branch 'main' into bugfix/759-trusted-clone-build-prerequisite
      bbe5a8b docs(ISSUE-759): 設計と実装計画を現行 recorder 受理条件へ追随させる
      fcf648f docs(ISSUE-759): AC-4 と要件5 を現行 recorder 受理条件へ追随させる
    - |
      $ git log --oneline 98ae472976460330997aec30380f6293a5b7889d..HEAD
      上記コマンドの標準出力は0行だった（本成果物のcommit前に測定。検証対象SHAより後のコミットが存在しない）。
    - |
      $ git diff --stat 98ae472976460330997aec30380f6293a5b7889d
       VALIDATION.md | 360 ++++++++++++++++++++++++++++++++++++++++++++++++++++++++++
       1 file changed, 360 insertions(+)
    - |
      $ git diff --name-only 98ae472976460330997aec30380f6293a5b7889d
      VALIDATION.md
    - |
      $ git diff --stat 98ae472976460330997aec30380f6293a5b7889d -- ':!VALIDATION.md'
      上記コマンドの標準出力は0行だった。VALIDATION.md を除外すると検証対象SHAとの差分が消えること、
      すなわち実装ファイル・SPEC.md・DESIGN.md・PLAN.md・docs/adr/ 配下のいずれも変更していないことを示す。
      この出力は本ファイル自身の行数に影響されないため、本ファイルを編集しても成立し続ける。
    - |
      $ git status --porcelain
      A  VALIDATION.md
    - |
      $ git status --short --branch
      ## bugfix/759-trusted-clone-build-prerequisite...origin/bugfix/759-trusted-clone-build-prerequisite
