# 04 レビュー

> すべてのラウンドで肯定・敵対の両観点を確認する。`成果物用語と責務境界`は`.agent-skill-chain/docs/01_開発ワークフロー.md`を正本とする。指摘を無理に作らず、指摘なしの承認を有効とする。Medium/Lowだけを理由に自動修正・追加レビュー・ゲート停止を起こさない。

## 0. レビュー識別情報

| 項目 | 内容 |
|---|---|
| 対象 | 実装 |
| 対象Issue | #1017 |
| ラウンド | Step 10 ラウンド1 |
| ラウンド数 | 1。**記録するreview roundは1つである。** commit前に独立reviewerへ2度consultationを行い、計7件の記述誤りを検出して本artifactへ畳んだうえで、その最終形をラウンド1の対象にした。**consultationはreview roundではないので予算を消費しない。** 予算3のうち2を残す |
| 比較基点 | `a1a39f1bd41298ba86056d15535978f12c210a29` |
| H_impl | `19895e323a386ba4140f7e359f707a03e3b7c23a` |
| 比較基点の由来 | worktree作成時点の`origin/main`のtip。PR #1100（#1099のcleanup計画配線）のmerge commitである。前へ進めていない |
| Step 10のreview session ID | ラウンド1記録時に確定し、`review-session.json`が正本になる |
| モード | full |
| 対象差分 | `.github/trusted-quality-proposals.json` の23行追記1件のみ。commitは`19895e32` |
| 対象外 | **是正本体の適用と版上げ。** `scripts/check_project_quality.ts`の変更と`qualityContractVersion`の9→10更新はPR-2が行う。同一PRで登録と有効化を行うとSCN-UNIT-QUALITY-009が`candidateによる同一PR内の自己承認`として拒否する |
| Step chain | 経由: .agent-skill-chain/tmp/issues/20260902_022825_保護対象読み取り診断の品質契約proposalを登録する |
| 仕様の所有箇所 | `docs/specs/02_要件/04_仕様・品質管理要件.md`のREQ-SQ-006「品質契約変更はtrusted proposalの二段階適用に限定する」とREQ-SQ-012「登録済み品質proposalの契約fieldを不変にする」。**両要件の本文は変えない** |
| 成果物行数 | 製品 **+0 / −0行**（codeを1行も変えていない）。仕様 **+0 / −0行**。データ **+23 / −0行**（registry JSON）。支援層 **+0 / −0行** |
| 縮小の先行評価 | 3案を評価し2案を不採用とした。**採用したのは「登録前に是正を完成させてからhashを取る」である。** 完成前に取ると、after hashが実byteと合わず、同じ版の代替proposalを追加登録することになる。**この費用は本repositoryに実例がある。** `TQP-POC-SANDBOX-CI-001`（commit `2a3bfae0`）と`TQP-POC-SANDBOX-CI-APPARMOR-001`（commit `6bd96b85`）は、**同じ`8→9`・同じ`ci.yml` target・同じbefore hashで、after hashだけが異なる。** 前者では目的を満たせず後から代替を足した実例である（R1-B02）。不採用は(1)登録と有効化を1本のPRで行う案（SCN-UNIT-QUALITY-009が拒否する）、(2)登録内容を二重に検査する新機構を足す案（`readProposalRegistry`が全fieldを既に検証しており、足すと同じ判定を2箇所で持つ）。**新規SCNも新規fixtureも1件も足していない** |
| 実施者・日時 | reviewer（codexのread-only sandbox起動）、統合はcoordinator（claude）、2026-09-02。**ラウンド1・2とも実施済みである** |

### 0.1 routing入力契約

| role欄（担当role） | 必要証拠 | 必要model tier | provider欄 | model設定欄 | fallback欄 | 独立性証拠欄・非変更証拠 |
|---|---|---|---|---|---|---|
| reviewer | 肯定review（3節）、敵対review（4節）、finding分類（5節と`review-session.json`） | standard | codex | `project_default`、`independence.differentFrom = implementer` | Critical/High未解決なら停止し、是正後の同一HEADで再review | implementerは本session（claude）。reviewerは**codexの別invocation**である。**reviewerはfileを1つも変更していない**（read-only sandboxで起動した） |

**開示する逸脱が3件ある。**

1. **implementerとcoordinatorが同一sessionである。** reviewerとの分離は成立している。findingの採否判断をcoordinatorが行っており`roleContracts.coordinator.forbiddenOperations`の`self_approve`に接する。
2. **`docs/reviews/`はどのroleの`allowedPaths`にも無い。** `scripts/check_file_audit.ts`が同directoryを要求する一方、`validateRoleOperation`は実行時に強制されていない。解消を #1047 へ委譲する。
3. **本PRの承認元であるrepository ownerは、本sessionの利用者と同一人物である。** 品質契約の版上げは2026-09-02に明示承認された。承認の記録先はsessionの会話であり、candidate branch内のfileではない。

## 1. 入力証拠

| 証拠 | 参照先 | 観測結果 | 根拠種別 |
|---|---|---|---|
| 要求・受け入れ条件 | https://github.com/techbeansjp-free/AGENTS.md/issues/1017 | AC-01〜03。Step 8で34759文字の本文を同期し`sync-verified`・`checkpoint: 8`・digest `1094adba…`で確定 | 人間判断 |
| 差分 | `a1a39f1b..19895e32` | 1 file、23行追記 | 既存コード |
| テスト | `npm run quality` | 1388 scenarios、失敗0件、skip 16件 | テスト出力 |
| 配布物 | `npm run package:check` | `実行・配布ファイル342件`で合格。**`quality`はこれを内包しないため個別に実行した。** この出力はHEADへ耐久化されておらず、独立の再確認はCIの同名jobが行う | テスト出力 |
| 実entryの受理 | `checkProjectQualityContract(H_final, a1a39f1b)` | `{"valid": true, "errors": []}`。**この検証が及ぶのはschema・target allowlist・`9→10`・version target・before hashまでである。fileの`afterSha256`と実byteの照合はPR-2でしか起こらない**（R1-B05） | 実行結果 |
| 仕様 | 変更なし | `no-spec-impact` | 既存文書 |
| commit前candidate | 対象差分1 path | `git status --short`が意図しないpath 0件 | Git index |
| Phase A artifact | `docs/reviews/103_課題1017保護対象読み取り診断のproposal登録レビュー.md` | `H_impl..H_final`は本artifact 1 fileだけ | Git観測 |
| commit後external | PRは本artifact確定後に作成する | Step 11で観測する | 外部のimmutable証拠 |

- dependency/authority/evidence graphにcycle、self-loop、unknown node、candidate自己評価、tracked artifact自己SHAがない: **成立する。** trusted registry → candidate registry の一方向であり、candidateがtrustedを書き換える経路が存在しない。self-loop（candidateの自己承認）はSCN-UNIT-QUALITY-009が拒否する。
- `H_impl`が`H_final`のancestorで、その差分がreview artifactだけである: **`H_impl = 19895e32`は本artifact commitの親である。**
- reviewer stable IDがPR author/`H_impl` author stable IDと異なる: **未観測。** PRはStep 11で作成するため、trusted provider由来のreviewer actor IDをまだ観測していない。**別providerであることはstable IDの差を証明しない。** 9節を参照する。
- 既定branch追随を行った場合: **行っていない。**

## 変更ファイル個別監査

| path | 変更種別 | owner | target layer | 単一責務・配置根拠 | 依存方向・循環 | 仕様・AC・SCN | 安全・rollback | 個別判定 |
|---|---|---|---|---|---|---|---|---|
| `.github/trusted-quality-proposals.json` | M | package | package | staged proposal 1件の追記。既存10件とschemaVersionへ触れない | pass。実行codeを持たないデータであり依存を1つも増やさない | REQ-SQ-006・REQ-SQ-012 / AC-01〜03 / SCN-UNIT-QUALITY-008・009 | merge前は`git checkout`で戻せる。**merge後は戻せない**（append-only） | pass |

- 基準SHAとの差分path集合と表のpath集合が完全一致する: **`比較基点..H_impl`すなわち`a1a39f1b..19895e32`は`.github/trusted-quality-proposals.json`の1 pathで、本表の1行と一致する。** 本artifactは`H_impl`の後に置くため本表には現れない。`H_impl..H_final`は本artifactの1 fileだけである。
- package層へproject固有値、project層へ汎用機構、spec/evidence層へ実行authorityを混入していない: **成立する。** registryはproject固有のhash値を持つが、これは品質契約が定める本来の内容である。
- 個別findingを修正した場合、そのファイルと隣接依存だけを再監査した: **ラウンド1の指摘に是正を要するものが出た場合に記載する。**

## 2. 受け入れ条件の確認

### 2.0 実装中に発見した事実と前向きな対処

| 発見ID | 事実 | 影響 | 契約変更 | 対処 | Verification Evidence | 仕様反映 | 判定 |
|---|---|---|---|---|---|---|---|
| DISC-001 | **現在のtrusted品質契約版は9であり、8ではなかった。** 着手前の想定は8→9だった | `fromVersion`・`toVersion`と`packageField`のbefore/after hashが変わる。目的、scope、ACはいずれも変わらない | なし（`continue`） | `package.json`の実測値から9→10とした | 記録した`19581e27…`が`printf '9' \| sha256sum`と完全一致し、**既存proposal `TQP-POC-SANDBOX-CI-APPARMOR-001`の`afterSha256`とも一致した。hash規約の解釈を2経路で確認した** | no-spec-impact | pass |

**版数を記憶から書かず実測したことが分岐点だった。** 8→9で登録していれば`現在のtrusted品質契約versionから1段階だけ提案してください`で拒否され、before hashも不一致になっていた。

### 2.1 受け入れ条件とシナリオ

| AC ID | SCN ID | 実装 | テスト結果 | 判定 | 証拠 |
|---|---|---|---|---|---|
| AC-01 | SCN-UNIT-QUALITY-008 | registry data | pass | pass | 事前登録済みproposalと完全一致するcandidateだけが有効化できる |
| AC-02 | SCN-UNIT-QUALITY-009 | 同上 | pass | pass | candidate自身だけが登録したproposalによる自己承認が拒否される |
| AC-03 | ― | 作業tree全体 | pass | pass | `npm run quality`が1388 scenariosで失敗0件 |

### 2.2 開発考慮事項の適用判定（必須）

| ID | 考慮事項 | 判定 | 理由 | 実装・検証証拠 |
|---|---|---|---|---|
| DC-PRIVACY | Privacy/Security by Design | applicable | 品質契約の保護境界の変更を承認する宣言であり信頼境界に触れる | targetが`PROTECTED_FILES`・`PROTECTED_PACKAGE_FIELDS`へ閉じることをtarget境界検証が機械的に強制する。before hashはtrusted側の実内容から再計算される |
| DC-OBSERVABILITY | Secure Logging・Observability・運用可能性 | not-applicable | log出力、相関情報、保持期間、rotation、監視、復旧手順のいずれも追加・変更しない | 変更は静的JSONへの23行追記だけで、実行時の出力経路を1つも通らない |
| DC-UX | Human-Centered UI/UX・アクセシビリティ | not-applicable | 画面、状態遷移、keyboard・touch、支援技術のいずれも持たない | project choicesにUI capabilityの選択が無く、成果物が静的宣言JSONである |
| DC-TOKENS | Design System・Design/Layout Token | not-applicable | 意味token、component state、breakpoint、layout不変条件のいずれも持たない | 描画対象が存在しない |

## 3. 肯定的評価

| 観点 | 確認内容 | 判定 | 根拠 |
|---|---|---|---|
| 正しさ | 要件と観測結果が一致するか | pass | **`beforeSha256`は2件で、`afterSha256`と合わせて4値である。** うち3値（file before、version before、version after）を実測と突合した。`sha256("9")`が既存proposalの記録値と一致し規約を2経路で確認。**残る1値であるfileの`afterSha256`はPR-2でしか照合できない**（R1-B05） |
| 価値 | 利用者・運用上の目的を満たすか | pass | #1017の是正をPR-2で統制を迂回せずに有効化できる |
| 実現可能性 | 実行環境・依存・権限で成立するか | pass | JSONへの追記のみ。codeも依存も追加authorityも要さない |
| 整合性 | 設計、コード、テスト、仕様が一致するか | pass | `no-spec-impact`の根拠をREQ-SQ-006とREQ-SQ-012の原文で示した |
| 保守性 | 責務、命名、変更容易性が妥当か | pass | `rationale`が是正の理由を、`rollback`が復旧手順を次の実装者へ伝える |

## 4. 敵対的評価

| 観点 | 確認内容 | 判定 | 根拠 |
|---|---|---|---|
| 反例 | 要件を破る入力・状態がないか | pass | `readProposalRegistry`が未知field、型、ID書式・重複、版の1段階性、hash書式、before≠afterを全件検証する |
| 失敗経路 | 外部失敗・部分失敗を安全に扱うか | pass | schema違反は例外で登録全体を拒否し、正しいentryだけを部分受理しない |
| 境界値 | 空、最大、最小、重複、Unicode等 | pass | `proposalId`は`^TQP-[A-Z0-9][A-Z0-9-]*$`、hashは`^[a-f0-9]{64}$`で書式を閉じている。`targets.length < 2`は拒否される |
| 悪用 | 注入、経路脱出、権限外操作等 | pass | `targets[].name`はallowlist照合であり任意pathを受け付けない。非保護fileをtargetにするとregistry全体が拒否される |
| 安全性 | 認証、承認、秘密情報、Zero Trust | pass | before hashをtrusted側の実内容から再計算する既存経路に従う。記録された主張を根拠にしない。registryに秘密情報を書かず`owner`は役割名である |
| データ損失 | 上書き、削除、部分公開、履歴消失 | pass | 既存10件を1文字も変えていない。`git diff`が追記23行のみであることを確認した |
| 立証可能性 | 主張が対象HEADから再確認できるか | **finding** | **R1-B05。fileの`afterSha256`はHEADのどのcommitにも存在しないblobを指す。** 現在の証拠からは真偽を判定できない。**「欠陥がない」ではなくfail-closedでは未立証である** |
| ロールバック | 復旧参照、状態保持、再開可能性 | **finding** | **R1-N01・R1-B03。merge後は戻せない。** `rollback` fieldへ「次versionの新規proposalとして前進させる」と記録したが、**これは復旧ではなく前進である。** さらに、適用前に差し替える場合の版数を当初「11」と誤記していた（R1-B03） |
| 範囲漏れ | 呼び出し元、利用側、配布物、文書 | **finding** | **R1-N02・R1-B01・R1-B04。`afterSha256`はPR-2の最終byteに依存する。** PR-2のreviewで`scripts/check_project_quality.ts`の修正が必要になれば不一致となり、**同じ`9→10`の代替proposalを追加登録することになる**（trusted版は適用まで9のままである） |

## 5. 指摘

| ID | 重大度 | 内容 | 証拠 | 影響範囲 | 対応 | 状態・分類 | 残存リスク |
|---|---|---|---|---|---|---|---|
| R1-N01 | Low | 登録のmergeが不可逆点である | `readProposalRegistry`はproposalの削除を拒否し、`validateTrustedQualityMigration`は版の減少も受理しない | registry | 記録のみ。0節・6節・11節で開示する | valid（記録） | **merge後の取り消しはできない** |
| R1-N02 | Medium | `afterSha256`がPR-2の最終byteに依存する | `validateTrustedQualityMigration`の`actualChanges`照合 | PR-2 | 登録前に是正を完成させ、lint・format・typecheck・全1388 testを通してbyteを固定した。**この固定が正しいことはPR-2でしか機械照合されない**（R1-B05） | valid（対象外） | **PR-2のreviewで製品fileの修正が出れば代替proposalの追加登録が要る** |
| R1-B01 | High | 検証範囲を実態より広く書いていた。`npm run quality`を「配布物を内包」と記載し、`npm run package:check`合格を実行証拠なしに主張していた | `package.json`の`quality`は`lint && format:check && typecheck && source:check && test`であり`package:check`を含まない | 本artifact | **`npm run package:check`を実際に実行し（342件で合格）、1節と7節へ個別の行として記録した。** `quality`の説明も実態へ直した | resolved | なし |
| R1-B02 | High | 「#1002で実測済み」が原資料と一致しない | #1002の登録commit以後にregistryは変更されていない | 本artifact | **正しい実例へ差し替えた。** `TQP-POC-SANDBOX-CI-001`（`2a3bfae0`）と`TQP-POC-SANDBOX-CI-APPARMOR-001`（`6bd96b85`）は同じ`8→9`・同じ`ci.yml`・同じbefore hashでafter hashだけが異なる | resolved | なし |
| R1-B07 | High | **R1-B02の1度目の是正が誤っていた。** 「再登録された事例を特定できない」と書いたが、上記の実例が存在する。しかも同じartifactのR1-B03が`8→9`の2件共存を根拠に使っており内部矛盾していた | `git show 6bd96b85`と2件のtarget hash比較 | 本artifact | 実例で置き換えた。**是正が誤っていた事実自体をこの行に残す** | resolved | なし |
| R1-B05 | High | fileの`afterSha256`が対象HEADから検証できない | `edc2d9b9…`のdigestを持つ`scripts/check_project_quality.ts`は、現在のtree・全reachable版・unreachable blobのいずれにも存在しない | proposal | **`afterSha256`の一致を「確定済み」と書くのをやめ、未立証であることを明記した。** 再現手順を11節へ記載する | valid（記録） | **未検証のafter hashをmergeする行為は不可逆である** |
| R1-B03 | High | 適用前に差し替える場合の版数を「11」と誤記していた | `proposal.fromVersion !== trustedVersion`（`scripts/check_project_quality.ts:467`）は**現在の**trusted版を基準にする。適用前のtrusted版は9のままなので、代替proposalも`9→10`でなければ拒否される。**registryには`2→3`が2件、`8→9`が2件、実際に共存している** | 本artifact | 5節・11節を実態へ直した。**proposal本体の`rollback` fieldは適用後の話をしており元から正しい** | resolved | なし |
| R1-B06 | Medium | proposalの`rationale`が「例外は契約違反」を一般化していた | 実際には`readProposalRegistry`が不正registryを例外で拒否する。artifact自身も4節でそれを認めている | registry | **記述fieldなので更新した。** 「保護対象fileの読み取り失敗に限り」と範囲を限定し、「registry自体のschema違反を例外で拒否する既存の扱いは変えない」と明記した | resolved | なし |
| R1-B04 | High | SCN-UNIT-QUALITY-008・009が本登録データを検証すると書いていた | 両scenarioは`this.temp()`の一時rootへ**独自のfixture registryを書き込んで上書きする**（`test/steps/unit.steps.ts`）。今回追記した実entryを意味的に検証しない | 本artifact | **実entryを`checkProjectQualityContract(H_final, a1a39f1b)`で直接検証し`{"valid": true, "errors": []}`を得た。** 1節・2.1節・7節へ記録した。既存2 scenarioの役割は「手順そのものの受理側と拒否側の担保」に限定して書き直した | resolved | なし |
| R1-N03 | Medium | PR-2の変異試験結果を`H_final`から監査できない状態で根拠に使っていた | mutation内容・command・各結果がartifactに無く、patchは一時領域にしかない | 本artifact | **`afterSha256`安定性の根拠から外した。** 7.1節は「PR-2で実施し、そのreview artifactが正本として記録する」とだけ述べる | resolved | なし。**監査不能性そのものはR1-B05が残存リスクとして所有する** |
| R2-N01 | Low | artifact自身の点検 | ラウンド数と残り予算を先に書き、記述誤り4件の是正を隠していない | 本artifact | 記録のみ | valid（記録） | なし |

## 6. ラウンド固有の確認

### commit前のconsultation（review roundではない）

**記録するreview roundを1つに保つため、commitの前に独立reviewerへ2度consultationを行った。** いずれも`H_impl`確定前または本artifact確定前の点検であり、`review-session.json`のroundとしては記録しない。findingの`source`は`consultation`である。

- **1度目**: 4件のblocking（R1-B01〜R1-B04）と3件のrecord-only（R1-N01〜R1-N03）。**すべてが「artifactが実態より良く書いている」型で、proposal本体の値には誤りが出なかった。**
- **2度目**: 1度目の是正を対象にした再点検。**R1-B02の是正自体が誤っていた**ことを検出した（R1-B07）。加えてR1-B05（after hashが対象HEADから検証不能）とR1-B06（`rationale`の過度な一般化）を検出した。
- **指摘を鵜呑みにせず全件を自分で実測した。** `quality`の実内容、`fromVersion`の基準、同一版proposalの共存、既存10件の不変、`package:check`の結果、実entryのvalidator結果、そして`2a3bfae0`と`6bd96b85`の2件のtarget hash比較をそれぞれ独立に確認した。**すべての指摘が正しかった。**

### ラウンド1

- 全評価基準を確認した: **はい。** 肯定5観点と敵対9観点を`H_final`へ適用した。reviewerはcodexで、read-only sandboxで起動した。**codexへ渡したreview契約fileには`.claude/hooks/asc-contract-citation.sh`が要求する`## 規範の引用`節を設け、REQ-SQ-006とREQ-SQ-012と運用ポリシーの縮小規定を原文で引用した。** 本artifactではなく契約file側の話である。
- 指摘を確定した: **未解決のblockingなし。** 5節の8件はすべてcommit前のconsultationで確定し、本artifactと`rationale`へ畳み込み済みである。
- 全指摘の最終分類: **8件。resolved 6件（R1-B01・R1-B02・R1-B07・R1-B04・R1-B06・R1-N03）、valid 2件（R1-N01は記録、R1-N02は対象外）、加えてR1-B05をvalid（記録）とする。** 内訳の合計は9件で、R1-B03はresolvedである。
- 修正差分: 本artifactと`.github/trusted-quality-proposals.json`の`rationale`（記述field）。**契約field（`proposalId`・`status`・`fromVersion`・`toVersion`・`targets`）は1文字も変えていない。**
- 任意の危険範囲を除外・既定無効・ロールバック可能へ縮小した結果: **縮小した危険範囲はない。** 保護境界を1件も広げていない。
- 同じ範囲の予算を自動更新していない: **成立する。** 総1ラウンドで打ち切り、2を残す。
- AIによる最終裁定: **approved。**

## 7. テスト結果

| 層・検査 | コマンド | シナリオ・件数 | 成功 | 失敗 | スキップ | 判定 |
|---|---|---:|---:|---:|---:|---|
| 形式 | `npm run docs:format` | 1 | 1 | 0 | 0 | pass |
| lint・format・型・source品質・全test | `npm run quality` | 1388 | 1372 | 0 | 16 | pass |
| 配布物 | `npm run package:check` | 1 | 1 | 0 | 0 | pass（342件） |
| 監査 | `npm run audit:check` | 1 | 1 | 0 | 0 | pass |
| **実entryの受理** | `checkProjectQualityContract(H_final, a1a39f1b)` | 1 | 1 | 0 | 0 | pass（`errors: []`） |

### 7.1 変異試験

**本PRでは行っていない。理由を述べる。**

本PRはcodeを1行も変更しておらず、変異させる判定logicが差分に存在しない。**registry dataへの変異は、`readProposalRegistry`と`validateTrustedQualityMigration`という既存の検証logicが受理するか拒否するかを見ることになり、それは本PRが変更していない既存機構の検査である。**

**SCN-UNIT-QUALITY-008・009 が担うのは「二段階手順そのもの」の受理側と拒否側であって、今回追記した実entryではない。** 両scenarioは一時rootへ独自のfixture registryを書き込んで上書きするため、実entryを意味的に検証しない（R1-B04）。**実entryの受理は`checkProjectQualityContract(H_final, a1a39f1b)`を直接実行して確かめた。**

**是正本体の変異試験はPR-2で行い、そのreview artifactが正本として記録する。** ここでその結果を`afterSha256`の安定性の根拠に使わない（R1-N03）。**現時点では`H_final`から監査できないためである。**

## 8. 配布物影響

| 変更path | 配布境界に入るか | 影響 |
|---|---|---|
| `.github/trusted-quality-proposals.json` | 入らない | `package.json`の`files`は`dist/bin/`・`dist/src/`・`dist/vendor/`等を列挙し、`.github/`を含まない |
| `docs/reviews/103_課題1017保護対象読み取り診断のproposal登録レビュー.md` | 入らない | なし |

判断: 配布物を更新しない

根拠: 変更した2 pathはいずれも`package.json`の`files`が列挙する配布境界の外にある。**codeを1行も変更していないため`dist/`の内容も変わらない。** `npm run package:check`を実際に実行し、`実行・配布ファイル342件`で合格することを確認した。**`npm run quality`はこの検査を内包しないため個別に実行した。**

## 9. 独立reviewの成立

| 項目 | 内容 |
|---|---|
| 独立reviewの外部証拠 | Step 11のPR作成後に観測する |
| reviewerがPR author・実装commit authorと異なる | codexは別provider・別contextで異なる |
| 観測したreview commentとapprovalの件数 | Step 11で観測する |

**外部reviewerのcheckがpassでもreview commentとapprovalの実体を観測する。** 両方0件だった場合だけ`RVX-REPORTED-SUCCESS-WITHOUT-REVIEW-001`の条件に当たる。**現時点では例外を適用していない。**

## 10. 仕様整合性

- 判定: no-spec-impact
- 更新した仕様: なし。
- ドメイン用語台帳の候補・確定・現在有効な定義が一方向に追跡できる: **用語の追加・変更・廃止はない。** TERM-ASC-003を参照するだけである。
- 未定義語、同一コンテキスト内の重複定義、根拠なしの意味変更、表記揺れ、置換先なしの廃止がない: **成立する。**
- 要件・変更・SCN・テストの追跡: REQ-SQ-006・REQ-SQ-012 → AC-SQ-006・AC-SQ-012 → SCN-UNIT-QUALITY-008・009 → `scripts/check_project_quality.ts`（**本PRでは変更しない**）。
- `no-spec-impact`の場合の限定的根拠: **REQ-SQ-006「品質契約変更はtrusted proposalの二段階適用に限定する」とREQ-SQ-012が本手順を既に所有している。** 本PRはその手順の実行例を1件足すだけである。**ただし「振る舞いに差分が無い」は厳密には強すぎる。** 登録により、将来の`9→10` candidateのうち本proposalのhashに完全一致するものを許可するauthority集合が増える。要件本文が述べる手順そのものは変わらないため`no-spec-impact`と判定するが、この点を隠さず記録する。**是正本体の仕様影響（REQ-SQ-030の新設）はPR-2が持つ。**
- UI・トークンの判断: UI無し。tokenは`not-applicable`。

## 11. 総合判定と再開地点

- 未解決Critical/High: **なし。** commit前のconsultationで確定したblockingはすべて`H_final`へ畳み込み済みである。
- Medium/Lowの記録: R1-N01（mergeの不可逆性）、R1-N02（after hashのPR-2依存）、R1-N03（PR-2変異試験の監査不能）、R1-B05（after hashの立証不能）。
- 判定: approved
- 新しい権限が必要な事項: **なし。** 品質契約の版上げはrepository ownerが2026-09-02に承認済みである。
- 残存リスク: **5件。**
  1. **登録のmergeは不可逆である。** 取り消せず、戻す場合も新規proposalとして前進させるしかない。
  2. **fileの`afterSha256`は本PRの`H_final`から立証できない。** `edc2d9b9…`のdigestを持つ`scripts/check_project_quality.ts`はどのcommitにも存在しない。**これは二段階適用という機構の性質であり本PR固有の欠陥ではないが、「欠陥がない」ではなくfail-closedでは未立証である。** 照合はPR-2で`validateTrustedQualityMigration`の`actualChanges`が行う。**再現手順**: PR-2のheadで`sha256sum scripts/check_project_quality.ts`を取り、本proposalの`afterSha256`と一致することを確認する。
  3. **`afterSha256`はPR-2の最終byteに依存する。** PR-2のreviewで`scripts/check_project_quality.ts`の修正が必要になれば不一致となる。**その場合に登録するのは同じ`9→10`の代替proposalである**（trusted版は適用まで9のままで、`proposal.fromVersion !== trustedVersion`が現在版を基準にするため）。`TQP-POC-SANDBOX-CI-001`と`-APPARMOR-001`がその実例である。
  4. **PR-2で実施した変異試験の結果は、本PRの`H_final`からは監査できない。** PR-2のreview artifactが正本として記録するまで外部からは検証できない。
  5. **`npm run package:check`の出力はHEADへ耐久化されていない。** 独立の再確認はCIの同名jobが行う。
- 次に許可される操作: Step 11のPR作成。
- 次回の再開地点: `pr create`。
