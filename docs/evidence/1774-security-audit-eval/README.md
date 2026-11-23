# Security Audit方式（攻撃面coverage・独立反証・検証不能の区別）の評価と採否（#1774）

開発時の検証資料であり、配布対象に含めない。記載のcommit・版に対する記録で、現行仕様の正本ではない。通常のASC実行時に読み込ませない。

## 結論

**不採用とする（現行の独立レビューで十分）。** Cloudflare Security Audit方式から、次の3つを取り込む案を評価した。
- 攻撃面のcoverage ledger
- 候補ごとの独立Verifierによる反証
- confirmed／needs_validation／rejectedの三値判定

いずれもASCの`review-and-remediation`に足す根拠を得られなかった。同義の`security-audit` Skillも配布しない。Skill・referenceへの変更は無い。

固定goldの2ケースで、A（現行ASCの独立レビュー）とB（Cloudflare方式の最小手順）を各3回比べた。根拠は次のとおり（数値は「Phase 1の結果」）。
- **検出の増分が無い**：Aは真の欠陥を24/24件検出した（小ケース15/15、規模ケース9/9）。critical欠落、検証不能の誤昇格、誤検知はいずれも0件だった。Bの探索段（coverage ledgerを作るHunter）も、検出の上積みは無かった（23/24件）。
- **独立反証の段も、検出・判定を改善しなかった**：Hunterが正しく出した候補を、Verifierは再確認しただけだった。seed版の規模ケースでは、3回×3件の9件全てをconfirmedにした（Phase 1c）。
  - 最初の規模ケースでは、Verifierが真の欠陥2件をrejectedにした（「storeに書き込むcodeが無い」が理由）。seedを足した版では、同じ候補が全てconfirmedになった。この2件は、fixtureの不備による交絡と判断した。
  - 小ケースのT4のrejectedは、goldの妥当性に争いがある（「goldの争点と感度」）。
  - 以上から、Verifierが品質を下げたとは結論しない。上げたとも言えない。
- **費用が大きい**：Bの最終結果まで進めると、1回あたりのsubagent tokenはAの約3.1〜5.4倍、壁時計は約1.9〜2.0倍になった。

Verifierに有利な材料も1つある。Aの3回はいずれも、SSRF候補（T4）の根拠に、userinfo形式のURL（`https://docs.example.com@10.0.0.5/`）で内部hostへ到達できるという誤った事実を含んでいた。影響も「内部hostを含む任意のhost」と過大に書いていた。
- この誤りは、Phase 2のsandbox実行で確定的に反証した。Node 22の`fetch`はこのURLを`TypeError`で拒否する。
- T4の候補を受けたBのVerifier 2回は、どちらもこの誤りを指摘した。B1は影響を絞ってconfirmedに、B3はrejectedにした。
- 静的な根拠として断定した事実が誤っていたので、これは`review-method.md`の「再現済み、静的な根拠、未確認の懸念を区別」が十分に働かなかった例である。ただし`score.mjs`は判定だけを採点し、根拠と影響の正確さを測っていない。この効果の大きさは欠測である（「欠測と限界」）。
- 1件の事例で、Verifierの段（tokenが3倍以上）を常設する根拠にはならない。

Phase 2では、DockerのOSレベルの制限で、Cloudflareが対象コードの実行に求める制御を一通り強制できた。反例も全て拒否された。合成fixtureでは、この中で最小のPoCを安全に実行できた。ただし、この実行手順をASCへ配布するかはownerの判断に当たる。本PRでは配布せず、記録にとどめる（「ownerの判断事項」）。

## Phase 0：現行ASCとの差分と必要性

### 記録

| 項目 | 値 |
| --- | --- |
| 評価のbase | `db3ca9da9adb74fe4f76fdf6b5411945fc463247`（origin/main） |
| ASC版 | package.json `0.5.0` |
| Host／OS | Claude Code 2.1.323、macOS 26.7.3（x86_64）、Docker Desktop 29.8.0（linuxkit 7.0.12、cgroup v2） |
| 読んだ規約 | `skills/review-and-remediation/SKILL.md`・`references/review-method.md`、`skills/security-evidence/SKILL.md`・`references/findings-and-summary.md`、`skills/asc/references/review.md`・`implementation.md`、`skills/project-foundation/references/verification-and-security.md`、ADR 0002・0005（`verification-optimization`は責務外として確認のみ） |

### 外部入手物（Cloudflare）の記録

`cloudflare/security-audit-skill`のcommit `c1c8a8c1471069fb0e188eeaff69b8e8db6564a8`（2026-09-14、MIT License、Copyright 2025-2026 Cloudflare, Inc.）を、作業用の一時directoryへcloneして読んだ。ASCへはコピーしていない。script（`validate-*.cjs`）は実行していない。主なfileのSHA256は次のとおり。

| file | sha256 |
| --- | --- |
| `SKILL.md` | `5e3e96a1e438d8f35fef0a1e38f02d4f00e2bdf910401b7dfe00e6779c6dac85` |
| `RECONNAISSANCE.md` | `02ca887aca84de8ae137f1891bd2f0a54f28d3fa6da92a27f54734382b3381a2` |
| `HUNTING.md` | `71c121decea1322c47c718f6e110f1a892980bb4266bd7ac55ef043a213ade09` |
| `VALIDATION-AND-REPORTING.md` | `b892470cb89bb31f33403e050d4bdfbe2cdaef940ade1496fa65e32b2e129449` |
| `report-schema.json` | `6575c9de4a62255699ea052ebf9a49ebfb373a32891bcd89af6f55cc84b35519` |
| `validate-findings.cjs` | `e85f232e36bfac0f866f244da50376692d6b45c690beadcb00608b0e6c8b5283` |
| `validate-coverage-ledger.cjs` | `2eb280bd2e33c002916f86db9b29f9edfedb6454e5db973c766290465b868ac8` |

原典の契約で、評価に関係する点：
- guidance modeが既定で、full audit modeは明示の監査依頼のときだけ使う。
- full auditは6段階（reconnaissance→coverage-led hunting→候補の独立検証→`findings.json`→記録の独立再検証→report）。
- 対象コードを実行するには、OSが強制するsandboxが必須である。条件は、外部network無し、空の環境変数に必要なものだけを足すこと、targetとtoolchainの読取り専用、scratch以外への書込み禁止、資源上限。満たせなければ実行せず`needs_validation`とする。
- 出力の既定は`~/security-audit-skill/<repo>/run-<N>`（host home）である。成果物の昇格は、親側のno-follow・fd基準の手順に限る。
- 2つのvalidatorは依存0のNode script（`fs`・`path`・`util`のみ）で、構造を検証するだけである。脆弱性の存在は証明しない。
- READMEには「単一runで、反復runが合計で見つけた脆弱性の約半分を発見した」とある。同社の大規模harnessと、このSkillは別物である。

### 現行ASCが保証する範囲と、保証しない範囲

| 成果 | 現行ASC | 根拠 |
| --- | --- | --- |
| 差分の独立レビュー（信頼境界・認可・入力から副作用まで） | 保証の対象 | `review-method.md`の「セキュリティ」観点、入力検証・認可の確認、差分外の防御を反証として確認する規則 |
| 静的な根拠・再現済み・未確認の懸念の区別 | 保証の対象 | `review-method.md`「再現済み、静的な根拠、未確認の懸念を区別し、未実行テストを再現済みとしない」 |
| 依存・imageの脆弱性監査と証跡 | 保証の対象 | `security-evidence`（依存auditはSAST・認可試験の代替ではないと明記） |
| repository全体の攻撃面の棚卸し（coverage ledger） | 規定なし | 明示の監査依頼でも、レビュー手順が全体を対象にするだけで、ledgerは作らない |
| 発見者と別Contextによる候補ごとの反証 | 規定なし（レビュー全体の独立性はある） | 独立Reviewer 1系統が既定。指摘の成立確認は進行役が行う |
| 対象コードを実行する攻撃の成立確認 | 規定なし | `implementation.md`はDockerの後始末（label・`--rm`）を定めるが、未信頼コード用の制限は定めない |

下3行が原典との差分で、新機能の候補になり得る。そのためPhase 1で実測した。用語を置き換えただけの重複ではない。差分は次の3つである。
- 差分ではなく、repository全体を明示的に監査する。
- 候補ごとに独立して反証する。
- 実行による確認と、その安全境界を設ける。

### 既存Issueとの照合

- #1442（CLOSED、NOT_PLANNED、2026-10-18）：SAST等の統合層。具体的な取りこぼしが無いため、採用しないと決めた。本件もtoolの統合ではなく、方式の評価に限った。
- #1439（CLOSED、COMPLETED）：レビュー高度化の中長期候補。loopback限定・非永続の前提を維持する。本件の評価も、同じ前提で読取り専用のsubagentを使った。
- #1732（CLOSED、COMPLETED）：CIの構成。本件はCIに検査を足さない。
- #1766（CLOSED、COMPLETED、PR #1770）：改善案を固定評価で比較する方式。本件はその方式に従った。#1766の基盤は使っていない。
- #1773（OPEN、別担当が並行中）：外部Skill・MCPの供給網評価。本件ではCloudflare由来物を配布しないため、#1773の結果に依存しない。書込み先も重ならない（本directoryだけに書いた）。

## Phase 1：固定goldによる検出・反証の比較

### 条件と固定したもの

| 項目 | 値 |
| --- | --- |
| 小ケース | [make-fixture.mjs](make-fixture.mjs)が生成する多tenantのnotes API（17 file）。git treeは`77c066a3b67ae11f9e82f806d4c2d17f918bddee` |
| 小ケースのgold | [gold.json](gold.json)（sha256 `a440cd6167319b620dd723cc87e86f59892837e072b2aac96a582cf86d23dba9`）。commit `c7057b0d`で、実行前に固定した |
| 規模ケース | [make-fixture-scale.mjs](make-fixture-scale.mjs)が生成する、似た形の36 resource moduleを持つAPI（47 file、約1,300行）。git treeは`a0df5a1593b3abe524d5ea0f1f3ae0df196cf8b8` |
| 規模ケースのgold | [gold-scale.json](gold-scale.json)（sha256 `f5f340462b854639c7ea22c68dd3f7039328fd6896f25a0e29ffdd282a171666`）。commit `531d2c29`で、実行前に固定した |
| 評価Agent | Claude Code 2.1.323の`general-purpose` subagent。model指定は`opus`（Opus 5.5）。fixtureとguideのpath以外は読まないよう指示した |
| seed版（Phase 1c） | `make-fixture-scale.mjs <dir> --seed`。resource moduleは規模ケースと同一で、`src/store.mjs`の変更と`src/seed.mjs`（各storeにtenantごと1件）の追加だけが違う（48 file）。git treeは`689254d076b0683e27fc0c31ce96b5c1be84739e`。generatorはcommit `223c00ad`で、実行前に固定した。goldは`gold-scale.json`をそのまま使う |
| 反復 | 各ケースでA×3回、B（Hunter）×3回。各条件の3回は並列に起動した。Phase 1cでは、規模ケースのHunter 3回の候補（S1〜S3）を、seed版に対してVerifierで3回ずつ反証した |
| 採点 | [score.mjs](score.mjs)が、[runs.json](runs.json)（sha256 `3b3e7c37735d8108ce10d8d275900257e3fdf4a723b3b19f4b85dc5225df2b3d`）を採点する。再現は本directoryで`node score.mjs` |
| 原データ | 42件の評価Agent（Phase 1cの9件を含む）の最終応答を、Hostのsubagent記録から機械的に抜き出した[raw-outputs.json](raw-outputs.json)（sha256 `392bddd2cfb449810fb23489aff08d9f324cb19b7f02c06c79a346f7b69432f1`）。keyはruns.jsonの`agent`、fixtureの絶対pathは`<FIXTURE>`に置換した |

goldの内容：
- 小ケース（10項目）：
  - 真の欠陥5件：T1 tenant越えの読取り、T2 path traversal、T3 webhookのreplay、T4 URL許可リストのprefix照合、T5 `pull_request_target`による秘密の露出。T1・T2はcriticalとした。
  - 検証不能1件（NV1）：support用の偽装headerが、本番で有効かどうか。confirmedと判定したら誤昇格とした。
  - 負例4件：N1 認可はmount側にある、N2 containmentが正しい、N3 ORDER BY列がallowlist、N4 hardeningのみ。
  - T3〜T5は、confirmed・needs_validationのどちらも正答とした（判定に必要な事実の一部がrepository外にあるため）。
- 規模ケース（6項目）：
  - 真の欠陥3件、全てcritical：S1 queryのtenant値で照合、S2 DELETEにscope無し、S3 managerの分岐にtenant照合無し。
  - 負例3件：SN1 inlineで正しく照合、SN2 仕様で全体公開、SN3 mountされていないdead code。

条件：
- **A（現行ASC）**：独立Reviewerとして、`review-and-remediation/SKILL.md`・`references/review-method.md`（必要なら`security-evidence`）の写しを読み、その手順でrepository全体をレビューする。判定は、同手順の区別（静的な根拠で成立／repository外の事実が未確認／既存の対策で反証）を三値に対応させる。
- **B（Cloudflare方式の最小手順）**：Hunter 1件と、Verifierを候補ごとに1件ずつ使う。
  - Hunter：攻撃面の把握、coverage ledger（攻撃面×信頼境界×攻撃類型）、candidate gate（低信頼の主体・越える境界・被害対象・最も強い既存の防御）、三値判定。
  - Verifier：Hunterのconfirmed・needs_validationの候補ごとに、別Contextで反証する。原典のcandidate-verifier promptを要約して使った。
  - 原典のfileは読ませていない。必要な手順だけを依頼文に要約した。
- **C（原典の6段階）**：実施しなかった。理由は「欠測と限界」に記す。
- 共通：読取り専用、fixtureの実行禁止（sandbox未承認のため静的のみ）、network禁止、出力は同じJSON形式。依頼文の全文は「依頼文」に記す。

### Phase 1の結果

`node score.mjs`の出力の要約：

| ケース・条件 | 真の欠陥の検出 | critical欠落 | 検証不能の正判定 | 誤昇格 | 誤検知 | token／回（平均） | 壁時計／回（平均） | Agent数／回 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 小・A | 15/15 | 0 | 3/3 | 0 | 0/12 | 56,177 | 66.3秒 | 1 |
| 小・B Hunter | 14/15 | 0 | 3/3 | 0 | 0/12 | 54,656 | 89.8秒 | 1 |
| 小・B 最終 | 13/15 | 0 | 3/3 | 0 | 0/12 | 304,726 | 126.6秒 | 6〜7 |
| 規模・A | 9/9 | 0 | – | – | 0/9 | 65,479 | 50.6秒 | 1 |
| 規模・B Hunter | 9/9 | 0 | – | – | 0/9 | 62,312 | 66.6秒 | 1 |
| 規模・B 最終（1回のみ） | 1/3 | 2 | – | – | 0/3 | 262,733 | 81.8秒 | 5 |
| seed版・B 最終（Phase 1c） | 9/9 | 0 | – | – | 0/9 | 201,990 | 101.7秒 | 4 |

B最終の壁時計は、Hunterの時間に、並列に起動したVerifierのうち最長の時間を足した値である。seed版の行は、規模ケースのHunterの値（token・時間）に、seed版で実行したVerifierの値を足したものである。seed版でのAの再実行はしていない。Aの値は規模ケースのものを比較に使い、tokenは約3.1倍、壁時計は約2.0倍となる。

観察：
- **coverage ledgerは検出を増やさなかった**：
  - 規模ケースでも、Aは36 module中の3件の逸脱を3回とも検出した。dead code（SN3）の除外もできた。
  - BのHunterはledgerに全moduleを記録した。正規化hashで同形のmoduleをまとめて確認した回もある。ただし、検出結果はAと同じだった。
  - B2のHunterは、小ケースのT4をrejectedにした（userinfo形式が通らないこととTLS検証を根拠に、境界の越えが無いと判断）。
- **独立反証は判定を改善しなかった**：
  - 小ケース：B3のVerifierがT4をrejectedにした。B1のVerifierは、userinfoの誤りを除いて影響を絞ったうえでconfirmedとした。T4については、goldの妥当性に争いがある（次項）。
  - 規模ケース：B1のVerifier 4件のうち3件が、「このstoreに書き込むcodeがsourceに無い」ことを「前提が成立しない」とみなし、rejectedにした。対象はS1・S2（真の欠陥）と、Hunterのneeds_validation 1件である。S3のVerifierは同じ点を指摘したうえで、通常のdata状態の仮定としてconfirmedにした。
  - 原因は、候補になった3 module（invoices・attachments・reports）のstoreに、作成経路（POST）もseedも無いという、fixtureの不備だった（`make-fixture-scale.mjs`の特別扱いの分岐。ほかにもPOSTの無いmoduleがあるが、候補にはなっていない）。そこで計画を変え、seedを足した版（Phase 1c）でVerifierを3回ずつ実行した。結果は9件全てconfirmedで、各Verifierはseedのidを使って到達経路を示した。
  - 以上から、最初の規模ケースの誤rejectedはfixtureの交絡であり、Verifier方式の品質低下の証拠とはしない。ただしデータ源がsourceの外にある場合、「impossible prerequisite」規則で真の欠陥を落とす経路は残る。実際のrepositoryでこの経路がどのくらい起きるかは測っていない。
- **検証不能の区別は、両条件とも正しかった**：偽装header（NV1）は、6回中6回でneeds_validationとなった。根拠は「本番でenvが`on`か」という同じ未確認事実で、誤昇格は0件だった。
- **目的外の指摘**（goldに無い項目。runs.jsonの`extras`）：
  - 規模ケースの「reportのDELETEは編集に当たるか」：Aの2回とBのHunter 3回が、needs_validationとした。READMEが「edited」としか書いていないため、仕様の未決として妥当である（fixtureの記述が曖昧だった）。
  - A2の1回は、`SESSION_SECRET`の乱数fallbackを、境界の越えが無いと自ら書きながらneeds_validationにした。needs_validationの誤用（hardeningに入れるべき）として1件と数える。誤検知の数には含めない。
- **根拠・影響の誤り**：T4の根拠に、userinfo形式が内部hostへ届くという誤った事実を含んだ回数は次のとおり。`score.mjs`は判定だけを採点するので、表の数値にはこの差が出ない。
  - A：3回中3回（影響を「内部hostを含む任意のhost」とした）。
  - BのHunter：3回中2回。
  - Bの最終結果：0回（B1のVerifierが訂正し、B3はrejectedにした）。

### goldの争点と感度

- **T4**：固定したgold（`gold.json`のT4の`claim`）自体にも、userinfo形式（`https://docs.example.com@internal/`）で到達できるという誤った例が含まれていた。Phase 2の実行で、このURLは`fetch`で失敗することを確認した。goldのfileは実行前に固定したため直さず、ここに誤りを記録する。
  - 残る影響は「member自身が指定した、攻撃者所有のhostへのHTTPS取得」と「到達性のoracle」で、境界の越えは弱い。
  - goldはconfirmedとneeds_validationを正答としたが、rejectedにも根拠がある。
  - T4を採点から除くと、小ケースの検出はA 12/12、B最終12/12で、差は無い。
- **S1〜S3**：規模ケースの生成物（seed無し）では、invoices・attachments・reportsのstoreに書き込む経路が無い。そのため`gold-scale.json`の主張は、実行時には到達しない潜在的な欠陥（code上の欠落）としてだけ成立する。seed版（Phase 1c）では到達でき、B最終もAと同じ9/9になった。

どちらの読み方でも、判定の採点でBがAを上回る結果は無い。Bに有利な点は、根拠・影響の誤りを訂正したこと（T4の1事例）だけである。

## Phase 2：監査用の実行境界とEvidenceの安全

### 制限の強制と反例

使い捨てのcontainer（`node:22-alpine`、image ID `sha256:8049382e2048cff27289992d304206b4208b5b4f5110a19a5dbe21c18a0b8603`、linux/amd64）を、次の設定で起動した。`<fixture>`は作業用の一時directory、`<probe>`は本directoryの`probe/`、`<worktree>`は本worktreeの絶対pathである。

host側の手順は[probe/run-sandbox.mjs](probe/run-sandbox.mjs)にある。`node probe/run-sandbox.mjs <秒> <fixture> <worktree> -- <nodeの引数>`で、次を一度に行う。
- 起動
- 壁時計の上限での`docker kill`
- 出力の取得（64KiB上限）
- `docker rm -v`による削除

再実行した出力は[probe/results.txt](probe/results.txt)に、そのまま保存した。独立再レビューの指摘L-cのうち、次の2点はCodeRabbitの指摘とあわせてcodeを直した。
- `docker wait`の失敗時も、containerを削除する（`finally`）。
- Dockerのlogの大きさに上限を設けた（`max-size=1m`）。

残る制約は次の2つである。
- imageはタグで指定していて、digestで固定していない。実行時のimage IDは、この節の冒頭に記録した。
- `<fixture>`引数を検査しない。homeや秘密を含むdirectoryを渡さないことは、呼び出す側の責任である。

下の結果は全て、このrunnerで再実行して確認した（独立レビューの指摘L2・L3の是正後。最初の実行は同じ設定のshell scriptで行い、外部network probeの宛先が`1.1.1.1`だった）。

```sh
docker run -d --label asc.worktree=<worktree> --network none --ipc none --read-only --cap-drop ALL \
  --security-opt no-new-privileges --user 65534:65534 --pids-limit 64 --memory 256m --memory-swap 256m \
  --cpus 0.5 --ulimit fsize=4194304 --ulimit nofile=256 \
  --log-driver json-file --log-opt max-size=1m --log-opt max-file=1 --entrypoint node \
  --tmpfs /scratch:rw,size=16m,mode=1777 -e HOME=/scratch -w /scratch \
  -v <fixture>:/target:ro -v <probe>:/probe:ro node:22-alpine <args>
```

壁時計の上限は、hostの監視が`docker kill`で強制する。終了後に、出力（64KiB上限）を取得してから、`docker rm -f -v`で削除する。待機やlogの取得に失敗しても、`finally`で必ず削除する。ホームディレクトリ・秘密・socketはmountしていない。

CodeRabbitの指摘で、次の2点を直した。
- 最初の設定（`--ipc none`無し）では、`/dev/shm`がscratch以外の書込み先として残っていた。非rootでも`/dev/shm/x`への書込みが成功することを確認した（`probe/results.txt`の末尾）。`--ipc none`を足し、書込みが拒否されることを再確認した。
- `docker wait`の失敗と、Dockerのlogの大きさの上限が無いことも直した。このため、表は修正後のrunnerで再実行した結果である。

[probe/limits.mjs](probe/limits.mjs)・[probe/mem.mjs](probe/mem.mjs)の結果：

| 制御 | 反例 | 結果 |
| --- | --- | --- |
| 外部network | `fetch('http://192.0.2.1/')`（TEST-NET。隔離を誤っても実在のhostへは送らない） | `ENETUNREACH`で拒否 |
| target・probeの読取り専用 | `/target`・`/probe`への書込み | `EROFS` |
| root fsの読取り専用 | `/etc`への書込み | `EROFS` |
| scratchだけ書込み可 | `/scratch`への書込み | 成功 |
| scratch以外の一時領域への書込み禁止 | `/dev/shm`・`/tmp`・`/var/tmp`への書込み | `/dev/shm`は`ENOENT`（`--ipc none`でmountされない）、`/tmp`・`/var/tmp`は`EROFS` |
| fileの大きさの上限 | 8MiBの書込み（上限4MiB） | `EFBIG` |
| 環境変数のallowlist | 一覧 | `HOME,HOSTNAME,NODE_VERSION,PATH,YARN_VERSION`のみ。entrypointをshにすると`PWD`・`SHLVL`が加わったため、`--entrypoint node`に変えて再確認した |
| 非root | uid | 65534 |
| host homeの非露出 | `/Users` | 存在しない |
| process数の上限 | 200個のfork | `can't fork` |
| memoryの上限 | 16MiBずつ確保 | 約240MiBで終了（exit 137） |
| 壁時計の上限 | 30秒待つprocessを5秒上限で起動（`node run-sandbox.mjs 5 … -- -e 'setTimeout(…,30000)'`） | 5.7秒で`docker kill`、exit 137（`wallClockKilled: true`） |

`limits.mjs`のmemory項目は、子processが20秒のtimeout（SIGTERM）で止まっていた。CodeRabbitの指摘を受け、SIGKILL以外の終了は`unverified`と出力するように直した。再実行の結果も`unverified`だったため、上限の証拠は`mem.mjs`（exit 137）だけである。

### 最小のPoC（ダミーデータ、loopbackのみ）

[probe/poc.mjs](probe/poc.mjs)は、container内のloopbackでfixtureのserverを起動し、u1（tenant t1）のtokenで要求する。

| 項目 | 結果 |
| --- | --- |
| T1：`GET /notes/n2` | 200、本文のtenantは`t2`。confirmedを実行で確認 |
| T2：`/export?name=../t2/report.csv` | 200、t2のダミーCSVを返した。confirmedを実行で確認 |
| N2：`/avatars/..%2Fexports%2Ft2%2Freport.csv` | 400。負例を実行でも確認 |
| T4：`new Request('https://docs.example.com@10.0.0.5/')` | `TypeError`。tool経由の呼出しは500。userinfo形式の主張を反証 |
| T4：`https://docs.example.com.attacker.test/` | Requestは生成できる（prefixの回避自体は成立。外部への送信は行っていない） |
| fixtureのtest：`node --test /target/test/auth.test.mjs` | 2件成功。directory指定の`--test /target/test/`は1件失敗で、原因は調べていない（fixtureのtestであり、評価の結論には使わない） |

実行後、fixtureのgit状態は変わっていない（`git status --porcelain`が0行）。

### Evidenceと成果物の昇格

containerからは、stdoutのJSON行（上限64KiB）だけを親が受け取った。scratch内のfileは昇格させず、tmpfsごとcontainerと一緒に破棄した。原典のno-follow・fd基準の昇格手順は実装していない。fileを昇格させる必要がある監査では、それが未充足の条件になる。成果物の保存先は本directoryだけで、host homeの既定（`~/security-audit-skill/...`）は使っていない。

### Phase 2の判断

- このHost（Docker Desktop、macOS）では、原典がsandboxに求める制御を、OSレベルで反例付きで強制できた。
- PoCは、静的レビューで残った根拠の誤り（T4のuserinfo）を確定的に訂正した。実行による確認には価値がある。
- 一方、確認の対象は合成fixtureの1ケースだけである。Linux本体やCI runner、ブラウザ・fuzzerを使う確認は検証していない。外部の本番・共有環境への試験は行っておらず、許可もされていない。

## Phase 3：採否

| 案 | 判定 | 根拠 |
| --- | --- | --- |
| 現行ASCのまま（独立レビュー＋security-evidence） | **維持** | 2ケース×3回で、真の欠陥24/24件を検出した。誤検知・誤昇格は0件、critical欠落も0件だった |
| coverage ledgerの規範を追加 | 不採用 | 検出の増分が0件。Hunterの壁時計は+32〜36% |
| 候補ごとの独立Verifierを追加 | 不採用 | 判定の採点で検出・誤昇格・誤検知の改善が0件（seed版では9/9をconfirmedにしただけ）。tokenは3.1〜5.4倍、壁時計は約2倍。Bに有利なのは、T4の根拠・影響の誤りを訂正した1事例だけで、常設の費用に見合う根拠にならない。最初の規模ケースの誤rejected 2件は、fixtureの交絡として根拠から外した |
| 三値判定の文言を追加 | 不採用 | 現行の「静的な根拠・再現済み・未確認の懸念」の区別で、NV1を6回中6回とも正しく判定した。誤用は1件で、規範を足して減るという根拠は得ていない |
| `security-audit` Skillを任意の別Skillとして配布 | 不採用 | 上の各要素に、実測で示せる追加価値が無い。原典の文書（6段階で読む本文だけで約94KB）を読み込む費用も増える |
| sandboxの実行手順を規範に加える | 本PRでは配布しない（ownerの判断事項。推奨は「今は配布しない」） | 制御の強制とPoCの効果は確認した。推奨の理由は次の3つ。(1) 確認したのは1 Host（Docker Desktop、macOS）だけである。(2) fileを昇格させる手順を実装していない。(3) 明示の監査依頼という需要がまだ記録されていない。配布するかは、利用者projectへの新しい実行規範なので、ownerの判断に当たる |

## 欠測と限界

- **C（原典の6段階）は未実施**：Bでは、独立反証の段が判定を改善しないまま、費用を3倍以上にした。Cはこれにcoverage critic・記録の再検証・Agentの追加を重ね、各Agentが原典の約94KB（概算で約2.3万token）を読む。そのためCでAを上回るとは見込めず、実験の規模の上限も考えて実施しなかった。
- **seed無しの規模ケースのB最終は1回だけ**：B1のVerifierが真の欠陥2件をrejectedにした後、原因がfixtureの不備だと分かったため、seed版で3回測り直した（Phase 1c）。seed無し版のB2・B3のVerifierは実行していない。
- **Phase 1cの範囲**：Hunterは規模ケースのものを再利用し、Verifierだけをseed版で実行した。HunterのextrasのreportのDELETE（needs_validation）は、再検証していない。seed版でのAは再実行していない（resource moduleが同一で、Aは規模ケースで既に9/9のため）。
- **Verifierが誤った候補を除く効果**：Hunterの誤検知は全回で0件だった。負例は全てHunterの段でrejectedになり、Verifierに渡っていない。そのため、Verifierの主な効果である「誤った候補の除去」は、効果が無かったのではなく、確かめる機会が無かった。測るには、Hunterが誤検知を出す程度に難しい負例を含むfixtureが要る。
- **seed版のB費用は下限**：seed版では、HunterのextrasのreportのDELETEを再検証していない。そのためseed版の行のtoken（4 Agent分）は、Bの費用の下限である。結論の向きは変わらない。
- **根拠・影響の正確さ**：`score.mjs`は判定だけを採点する。根拠に含まれる事実の正誤と、影響の過大な記述は、T4の1事例を手で確認しただけである。全件の評価は欠測である。
- **費用**：tokenは、Hostの完了通知の`subagent_tokens`である。cache等の内訳とAPI課金額は欠測である。親sessionの調整・採点の消費は含まない。
  - 合計：小ケースのA 168,530、B（Hunter＋Verifier）914,177。規模ケースのA 196,438、BのHunter 186,936、Verifier 192,794。seed版のVerifier 9件は419,035。
  - 壁時計は、並列に起動したAgentが相互に干渉した値を含む参考値である。
- **判定の採点**：各runの最終JSONを、操作者がgoldの項目に対応付けた。対応付けの全件は`runs.json`に、元の応答は`raw-outputs.json`にある。
- **標本**：合成fixture 2件（JavaScript、HTTP API、計64 file。seed版を含めない数）だけである。大規模なrepository、他の言語、ブラウザ・native・cloud設定を含むケースは測っていない。原典READMEの「反復runで発見が増える」効果も、3回の範囲でしか見ていない。結果を全案件の欠陥検出力へ一般化しない。
- **goldの作成**：goldは作業者が作り、評価Agentには見せていない。T4とS1〜S3には争点がある（「goldの争点と感度」）。
- **プロンプトだけの制約**：評価Agentの読取り専用・fixture非実行は依頼文で指示しただけで、tool制限では強制していない。実行後にfixtureのgit状態が変わっていないこと（0行）は確認した。

## ownerの判断事項（案。確定していない）

1. **採否の閾値（案。結果を見た後に作った）**：次の2つをともに満たせば採用する。
   - B最終が、どの指標でもAより悪くならない（検出はA以上、誤検知・誤昇格はA以下）。
   - 次のどちらかがある。(a) 判定の採点でAを上回る項目が1つ以上ある。(b) 根拠・影響の誤りの件数が、全件の採点で有意に少なく、tokenが2倍以内。
   
   今回のBは、(a)が無い。(b)はT4の1事例しか無く、tokenは3.1〜5.4倍である。そのため結論は不採用となる。(b)を全件で測る場合の採点方法は、未設計である。
2. **改善の候補（未測定）**：Aは3回とも、実行環境の挙動（`fetch`がuserinfo付きURLを拒否すること）を、確かめないまま静的な根拠として断定した。「library・runtimeの挙動に依存する事実は、確認しなければ未確認の懸念とする」という一文を`review-method.md`に足せば、この誤りが減るかもしれない。しかし、足して誤りが減ることは測っておらず、ADR 0002に従って本PRでは足さない。採否を決めるには、本directoryのT4と同種の事例を複数含むfixtureで、文言の有無を比べる必要がある。
3. **sandboxの実行手順の扱い**（推奨は「今は配布しない」。理由はPhase 3の表）：本directoryの起動設定と反例probeを、ユーザーが明示的に脆弱性監査を依頼したときの任意の参照として、`security-evidence`へ短く載せるかどうか。載せる場合の条件の案は次のとおり。
   - 反例probeで全制御を確認できたときだけ、対象コードを実行する。
   - 確認できなければneeds_validationとする。
   - 成果物はstdoutの上限付き取得に限る。

## 検証

- `node score.mjs`（本directory）：上の表の値を出力する（読取りだけで、networkを使わない）。
- `node --import tsx scripts/check_source_quality.ts --root=<worktree>`：`errors: []`で成功した（`d7085e93`と、`c2091713`の内容で実行）。`scripts/check_project_quality.ts`も成功した（`d7085e93`）。
- `npm run quality`（ローカル、HEAD `d7085e93`）：651件中、成功470・失敗34・skip 147だった。同じ時点のmain（`db3ca9da`）で`npm test`を実行すると、失敗40件だった。worktreeで失敗した34件は、全てmainでも失敗していた（worktreeだけの失敗は0件）。そのためこの失敗は、ローカル環境（Git・Host process等の試験）に起因すると判断した。本PRの差分は`docs/evidence/`だけで、試験の対象を変えない。合否はCIで確認する。

## 再評価の条件

次の場合は、新しいIssueで再評価する。fixtureの生成script・gold・採点scriptは、本directoryのものを再利用できる。
- 現行の独立レビューで、実際の案件で攻撃面の見落とし（critical）が独立に記録された。
- 大規模なrepository（目安として数万行）か、複数言語・cloud設定を含むfixtureで、Aの検出率が閾値を下回った。
- Verifierの反証規則を変えた版（data源をsource外の前提として扱う等）で、誤rejectedが減ることが示された。

## 依頼文

`<F>`はfixtureの絶対path、`<G>`はASC Skillの写しの絶対pathである。

### 共通の末尾

> Constraints: read-only. Never create, edit or delete any file. Do not execute any fixture code, tests, package scripts or node on fixture files (no execution sandbox is approved; this is a static source review). No network access. Read only files under FIXTURE (and GUIDE); do not open any other directory. Use absolute paths. Final reply: exactly one JSON object and nothing else: `{"items":[{"file","line","title","verdict":"confirmed|needs_validation|rejected","boundary","reason"}],"hardening":[...]}` Include items you examined and refuted as rejected.

Bでは、`items`に`fingerprint`と`trace`を加え、`ledger`欄も求めた。

### A

> Independent security review. The owner explicitly requested a vulnerability review of the whole repository at FIXTURE=`<F>` (git HEAD; there is no diff, the whole tree is the review target). Read GUIDE=`<G>`/review-and-remediation/SKILL.md and its references/review-method.md (and GUIDE security-evidence/SKILL.md only if applicable) and follow them as your review method. Review-only. Classify each issue you examined using the method's distinctions: established by static source evidence -> verdict "confirmed"; unconfirmed concern whose decisive fact is outside the repository (state that fact) -> "needs_validation"; refuted by an existing control or the specification -> "rejected".

### BのHunter

> Defensive, source-first security audit of the whole repository at FIXTURE=`<F>` (git HEAD). Method: 1. Reconnaissance: from source and README, list entry surfaces (HTTP routes, webhooks, tool calls, CI workflows, configuration), principals and trust boundaries. 2. Coverage ledger: one unit per material combination of entry surface x trust boundary x attack class. For each unit record the paths you actually read and a status: covered (checked, no candidate), candidate, or deferred (with reason). Never mark a unit covered without reading its paths. 3. Hunt each unit. Candidate gate: name the lower-trust principal, accepted input, intended control, crossed boundary, affected principal/resource and concrete result. Reconstruct the strongest source-visible control on the path, including controls in other files (mount order, middleware, allowlists, framework behavior). A missing best practice with no affected principal/resource is a hardening note, not a candidate. Do not strengthen the effect beyond what source shows. Treat intended same-principal authority as no boundary crossing. 4. Proposed verdicts: confirmed = complete source trace from a lower-trust entry to the effect with no visible preventing control; needs_validation = source-grounded hypothesis whose decisive fact is outside source (state that exact fact; it is not a parking place for speculation); rejected = refuted by source.

### BのVerifier（候補ごと）

> You did not write this candidate. Try to refute it from repository source at FIXTURE=`<F>` (git HEAD). 1. Verify every trace location exists and matches the description; the first entry must be a real lower-trust entrypoint and the last the claimed effect. 2. Reconstruct the strongest source-visible validation, identity, authorization, normalization, framework/runtime and containment controls on the path, including controls in other files. 3. Check that the claimed impact matches only what the evidence establishes; do not accept a stronger effect. 4. For a proposed needs_validation candidate, decide whether the blocker is genuinely outside source. If source refutes the trace, reject it. If source fully establishes it, confirm it. 5. confirmed only if the complete trace from a lower-trust entry to a meaningful cross-boundary effect is source-visible with no preventing control. needs_validation: a decisive fact is outside source (state it exactly). rejected: refuted by source, a visible control, missing meaningful impact, or an impossible prerequisite. Constraints: read-only; … Reply with exactly one JSON object and nothing else: `{"decision","reason","unresolved_fact"}` Candidate: `<HunterのitemのJSON>`
