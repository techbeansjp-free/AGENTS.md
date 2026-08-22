# DESIGN: root成果物の削除をscope限定ロールと決定的コマンドへ移す

- Issue: `ISSUE-798`
- 対応する SPEC: `SPEC.md`
- risk: `normal`

## 目的・対象範囲

repository root 直下の Issue セグメント成果物4ファイル（`SPEC.md`・`DESIGN.md`・`PLAN.md`・`VALIDATION.md`。以下 **root成果物**）を Issue ブランチ上でマージ前に削除する操作を、LLMワーカーの1ラウンドから、scope を限定した専用ロールと進行役が起動する決定的コマンドへ移す。あわせて claude adapter のセグメント作業ワーカーが push 前に `.agent-skill-chain/ci/` 配下の read-only 検査を自ら実行できるようにする。

対象は (a) 新設する決定的コマンドとその薄いラッパー、(b) `.agent-skill-chain/config/roles.yaml` のロール定義と入出力契約、(c) writer lease の segment 値集合（スキーマ enum）、(d) `cleanup`（worktree削除）が有効 lease を探す走査方法、(e) claude adapter の許可コマンド列挙、(f) 既存の protected launcher／one-time token 契約を用いるクリーンアップロール専用の実行 grant である。

**対象外**: 既定ブランチへの push を契機とする既存の事後清掃自動化（`root-cleanup run`）、root 直下の残存を検査する既存の検査コマンド（`verify root-clean`）、`lease acquire` サブコマンドの外部挙動、進行役の権限、codex adapter の sandbox 境界、4セグメント・4ゲートの構成、root成果物の生成場所そのもの。これらは本設計で1行も変更しない。

## 用語（本DESIGN内での定義）

- **root成果物**: repository root 直下の `SPEC.md`・`DESIGN.md`・`PLAN.md`・`VALIDATION.md` の4ファイル。実装上は既存の固定リテラル集合（`src/lib/root-artifacts.ts` の `ROOT_ARTIFACT_FILES`）をそのまま用い、設定化しない。
- **本コマンド**: 本Issueで新設する CLI サブコマンド `root-cleanup branch <issue_id>` と、その薄いラッパー `.agent-skill-chain/scripts/root-cleanup-branch.sh`。
- **クリーンアップロール**: 本Issueで新設する `root_artifact_cleanup_worker`（`scope: root_artifacts_only`）。
- **実行 grant**: protected launcher がクリーンアップロールへ1回だけ発行する署名付き capability。対象 Issue・対象ブランチ・起動時 HEAD・有効期限・nonce を拘束し、通常ワーカーへ署名鍵も未使用 grant も渡さない。
- **対象worktree**: 指定 Issue に対応する worktree。`findIssueWorktree` が解決する。
- **対象ブランチ**: 対象worktree がチェックアウトしているブランチ。
- **remote 先頭**: `git ls-remote origin refs/heads/<対象ブランチ>` が返す SHA。remote の実体であり、ローカルの remote-tracking ref の鮮度に依存しない。
- **削除対象 / 内容喪失リスクあり / 不在**: SPEC が定義する対象ファイルの3状態区分。本DESIGNでもこの3語を同じ意味で用いる。

## 入力・出力・制約

- **入力**: 利用者が与える業務入力は対象 Issue の識別子 1個のみ（`^ISSUE-[0-9]+$`）。`-h`／`--help` は使い方表示。それ以外の引数はすべて使い方エラーとして拒否し、標準入力は一切読まない。D15の専用FDはlauncherが付与する認証envelopeであり、利用者が内容・任意テキストを与える入力経路ではない。
- **出力**: 成功時は削除経路なら作成した commit の SHA、no-op 経路ならその旨を標準出力へ。失敗時は日本語で原因と利用者が取るべき操作を標準エラー出力へ出し、非ゼロ終了する。
- **制約**:
  - ファイル内容・commit メッセージ本文・任意テキストを外部から受け取る経路を持たない。commit メッセージは固定文字列で、可変部は `[0-9]+` に限定された Issue 番号だけである。
  - LLM・対話エージェント・アダプタを起動しない。同一入力・同一リポジトリ状態に対して同一の動作を行う。
  - 作られる commit は root成果物の削除のみで構成し、追加行・他パスへの変更を一切含まない。
  - Git から復元できない内容（未追跡ファイル・未commitの変更）を失わせない。該当があれば削除せず停止する。
  - 通常ワーカーが偽造できない有効な実行 grant を最初に検証・消費できなければ、Git・index・worktree・lease のいずれも変更せず停止する。`ASC_ROLE` 等の自己申告環境変数や writer lease の保持有無は認可根拠にしない。
  - 対象 Issue に writer lease が1件でも存在する場合は、待機も強制解放も回収も行わず停止する（segment を問わない。後述 D3）。
  - 終了コード0は、削除経路・no-op 経路のいずれであっても、**remote 先頭が local HEAD と一致し、その commit の tree にも対象worktree の作業ツリーにも root成果物が1件も存在しない**状態が成立していることを意味する。ローカルだけが clean で remote へ反映されていない状態は成功として扱わない。

## 要件 → 設計要素の対応表

| 要件 / AC-ID | 対応する設計要素 | 検証可能な結果 |
|---|---|---|
| `AC-1` | D10 ロール定義・入出力契約 | `roles:`／`role_contracts:` 双方に scope・capabilities・forbidden が既存の scope 限定ロールと同構造で存在する |
| `AC-2` | D9 CLI表層（厳密arity・stdin不読）、D7 固定commitメッセージ、D13 依存閉包検査 | 引数1個以外を拒否し、コマンド本体の import 閉包にLLM起動系が現れない |
| `AC-3` | D1 状態分類、D5 削除ステージング、D6 staged diff 完全一致検査、D7 commit、D8 remote同期 | 削除のみのcommitが作られ push され SHA が出力され終了コード0 |
| `AC-4` | D4 index スコープ検査、D6 staged diff 完全一致検査 | 対象外のステージ済み変更があれば commit・push せず非ゼロ、worktree/index 不変 |
| `AC-5` | D1 状態分類、D8 事後条件検査 | 全件「不在」かつ remote が既に同期済みのときだけ commit も push もせず終了コード0 |
| `AC-6` | D1 状態分類（fail-closed） | 「内容喪失リスクあり」1件以上で削除せず非ゼロ、該当ファイル名を提示 |
| `AC-7` | D4 index スコープ検査、D5 pathspec 限定削除 | 対象外パスの未ステージ変更・未追跡ファイルが commit へ入らず実行後も残る |
| `AC-8` | D2 実行文脈ガード、D3 writer lease の Issue 単位排他 | 既定ブランチ・lease競合の双方で削除もcommitもpushもせず非ゼロ、lease は保持者・segment・失効時刻を提示 |
| `AC-9` | D8 remote 同期の確立と事後条件検査 | 終了コード0の直前に remote 先頭・local HEAD・作業ツリーの3点を検査し、1つでも満たさなければ0を返さない |
| `AC-10` | D12 許可コマンド列挙の更新、D15 実行 grant 境界 | `ci/` 実行だけを追加し、通常ワーカーが lease の有無や Issue 指定によらず本コマンドを作用させられない |
| `AC-11` | D14 既存モジュール非干渉 | 既存の清掃自動化・残存検査の実装ファイルに差分が無く、既存テストが期待値変更なしで成功 |
| `AC-12` | D10 ロール定義、D15 実行 grant 境界 | 進行役の forbidden が不変で、commit credential と commit author はクリーンアップロールに属する |

## 責務・境界

### コンポーネント構成

- **D1 root成果物状態分類器と書込み前観測 barrier**（`src/lib/root-artifact-state.ts`、新設）: 対象4ファイルの固定 literal pathspec を末尾へ渡し、次の5コマンドをすべて成功させた結果だけを1つの snapshot とする。順序・flag を固定し、いずれかの非ゼロ終了、NULレコード不正、未知の状態は fail-closed とする。
  1. `git --no-optional-locks --literal-pathspecs ls-tree -rz --full-tree HEAD -- SPEC.md DESIGN.md PLAN.md VALIDATION.md`（HEAD の mode・type・OID・path）
  2. `git --no-optional-locks --literal-pathspecs ls-files --stage -z -- SPEC.md DESIGN.md PLAN.md VALIDATION.md`（index の stage・mode・OID・path。stage 1〜3 は unmerged）
  3. `git --no-optional-locks --literal-pathspecs ls-files --others --exclude-standard -z -- SPEC.md DESIGN.md PLAN.md VALIDATION.md`（通常の未追跡対象）
  4. `git --no-optional-locks --literal-pathspecs ls-files --others --ignored --exclude-standard -z -- SPEC.md DESIGN.md PLAN.md VALIDATION.md`（ignore 規則に隠れた未追跡対象）
  5. `git --no-optional-locks --literal-pathspecs -c status.renames=copies status --porcelain=v2 -z --untracked-files=all --ignored=matching --find-renames=50% -- SPEC.md DESIGN.md PLAN.md VALIDATION.md`（index/worktree の XY・mode・OID、rename/copy、unmerged、および untracked/ignored の相互確認）
  - 5だけでは ignored が通常の未追跡集合から消えるため、3と4を独立入力にする。3または4に対象が1件でも現れれば、ignore設定や porcelain の表現にかかわらず「内容喪失リスクあり」である。
  - 全入力へ`--no-optional-locks`を付け、`status`による任意のindex refreshも抑止する。実行 grant 検証、実行文脈のread-only検査、lease取得・再走査、D4のread-only検査を終えた後、**最初の index/worktree mutation である D5 の直前**に5入力を採取する。D5より前に `git add`・`git rm`・`git update-index`・checkout/restore・ファイル書込みを行わない。snapshot 採取中に HEAD または index checksum が変化した場合は再試行せず停止する。
  - **相互排他・網羅性**: 判定は次の決定表を上から1回だけ評価し、最初に成立した区分を確定させる。全ファイルがいずれか1区分に必ず落ちるため、3区分は相互排他かつ網羅的である。
    1. 3/4に現れる、HEADに無くindexにある、HEADとindex/worktreeのOID・mode・typeが異なる、porcelain v2が rename/copy・未マージ・変更を示す、または同一性を証明できない（未追跡・ignored・新規ステージ済み・内容変更・mode変更・型変更・rename/copy・未マージ）→ **内容喪失リスクあり**
    2. HEAD に存在する（作業ツリー上に存在する場合と、未ステージの削除・ステージ済みの削除により既に存在しない場合を含む）→ **削除対象**
    3. 上記いずれでもない → **不在**
  - **fail-closed**: ignored を含む未追跡、解釈できない porcelain レコード、未マージ、newly staged、blob OID・file mode・type の不一致、rename/copy の一切を「内容喪失リスクあり」へ倒す。診断は対象pathと観測した区分を示すが内容は出力しない。
  - 「削除（不在）は HEAD と異なる内容に当たらない」ため、追跡済みファイルの未ステージ削除・ステージ済み削除は区分1ではなく区分2に落ちる。削除によって失われる内容は無く HEAD から復元できるためである。
- **D2 実行文脈ガード**（本コマンド内）: 削除・commit・push のいずれよりも前に、次の4点をこの順に確認する。1点でも満たさなければ、worktree・index・ブランチ・remote のいずれも変更せず非ゼロ終了する。
  1. `findIssueWorktree` で対象worktree が解決でき、チェックアウトが既定ブランチ（`defaultBranch`）ではなく、ブランチが解決できる（detached HEAD でない）こと。既定ブランチであれば、既定ブランチ root 直下の清掃が既存の別自動化の担当であること、および既定ブランチへ直接 commit しないことを理由として示す。
  2. 対象ブランチの remote 先頭が存在すること。存在しなければ、先に対象ブランチの checkpoint push が必要であることを示して停止する。remote 先頭が無い状態では PR も、PR に課される root 残存検査も存在せず、終了コード0の事後条件を定義できないためである。
  3. remote 先頭が local HEAD の祖先または一致であること（`git merge-base --is-ancestor`）。満たさない場合は remote 先行または分岐として停止する。本コマンドは force push も merge も rebase も行わないため、この前提を満たさない状態から remote を同期させる手段を持たない。
  4. remote 先頭から local HEAD への tree 差分が、空であるか、root成果物の削除エントリのみで構成されること。それ以外の差分が1件でもあれば、対象外の未push commit を本コマンドが remote へ持ち込まないために停止する。
  - 3・4 は合わせて「本コマンドが行う push は必ず fast-forward であり、かつ root成果物の削除以外を remote へ持ち込まない」という前提を成立させる。この前提が、push を削除経路だけの後始末ではなく両経路共通の無条件段（D8）として置けるようにする。
- **D3 writer lease の Issue 単位排他**（本コマンド内）: AGENTS.md は1 Issue に同時1つの writer lease のみを許可する。本コマンド自身もこの制約に従う。
  - **競合判定は Issue 単位で行い、segment 単位では行わない。** GitHub モードの lease 正本は `refs/agent-skill-chain/leases/<issue番号>-<segment>` という **segment ごとに独立した ref** であり、取得時の force 無し push（compare-and-set）が保証するのは同一 ref の二重取得防止だけである。したがって新しい segment 値の ref を push するだけでは、同一 Issue の他 segment が保持する lease と排他されない。Issue 単位の排他は ref の compare-and-set ではなく、**Issue 番号を prefix とする ref 走査**が担う。
  - **判定**: 対象 Issue に writer lease が1件でも存在すれば、取得を試みることなく停止し、保持者・segment・失効時刻を診断へ示す。**待機も強制解放も期限切れ lease の回収も行わない。** 期限内・期限切れのいずれも競合として扱う。期限切れ lease の回収は既存の回収経路（`lease resume`・`reconcile`）の責務であり、scope を root成果物の削除だけに限定したロールが他主体の lease を評価・回収する能力を持つべきではないためである。
  - **backend ごとの実現手段**（正本の形が異なるだけで、判定の意味は両モードで同一）:
    - GitHub モード: 既存の Issue 単位プリミティブ `allLeasesFor(issueNumber)` を用いる。同関数は `refs/agent-skill-chain/leases/<issue番号>-*` に対する `ls-remote` の prefix 走査で ref を列挙するため、segment 値を列挙しない。取得は `acquireLeaseRef` により segment 値 `root_artifact_cleanup` の ref を force 無し push して行う。この push が排他するのは本コマンド同士の同時実行だけであり、Issue 単位の排他は上記の prefix 走査が担う。
    - ローカルモード: lease 正本は Issue につき1ファイル（`leaseFilePath`）であり、そのファイルの存在検査がそのまま Issue 単位の判定になる。取得は同ファイルの排他生成（存在すれば失敗する生成）で行い、これ自体が Issue 単位の compare-and-set である。
  - **検査と取得の間の窓**: GitHub モードでは ref が segment ごとに分かれるため、prefix 走査の後・自 ref の push までの間に他 segment が lease を取得しうる。この窓は**本コマンドが必ず譲る**側へ倒す。すなわち自 ref の取得に成功した直後に prefix 走査をもう一度行い、自分の lease 以外が1件でも存在すれば、**自分の lease を解放したうえで**削除・commit・push のいずれも行わずに非ゼロ終了する。他主体を待たせないこと、および `lease acquire` サブコマンドの外部挙動を変更しないこと（SPEC の要件）を両立させるための非対称な譲歩である。ローカルモードでは単一ファイルの排他生成が Issue 単位の compare-and-set そのものであるため、この窓は存在せず再走査も行わない。
  - 取得後は成功・失敗・例外のいずれの終了経路でも必ず解放する。
- **D4 index スコープ検査**（本コマンド内）: 削除をステージする前に、index と HEAD の差分に対象4ファイル以外のパスが含まれていないことを確認する。含まれていれば、対象外のパスが commit へ含まれることを理由として示し、worktree と index を一切変更せずに停止する。
- **D5 決定的削除ステージング**（本コマンド内）: 削除対象について、pathspec を対象4ファイルのリテラルに限定した `git rm` で削除をステージする。作業ツリー上に存在するものは作業ツリーと index の双方から、作業ツリーに無く index にあるものは index から取り除く。既にステージ済みの削除は何もしない。pathspec がリテラル固定であるため、対象外パスの未ステージ変更・未追跡ファイルは構造的に巻き込めない。
- **D6 staged diff 完全一致検査**（本コマンド内）: commit を作る直前に、index と HEAD の差分が「削除対象の集合と完全に一致し、かつ全エントリが削除である」ことを再検査する。一致しなければ commit せず停止する。分類結果を信用せず commit 直前の実体を1点で検査することで、「削除のみで構成された commit」を構造的に保証する。
- **D7 固定commit**（本コマンド内）: `ensureGitIdentity` で commit 実行者の identity を確保し、固定メッセージで commit する。メッセージの可変部は検証済み Issue 番号だけである。push は本要素では行わず、D8 へ委ねる。
- **D8 remote 同期の確立と終了コード0の事後条件検査**（本コマンド内）: 削除経路・no-op 経路の双方が無条件に通る最終段。次の順に実行する。
  1. remote 先頭を読み直す。local HEAD と一致していれば push しない。一致していなければ push する。D2 の 3・4 により、この push は必ず fast-forward であり、root成果物の削除以外を remote へ持ち込まない。
  2. push 後（または push 不要と判断した後）に remote 先頭をもう一度読み、local HEAD と一致することを確認する。
  3. remote 先頭の commit の tree、local HEAD の commit の tree、対象worktree の作業ツリーの3か所すべてに root成果物が1件も存在しないことを確認する。作業ツリーも見るのは、既存の残存検査コマンドが作業ツリー上の存在を見る実装だからである。
  4. 1〜3 のいずれかを満たせない場合は終了コード0を返さず、原因（push 失敗・remote 先行・残存）と利用者が取るべき操作を示して非ゼロ終了する。
  - この段が無条件であるため、「ローカルでは削除済みだが remote へ反映されていない」状態は no-op として成功を返す経路を持たない。同じ理由で、push が失敗した後の再実行は、D2 の 4 が許す「差分は root成果物の削除のみ」に該当し、本段の 1 で push を完了させてから 2・3 を検査する。すなわち再実行が回復経路そのものであり、回復のための追加の分岐・フラグを持たない。
- **D9 CLI表層と薄いラッパー**: `root-cleanup branch <issue_id>` をディスパッチテーブルへ1行追加し、`.agent-skill-chain/scripts/root-cleanup-branch.sh` を既存ラッパーと同一の CLI 解決前文で用意する。引数はちょうど1個を要求し、超過・不足・形式不正はすべて使い方エラーとする。ラッパーを含む直接呼出しは可能だが、D15の未使用 grant を protected launcher から受け取っていない呼出しは認可検査で必ず停止する。
- **D10 ロール定義と入出力契約**（`.agent-skill-chain/config/roles.yaml`）: `roles:` 配下へ `root_artifact_cleanup_worker`（`lease: writer`、`scope: root_artifacts_only`、capabilities は lease 取得・更新・解放と自ブランチへの commit・push のみ、forbidden に「対象4ファイル以外への変更」と「ファイル内容の編集」）、`role_contracts:` 配下へ同名の入出力契約（inputs・outputs・rules・completion・forbidden）を、既存の scope 限定ロールと同じ構造で置く。
- **D11 lease 走査の Issue 単位プリミティブへの統一**: `.agent-skill-chain/schemas/lease.schema.yaml` の segment enum へ `root_artifact_cleanup` を加える（本コマンドが取得する lease をスキーマ検証へ通すため）。あわせて、`cleanup`（worktree削除）が有効 lease を探す際に segment 名を5件直書きで列挙している箇所を、既存の Issue 単位プリミティブ `activeLeasesFor(issueNumber)`（`allLeasesFor` と同じ prefix 走査に有効期限フィルタを掛けたもの）の呼び出しへ置き換える。**segment 値の固定集合をコード側へ新設しない。** 直書き列挙を別の固定集合へ移し替えても追随漏れの発生源が場所を変えるだけであり、既存の prefix 走査は segment 値に依存せずすべての lease を列挙するため、走査元を置き換えれば将来 segment が増えても追随が不要になる。
- **D12 許可コマンド列挙の更新**（`.agent-skill-chain/adapters/claude.sh`）: セグメント作業ワーカーの既定許可コマンド列挙へ `.agent-skill-chain/ci/` 配下の実行を `.agent-skill-chain/scripts/` 配下と同じ2表記で加える。削除系コマンドは追加しない。`scripts/*` が薄いラッパーを字句上含む事実を隠さず、D15の grant が実効認可を担うことを列挙近傍に記述する。allowlist はClaude固有でCodex sandboxには効かないため、AC-10の権限境界をallowlistだけでは立証しない。
- **D13 依存閉包検査**（テスト側）: 本コマンド実装モジュールの推移的 import 閉包に、アダプタ起動・ワーカー起動・ゲートレビュア起動の実装が含まれないことを、既存の依存トレース補助を用いて機械検査する。AC-2 の「LLMまたは対話エージェントの起動を含まない」を宣言ではなく構造で担保するためである。
- **D14 既存モジュール非干渉**: 既存の事後清掃自動化・残存検査の実装、およびそれぞれの薄いラッパーには一切差分を入れない。本コマンドは別モジュールとして新設し、既存側との接点はディスパッチテーブルへの1行追加と、対象ファイル集合を与える既存の固定リテラルの共有だけに限る。
- **D15 protected launcher とクリーンアップロール専用の実行 grant**: 既存adapterの launcher lifecycle に `launch_root_artifact_cleanup <issue_id>` を追加し、Claude/Codexの通常worker起動とは別にLLMなしで本コマンドを子プロセス起動する。mutation可能なexecutorは対象worktreeの可変スクリプトを実行せず、protected baseまたはversion固定installed packageから調達してdigestを固定する。launcherは通常ワーカーが読めないcredentialで、`schema_version`・`role=root_artifact_cleanup_worker`・issue_id・解決済みbranch・起動時HEAD・executor digest・60秒以内のexpiry・256bit nonce を含む one-time grant に署名する。署名鍵と未使用nonce registryはworktree・Git common dir・worker環境の外に置く。検証鍵はexecutorのversion固定keyringへ固定し、呼出側が環境変数・引数で差し替える経路を持たない。grant本文はargv・通常環境変数・stdin・ログへ出さず、launcherが開いた専用FDで子へ1回だけ渡す。
  - executorは引数処理直後、worktree解決・lease取得・Git mutationより前に、署名、expiry、未消費nonce、role、issue_id、branch、HEAD、自身のdigestを照合し、launcher側registryでnonceをcompare-and-set消費する。欠落・自己生成・改変・期限切れ・再利用・claim不一致・registry到達不能は同じ認可エラーとして非ゼロ終了し、削除・commit・push・lease取得を一切行わない。対象worktree側でwrapperやCLI sourceを改変して認可検査を除去しても、grantが拘束するexecutorには置換できない。
  - `ASC_ROLE=root_artifact_cleanup_worker` のような自己申告値、ラッパーの呼出し元、現在のleaseだけでは認可しない。したがって通常ワーカーが自leaseを解放した後、leaseの無い別Issueを指定した場合、環境変数を偽装した場合、ラッパーやCLIを直接起動した場合も未使用の署名付きgrantを得られず停止する。
  - launcherはクリーンアップロール用Git identityとpush credentialを子へ限定して渡し、通常ワーカーcredentialと進行役identityを渡さない。commit author/committerとpush主体はクリーンアップロールであり、進行役はgrant発行を要求して結果を読むだけで成果物branchのcommit主体にならない。
  - **追加が必要な理由**: leaseは相互排他であって認可ではなくワーカー自身が解放でき、Claude allowlistは`scripts/*`を含みCodexには適用されない。既存要素の削除・絞込みだけでは両adapterで非偽造のrole境界を作れないため、既存のprotected launcher・one-time token契約をこの専用ロールへ適用する最小追加が必要である。新しい承認 bypass や汎用削除能力は追加しない。

### 依存関係

```mermaid
graph TD
    Launcher["protected launcher<br/>D15 署名付きone-time grant"] --> Wrapper["scripts/root-cleanup-branch.sh<br/>(薄いラッパー)"]
    Wrapper --> CLI["root-cleanup branch<br/>D9 CLI表層"]
    CLI --> Auth["D15 grant検証・原子的消費"]
    Auth --> Guard["D2 実行文脈ガード<br/>(既定ブランチ・remote前提)"]
    Guard --> Lease["D3 writer lease<br/>Issue単位排他"]
    Lease --> Classify["D1 書込み前snapshot<br/>(ignoredを独立列挙)"]
    Classify --> Scope["D4 index スコープ検査"]
    Scope --> Stage["D5 削除ステージング"]
    Stage --> Verify["D6 staged diff 完全一致検査"]
    Verify --> Commit["D7 固定commit"]
    Commit --> Sync["D8 remote同期の確立<br/>と事後条件検査"]
    Classify --> Sync
    Guard --> Worktree["worktree解決・既定ブランチ判定<br/>(既存)"]
    Guard --> Remote["remote先頭の読み取り<br/>(既存のls-remote経路)"]
    Sync --> Remote
    Lease --> LeasePrim["Issue単位lease走査プリミティブ<br/>(既存のprefix走査)"]
    Classify --> Files["ROOT_ARTIFACT_FILES<br/>(既存の固定リテラル)"]
    Cleanup["cleanup（worktree削除、既存）"] --> LeasePrim
    Existing["root-cleanup run / verify root-clean<br/>(既存・本Issueで変更しない)"] --> Files
```

依存は上から下への一方向であり、循環は無い。既存側（`root-cleanup run`・`verify root-clean`）と新設側は `ROOT_ARTIFACT_FILES` を共有するだけで、互いを呼び出さない。責務は分類・ガード・lease・スコープ検査・ステージング・commit・remote同期へ分割し、単一モジュールへ集中させない。

### 状態遷移（判定順序）

停止条件は常に no-op 判定より優先する。上から順に評価し、最初に成立した1つだけを実行する。

```mermaid
stateDiagram-v2
    [*] --> 入力検査
    入力検査 --> grant検証: 引数1個・形式適合
    入力検査 --> 停止: 引数不正・worktree未解決
    grant検証 --> 実行文脈ガード: 署名・claims一致、nonce原子的消費
    grant検証 --> 停止: 欠落・偽造・期限切れ・再利用・claim不一致
    実行文脈ガード --> lease検査: Issueブランチ・remote先頭が祖先・差分は削除のみ
    実行文脈ガード --> 停止: 既定ブランチ・detached HEAD（AC-8a）・remote不在・remote先行・対象外の未push差分
    lease検査 --> lease取得: 対象Issueにlease 0件
    lease検査 --> 停止: lease 1件以上（保持者・segment・失効時刻を提示。待機も強制解放も回収もしない。AC-8b）
    lease取得 --> 再走査: 自refの取得成功（GitHubモードのみ）
    再走査 --> 停止: 自分以外のleaseを検出（自leaseを解放して譲る。AC-8b）
    再走査 --> indexスコープ検査: 自分のleaseのみ
    indexスコープ検査 --> 停止: 対象外のステージ済み変更あり（AC-4）
    indexスコープ検査 --> 分類: 対象外stageなし、mutation前の5入力snapshot
    分類 --> 停止: ignored・untracked・newly staged・変更・mode・rename/copy・unmerged・未知（AC-6）
    分類 --> 削除経路: リスク0件、削除対象1件以上
    分類 --> noop経路: 全件不在
    削除経路 --> remote同期: ステージング→完全一致検査→commit（AC-3）
    noop経路 --> remote同期: commitを作らない（AC-5）
    remote同期 --> 成功: remote先頭=local HEAD かつ3か所すべてに残存0件（AC-9）
    remote同期 --> 停止: push失敗・remote不一致・残存あり
    成功 --> [*]
    停止 --> [*]
```

grant検証はすべてのrepository mutationに先行し、grantは結果にかかわらず再利用できない。lease は「成功」「停止」いずれの終端へ到達する場合も解放する。remote 同期段では、remote 先頭が既に local HEAD と一致していれば push を行わない——通常の no-op 経路で push が発生しないのはこのためである。

### 図示要否の判断

- 判断: `要`
- 根拠: 責務境界（D1 分類器・D2 ガード・D3 lease・D4 スコープ検査・D5 ステージング・D6 完全一致検査・D7 commit・D8 remote同期）が3つ以上あり、コンポーネント間・既存資産との依存関係も3つ以上ある。さらに判定順序が「停止・削除・no-op」の3遷移を持ち、状態遷移が2つ以上あるという基準にも該当する。したがって依存関係図と判定順序の状態遷移図の双方を記載する。

## 設計判断とその根拠

### 進行役に成果物ブランチへの commit 能力を与えない構造

本コマンドは進行役が起動するが、commit の主体は進行役ではなくクリーンアップロールである。進行役の権限は本Issueで一切拡大せず、`forbidden` の「成果物branchへのcommit禁止」「成果物の著述禁止」を取り除かない。加えて、本コマンドは内容を与える入力経路（ファイル内容・commitメッセージ本文・任意テキストの引数、標準入力）を持たないため、進行役が本コマンドを経由して成果物を著述することは構造的に不可能である。これは AGENTS.md の不変条件 I5 を宣言ではなく引数仕様で担保するという設計である。

### 排他性を ref の compare-and-set ではなく Issue 単位走査に置く

lease ref は `<issue番号>-<segment>` 単位であるため、force 無し push の compare-and-set が排他するのは同一 segment だけである。新しい segment 値の ref を push しても、同一 Issue の他 segment が保持する lease とは競合しない。したがって「1 Issue につき同時1つ」を成立させるのは ref の原子性ではなく、Issue 番号を prefix とする ref 走査（GitHub モード）およびそもそも Issue につき1ファイルである lease 正本（ローカルモード）である。本コマンドはこの Issue 単位の判定を、削除・commit・push のいずれよりも前に置く。

### writer lease から WIP 上限判定と可視性副作用を外す

本コマンドの lease 取得は上記の排他性のみを目的とし、既存の `lease acquire` サブコマンドが併せて行う WIP 上限判定・Issue ラベル付与・Issue コメント投稿は行わない。理由は次の2点である。

1. WIP 上限は新規作業を pipeline へ受け入れる際の入口判定である。本コマンドは既に受け入れ済みの Issue に対する終端処理であり、しかも実行はマージ直前に集中する。ここで上限判定を課すと、上限に達している状況——すなわちマージを最も急ぐ状況——でマージ前削除が拒否され、本Issueが解消しようとしている遅延をむしろ増幅する。
2. 実行時間が秒単位であり、可視性ラベル・コメントの付与と即時削除は Issue 上の雑音にしかならない。

排他性はこれらの副作用ではなく Issue 単位走査が担うため、省略しても二重取得は発生しない。なお、有効な lease を保持したまま WIP 判定用ラベルを付けないため、他 Issue から見た有効 lease 数が本コマンドの実行中（秒単位）だけ1件少なく数えられる。上限判定は advisory であり、この誤差で不変条件が破れることはない。既存の `lease acquire` サブコマンドの外部挙動は変更しない。

### セグメント作業ワーカーが本コマンドを作用させられない

許可コマンド列挙は `.agent-skill-chain/scripts/` 配下を含み、Codex workerもsandbox内のCLIを実行できるため、ラッパー名やCLI名を隠すことは権限境界にならない。またworkerは自leaseを解放できるため、lease競合は認可の代用にならない。D15は、通常workerへ渡さない署名鍵と未使用nonce registryを信頼根とし、protected launcherが対象Issue・branch・HEADへ拘束したgrantだけを最初に検証・消費する。workerが自leaseを解放する、別Issueを指定する、role環境変数を偽装する、grant形式のファイルを自作する、過去grantを再利用する各経路は、署名またはregistryの原子的消費で拒否される。leaseは認可後の書込み排他だけを担い、AC-10のauthority boundaryはgrantだけが担う。

### 終了コード0を remote の実体で定義する

SPEC は、終了コード0がマージ準備完了状態の PR に課される root 残存検査を満たす状態の成立を意味し、成功が残存を隠蔽してはならないと定める。当該検査が走る対象は push 済みブランチの先頭であるから、事後条件はローカルの HEAD ではなく remote 先頭で定義しなければならない。ローカルだけが clean で remote が未反映の状態を no-op として成功にすると、成功が残存を隠蔽する。SPEC は「事後条件を満たせない状態は no-op として成功を返さない」ことを明示的に要求しており、D8 の無条件段はこの要求をそのまま実装したものである。

通常の no-op（対象4ファイルがどこにも存在せず、remote 先頭が既に local HEAD と一致する状態）では push は発生せず、ブランチの先頭 commit も変化しない。push が発生するのは、remote 先頭が local HEAD と一致しない場合、すなわち直前の実行が push を完了できなかった場合に限られる。この場合も新たな commit は作らず、ブランチの先頭 commit は変化しない——変わるのは remote の ref だけである。

### 新しい設定項目を追加しない

対象4ファイルは既に固定リテラルとして実装済みであり、設定化しないという既存の決定を踏襲する。対象集合・commitメッセージ・判定順序のいずれもプロジェクトごとに変える必要が無く、変えられることが終了コード0の事後条件や「削除のみのcommit」を弱めるため、ハードコードが正しい。D15の署名鍵・nonce registry・クリーンアップ用Git credentialはプロジェクト設定ではなくprotected launcherが管理するrole credentialであり、workerへ配布するconfig/schema/envへ追加しない。

### lease segment 集合の拡張が破壊的でない理由

`.agent-skill-chain/schemas/lease.schema.yaml` の segment enum へ値を1つ加える変更は、既存の lease 文書をすべて有効なまま保つ後方互換な拡張であり、schema 名前空間の版更新を要しない。同スキーマには過去にも同種の scope 限定ロール用の値が追加されている。enum を追加する一方でコード側に segment の固定集合を作らないのは、走査が prefix ベースであり値の列挙を必要としないためである。

## 関連ADR

```yaml
related_adrs:
  - id: ADR-0080
    relation: adopts
  - id: ADR-0007
    relation: references
```

`ADR-0080` は本Issueで新規に作成する（`status: proposed`）。`ADR-0007` は既定ブランチへの push を契機とする事後清掃自動化を定めた既存の決定であり、本設計が置き換えず併存させる対象として参照する。

## 障害・ロールバック考慮

- **想定される失敗モード**:
  - **push 失敗（権限・接続）**: commit は作成済みでローカルに残る。commit を巻き戻すと削除内容の復元可能性を損なう経路が増えるため巻き戻さず、非ゼロ終了して保持している commit の SHA と原因を診断へ示す。**この状態で本コマンドを再実行すると、D2 が「remote 先頭から local HEAD への差分は root成果物の削除のみ」を確認したうえで D8 が push を完了させ、remote 先頭と local HEAD の一致を検証してから終了コード0を返す。** すなわち再実行が回復経路であり、削除が remote へ反映されないまま終了コード0を返す経路は存在しない。
  - **remote 先行・分岐**: D2 の 3 で停止する。本コマンドは force push・merge・rebase のいずれも行わないため、remote 先行を解消する手段を持たない。診断には既定ブランチ追随（fetch と merge）を先に完了させる必要があることを示す。
  - **対象外の未push commit がある**: D2 の 4 で停止する。ワーカーの未push作業を本コマンドが remote へ持ち込まないためである。診断には先に checkpoint の push が必要であることを示す。
  - **lease 解放失敗**: commit・push が成功していても非ゼロ終了し、回収手段を診断へ示す。終了コード0が「clean に完了した」以外を意味しないようにするためであり、解放されない lease を黙って残すと次の書込み主体が原因不明で止まる。
  - **本コマンド自身の lease が解放されずに残る**: 次回以降の実行が Issue 単位判定で停止する。本コマンドは自らの lease であっても回収しないため、既存の回収経路（`lease resume`・`reconcile`）による解放が必要になる。scope 限定ロールへ lease 回収能力を与えないことと引き換えに受け入れるコストであり、診断が保持者・segment・失効時刻を示すため停止理由は特定できる。
  - **分類の入力を解釈できない**: 未知の porcelain レコード・未マージエントリはすべて「内容喪失リスクあり」へ倒し、削除せず停止する。
  - **ignored対象の存在**: ignore規則のため通常のuntracked列挙に出なくても、独立した`--others --ignored --exclude-standard`入力で検出し、内容喪失リスクとして停止する。対象path、HEAD、index、worktreeのいずれも変更しない。
  - **実行 grant の不成立**: grant欠落・署名不正・期限切れ・再利用・claim不一致・registry障害はいずれも認可失敗として、lease取得を含む全mutationより前に停止する。通常workerへgrant発行を迂回させる承認フラグやfallbackは設けない。
  - **対象worktree 未解決・detached HEAD・remote 先頭不在**: 削除も commit も push も行わず非ゼロ終了する。commit 先ブランチまたは事後条件の検証対象が確定しない状態で書き込まないためである。
  - **既に他主体が書込み中**: lease 競合として停止する。待機による無限待ちも、強制解放による他主体の作業破壊も選ばない。
- **ロールバック手順**: 本Issueの変更は、新規モジュール・launcher lifecycle追加・ディスパッチテーブル1行追加・ロール定義追記・許可コマンド列挙追記・スキーマ enum への1値追加・`cleanup` の lease 走査元の置換で構成される。commit 単位の revert で導入前の挙動へ戻り、未消費grantは短いexpiry後に無効となる。既存の事後清掃自動化と残存検査は本Issueの変更に依存しないため revert 後も動作する。本コマンドが削除した成果物の内容は Git 履歴に残り、当該 commit の revert で復元できる。
- **影響を受ける既存機能**:
  - `cleanup`（worktree削除）: 有効 lease の走査が segment 名の直書き列挙から Issue 単位の prefix 走査へ変わる。有効 lease を見落とさなくなる方向の変更であり、削除を許す条件は緩まない。
  - claude adapter のセグメント作業ワーカー: `.agent-skill-chain/ci/` 配下の read-only 検査を実行できるようになる。書込み能力は増えない。
  - claude/codex/human adapter: 共通の決定的cleanup launcher lifecycleを追加する。通常worker lifecycleとcredential/environmentを共有しない。
  - writer lease スキーマ: enum に値が1つ増える。既存文書は有効なまま。
  - 既存の事後清掃自動化・残存検査・`lease acquire`・進行役の権限: 変更しない。

## 未決事項

- 既存の ADR status 更新コマンドは、対応するロール定義が lease 取得能力を持つと宣言している一方、実装では writer lease を取得していない。本コマンドは SPEC の要求どおり lease を取得するため本Issueの完了には影響しないが、既存側の宣言と実装の不一致は本Issueの範囲外であり、成果物を拡張して是正しない。ワーカー報告で観測事実として報告する。
