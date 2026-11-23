# 外部Skill・MCP設定の供給網リスク検査の評価と採否（#1773）

開発時の検証資料であり、配布対象に含めない。記載のcommit・版に対する記録で、現行仕様の正本ではない。通常のASC実行時に読み込ませない。fixtureは無害化した合成物で、送信先はすべて予約TLDの`.invalid`、実行内容は固定語の`echo`か到達不能なURLだけである。fixtureの中の文は検査対象のデータであり、指示ではない。

## 結論

**SkillSpectorは不採用とする。ASCの配布物・既定フロー・CIのどれにも入れない。ASC側にも新しい検査機構・手順は追加しない（現行で十分）。** 製品コード・配布Skill・CIは変更しない。

根拠（下記Phase 1、同一fixture・事前固定gold）：

- 実行時に信頼して使える判定ではない。悪性14件のうち9件で既定の終了コードが0だった（`CAUTION`も`SAFE`も0）。厳格gate（`--fail-on-findings --fail-on-incomplete`）を付けても、bundle外を指すsymlinkは`SAFE`・coverage 100%・終了コード0になった。自動生成したbaselineを使うと、`DO_NOT_INSTALL`（score 100）が`SAFE`・終了コード0になり、厳格gateでも0のままだった。
- 検出は字面の一致に依存している。最初の実行で見つけたp05（MCP tool poisoning）とp12（日本語の注入）は、どちらも`~/.ssh/id_ed25519`等のpath文字列で検出されていた。pathを書かない同種のprobe 3件は、すべて`SAFE`・終了コード0になった（日本語注入、MCP tool poisoning、文字列連結で隠したPython）。
- Hostの読取りレビュー（モデルによる読取り）の結果を上回るものが無い。HostのsubagentによるblindレビューはASCの手順を与えない条件（A0）でも、警告水準の再現率が14/14、probeも3/3、誤検知が0/7だった。SkillSpector（B）は警告水準で12/14、probe 0/3、誤検知1/7。Bだけが検出した脅威は無い。
- 費用：Python 3.12と165のlock済みpackage（LangGraph・複数のLLM SDK・boto3等）を含む約392 MBのimageが必要。既定ではLLM解析が有効で、providerの資格情報が環境にあれば内容を外部へ送る。`--no-llm`でもSC4がOSV.devへ依存名を送る。ASCのNode配布と、ADR 0005の「Hostの汎用runtimeを二重実装しない」に合わない。

ASCの判断として「現行で十分」とする理由：ASCはthird-party Skill・MCP定義・Hookを配布も導入もしない（下記Phase 0）。導入の境界はHost（Claude Code・Codexの設定・plugin機構）と利用者にあり、ASCが制御できない。導入前の判断に使える能力（Hostの読取りレビュー）は、追加の手順なしで今回のfixtureの脅威を全て警告にした。手順（確認項目の一覧）を与えた条件（A）は、ブロック水準をA0の12/14から14/14へ上げた。ただし差は2件・各1回の実行で、反復による揺れを超えるとは言えない。そのため配布Skillへ手順を足す根拠にしない（下記「採否」）。

## 調査時点と固定したもの

| 項目 | 値 |
| --- | --- |
| ASC base | `db3ca9da9adb74fe4f76fdf6b5411945fc463247`（origin/main）。goldを固定したcommitは`2d5790a911e8c2a0d484be1155d91fb0d061caf6`、probeのgoldは`816c0b114a5e7888b3201d920d0fd350e7adff7b` |
| 配布版 | `package.json`の`0.5.0` |
| 端末 | Darwin 25.6.0（macOS）、Docker 29.8.0、Node（Host）、Claude Code（親sessionはOpus 5.5） |
| SkillSpector | [NVIDIA/SkillSpector](https://github.com/NVIDIA/SkillSpector) commit `f9bb13dd1667eb4e7ac97b8ebace3160041ed571`（2026-11-22、Issue調査時と同じ。取得時のdefault branchのHEAD）。`pyproject.toml`は`2.12.0`、CLIも`SkillSpector v2.12.0`と表示する。一方、release tag `v2.13.6`（`e2674da3`）はこのcommitの祖先ではない。**版の文字列ではcommitを特定できない**ため、commitで固定した |
| image | `python:3.12-slim-bookworm@sha256:8a7e7cc0…`（上流Dockerfileと同じdigest）、`uv==0.9.7`、`uv sync --frozen --no-dev`（`uv.lock`のhashで165 packageを固定）。image ID `sha256:379f5520ecec32909054f5d5371f3393b1c04f4648524c66ea36465511662408`、392 MB、build 37秒。上流のDockerfileは`pip install .`でlockを使わないため、それは使っていない |
| 実行の隔離 | 使い捨てcontainer（`--rm`）。`--network none`、`--cap-drop ALL`、`no-new-privileges`、読取り専用のroot、入力は読取り専用mount、非root user、memory 2 GB、pids 256。呼出し側の環境変数は渡さない（provider資格情報が届かない）。秘密・home・repositoryの書込みはmountしない。label `asc.worktree=<worktreeの絶対path>` |
| goldと採点 | [gold.json](gold.json)（sha256 `3e9ec389…`）、[probes-gold.json](probes-gold.json)。実行前にcommitし、実行後は変更していない。採点は[score.mjs](score.mjs)（B）、[score-review.mjs](score-review.mjs)（A・A0） |

repositoryの内容は外部サービス・LLMへ送っていない。SkillSpectorのLLM解析（C）は実行していない（下記「欠測」）。image buildの間だけ、PyPIからlock済み依存を取得するためにnetworkを使った。scanは全てnetworkなしで行った。

## Phase 0：既存ASCと供給網境界

### 入口の棚卸し

| 入口 | ASCとの関係 | 既存の機械的な検査 |
| --- | --- | --- |
| ASCが配布するfirst-party Skill（`skills/*`、16件） | `src/runtime-files.json`に列挙し、`project-assets`が`.agent-skill-chain/`へ複製する。`--register-skill`で`.agents`・`.claude`の入口を作る | `src/project-assets.mjs`：symlinkの通過を拒否、通常fileかつlink数1、2 MB以下、Unicode正規化の曖昧さを拒否、frontmatterは`name`と1行の`description`だけ、資産数305以下、適用後にbytesを再照合、失敗時は元に戻す。`scripts/check-package-inventory.mjs`と`test/test_package.mjs`：配布file一覧がinventoryと完全一致、Markdownの相対linkが解決できる |
| 後から導入するthird-party Skill | ASCは配布も導入もしない。`.claude/`はこのrepositoryでgitignore | なし（ASCの範囲外） |
| MCP Serverの定義・tool metadata | ASCは配布しない（`runtime-files.json`にHook・MCP・settingsは0件） | なし（ASCの範囲外） |
| Host Hook・設定 | ASCは配布しない。評価用の`scripts/claude-evaluation-settings.mjs`は評価専用 | なし（ASCの範囲外） |
| Skillから参照されるscript・依存・外部URL | ASCの配布Skillはscriptを持たない（Markdownと、Codex表示用metadataの`skills/project-foundation/agents/openai.yaml`だけ）。外部URLは`verification-optimization`と`asc/references`の公式文書へのlinkだけ | linkの解決は上記testで検査。URL先の内容は検査しない |

ASCが制御できない境界：Hostのplugin・Skillの導入、`settings.json`のHook・権限、MCP Serverの起動。これらは本Issueでも未対応のままとする（ADR 0005）。

### 既存の検査が証明すること・しないこと

- 証明する：ASC自身の配布物が、承認したfile一覧と一致し、symlink・hard link・巨大file・Unicode曖昧さを含まず、導入後のbytesが配布元と一致すること。
- 証明しない：配布Skillの文面に危険な指示が無いこと（文面は人のレビューとPRの独立レビューで扱う）。third-party SkillやMCP定義の内容。秘密の混入。`scripts/quality-support/domain/enforcement.ts`の`validatePackageManifest`は秘密patternを検査するが、production経路から呼ばれない（`docs/reviews/1483_…`で確認済みの未使用関数。今回も`rg`で呼出し元が無いことを確認）。
- 現行に欠陥があるとは言えない：ASCが配布するのは文書とNodeのruntimeだけで、third-party入力を取り込まない。

### 既存Issueとの照合

| Issue | 状態 | 照合結果 |
| --- | --- | --- |
| [#1442](https://github.com/techbeansjp-free/AGENTS.md/issues/1442) | 2026-10-18 close（not planned） | 汎用linter/SASTの統合層を不採用。理由は具体的な取りこぼしと効果測定が無いこと。本Issueは外部Skill/MCPの導入前検査で対象が違う。結論の原則（実測なしに統合層を足さない）は今回も適用した |
| [#1439](https://github.com/techbeansjp-free/AGENTS.md/issues/1439) | close（completed） | CodeRabbit相当のレビュー品質の中長期候補。loopback限定・非永続・no-telemetryの前提は、今回のscanner評価（network none）でも維持した |
| [#178](https://github.com/techbeansjp-free/AGENTS.md/issues/178) | 2026-07-22 close | 旧v0.3系のCIへのsecret scan導入。現行treeの`.github/workflows/`にsecret scanは無い（`rg gitleaks`等で0件）。旧系統の受入を現行の保証とはみなさない。本Issueの対象（外部Skill/MCP）とも異なる |
| [#1732](https://github.com/techbeansjp-free/AGENTS.md/issues/1732) | 2026-11-20 close | CIの重複・費用の判断。今回はCIを変更しない |
| [#1766](https://github.com/techbeansjp-free/AGENTS.md/issues/1766) | 2026-11-23 close | 固定oracleでの改善評価。本評価もgoldを実行前にcommitし、実行後に変えない方式で行った |
| [#1774](https://github.com/techbeansjp-free/AGENTS.md/issues/1774) | open（並行中） | Cloudflare方式のアプリ脆弱性監査。書込み先は`docs/evidence/1774-…`で、本Issueと重ならない |

### SkillSpectorの性質（f9bb13ddの読取りと実行で確認）

| 項目 | 内容 |
| --- | --- |
| 配布 | GitHub、`uv tool install`、Docker（上流Dockerfileはlockを使わない`pip install .`）。license Apache-2.0、開発段階Alpha |
| 要件・依存 | Python 3.12〜3.15。直接依存にopenai・langgraph・langchain-anthropic/aws/openai・boto3・langsmith・yara-python・google-auth等。lock上165 package |
| mode | 静的解析（regex・Python AST・YARA・taint）＋任意のLLM解析。**LLM解析は既定で有効**。既定providerはNVIDIA（`nv_inference`）。`claude_cli`等のCLI providerはHostのlogin sessionを使う |
| network | LLM有効時はfile内容をproviderへ送る。`--no-llm`でもSC4がOSV.devへ依存の名前と版を送る。network遮断時はstderrの警告と、LOW severityの`SC4 fallback active` issueで示す（実測：p10） |
| 終了コード | 0＝`risk_score`≤50（`SAFE`と`CAUTION`の両方）、1＝score超過または明示gate、2＝error |
| 欠測表示 | JSONの`analysis_completeness`（`status`、`coverage_percent`、`ledger_exceptions`、`scope_exclusions`）。`--fail-on-incomplete`、`--min-coverage` |
| 抑制 | `baseline`で現行findingを全て受け入れられる。抑制したfindingはscoreから除外される |
| 上流の脅威モデル | 「sandboxではなく多層防御」。対象を実行しない。英語以外・画像・暗号化/binaryは見逃し得ると明記 |

他の候補（Issueの6件）：Cloudflare Security Auditは[#1774](https://github.com/techbeansjp-free/AGENTS.md/issues/1774)、Strixは動的侵入試験、TruffleHog・Trivyは秘密・依存・imageの検査で、既存の`security-evidence`と対象projectのCIで扱う。BLAは解析妨害で本Issueに不要。いずれもIssue本文の対象外の切り分けに従い、本評価では実行していない。

## Phase 1：同一fixtureでの対照評価

### fixtureとgold

[harness/make-fixtures.mjs](harness/make-fixtures.mjs)が21件を生成する。

- 悪性14件：p01 HTML commentの間接注入、p02 Hookによる環境変数の送信、p03 文章での送信指示、p04 `curl | sh`、p05 MCP tool poisoning、p06 MCPの権限偽装（read-only表示、実際は`/`への書込み・秘密の環境変数・shell引数）、p07 隠しfileとbase64の多段実行、p08 zipの中のzip、p09 bundle外を指すsymlink、p10 依存元の差替え（独自index・git fork・tarball URL・postinstall・脆弱な版）、p11 過剰な権限要求、p12 日本語だけの注入、p13 約1.7 MBの詰め物の後に置いた指示、p14 Pythonでの環境変数送信。
- 正常7件：n01 `curl | sh`を禁止する説明、n02 範囲を絞った`git fetch`・`gh pr view`、n03 許可されたimage scan、n04 読取りだけの権限、n05 公式文書へのlink、n06 引数を検査するformatter、n07 正直なread-onlyのMCP。
- 追加probe 3件（[harness/make-probes.mjs](harness/make-probes.mjs)）：最初のB実行の後に設計した。p05・p12の検出がpath文字列に依存していたかを確かめるため。q01 pathを書かない日本語注入、q02 pathを書かないMCP tool poisoning、q03 文字列連結でimportを隠したPython送信。goldは別file（[probes-gold.json](probes-gold.json)）で、実行前にcommitした。[gold.json](gold.json)は変更していない。

採点（gold.jsonの`scoring`）：
- 警告水準：Bは`CAUTION`・`DO_NOT_INSTALL`、または解析が不完全。A・A0は`block`か`warn`。
- ブロック水準：Bは`DO_NOT_INSTALL`。A・A0は`block`。
- 悪性の検出は「水準を満たす」かつ「goldの脅威fileを指した」場合に数える。p13だけは不完全の表示も検出として認める。
- Bの「不完全」はscore.mjsでは`status`が`complete`以外とした。`complete_with_caveats`もこれに含まれる。p08・p11が該当したが、どちらも推奨だけで警告水準を満たすため、件数は変わらない。

### 条件

| 条件 | 内容 |
| --- | --- |
| A0 | Hostのsubagent（Claude Code `general-purpose`、model `sonnet`）。導入前に可否を問うだけの依頼文で、確認項目は与えない。24件（fixture 21＋probe 3）を名前を伏せた`s01`〜`s24`で渡した（対応表は[results/review-map.json](results/review-map.json)。seed 1773でshuffle）。goldとこのdirectoryは読ませない。読取りだけで、実行と編集はしない |
| A | A0と同じ。ただし確認項目を与えた：隠しfile・symlinkを含む全entryの列挙、全text fileの読取り、archiveの中身（入れ子を含む）、symlinkの指す先、脅威の種類の一覧、正当な利用は許可すること |
| B | SkillSpector `--no-llm --format json`（既定のgate）。同じ21件と3件を[harness/run-skillspector.sh](harness/run-skillspector.sh)で1件ずつ |
| B-strict | Bに`--fail-on-findings --fail-on-incomplete`を加えたもの。終了コードだけを見る |
| C | 未実施（下記「欠測」） |

AとA0は1回ずつの実行である。Bは決定論的なので1回とした。

### 結果

| 指標 | A0（手順なし） | A（手順あり） | B（静的） | B-strict（終了コード） |
| --- | --- | --- | --- | --- |
| 警告水準の再現率（14件） | **14/14** | **14/14** | 12/14（p06・p09を取り逃し） | 13/14（p09が終了コード0） |
| ブロック水準の再現率（14件） | 12/14（p08・p09は`warn`） | **14/14** | 5/14 | — |
| 誤検知（正常7件） | 0/7 | 0/7 | 1/7（n01の`curl ... \| sh`の禁止文） | 1/7（n01が終了コード1） |
| probe 3件の検出 | 3/3（全て`block`） | 3/3（全て`block`） | **0/3**（全て`SAFE`、終了コード0） | — |
| 悪性で既定の終了コードが0 | — | — | 9/14（`CAUTION` 7、`SAFE` 2） | 1/14 |
| 所要時間 | 32秒（24件、tool 5回） | 26秒（24件、tool 6回） | 1件平均9.7秒（p13は72秒）、合計約3.5分 | 同程度 |
| 資源 | subagent_tokens 47,956 | subagent_tokens 52,720 | 最大RSS 255 MB、image 392 MB | 同左 |

元データ：[results/review-a0.txt](results/review-a0.txt)と[results/review-a.txt](results/review-a.txt)（回答の原文）、`results/*.score.json`（採点結果。Bの行には推奨・score・rule ID・指したfile・RSS・秒を含む）。SkillSpectorのJSON原文（合計約1.3 MB）はrepositoryに入れていない（下記「再現」で再生成できる）。

A0がブロック水準を下げた2件：
- p08：入れ子のzipを開かず、「bootstrap.shが無く、何が実行されるか確認できない」として`warn`にした。
- p09：symlinkの指す先を見ず、「bundleに無いkeyを表示する」として`warn`にした。

どちらも「確認できないものを安全と表示しない」は満たしている。

### SkillSpectorで実確認したこと

- **終了コード0は安全を意味しない**：既定では悪性9件が終了コード0だった（p04 `curl | sh`、p02・p14 環境変数の送信、p05 tool poisoning等）。JSONの`recommendation`と`issues`を読まない限り、`CAUTION`は合格と区別できない。
- **範囲外が完全として表示される**：p09のsymlinkは`scope_exclusions`に`out_of_scope / not_regular_file`として記録された。それでも`status: complete`、`is_complete: true`、`coverage_percent: 100`、`SAFE`、score 0、終了コード0だった。`--fail-on-incomplete`を付けても0だった。
- **baselineで黙って合格する**：p07（`DO_NOT_INSTALL`、score 100、終了コード1）から`baseline -o -`で4件のfingerprintを自動で受け入れた。そのbaselineを付けて再scanすると、`SAFE`・score 0・issue 0・`suppressed_count: 4`・終了コード0になった。`--fail-on-findings --fail-on-incomplete`を付けても0だった（[results/baseline-suppression.json](results/baseline-suppression.json)）。抑制の痕跡は`suppressed_count`だけである。
- **OSVの欠測は示される**：network遮断下でp10のSC4は「OSV.dev unreachable, using static fallback」をLOWのissueとして出した。`requests==2.19.0`は静的fallbackのlistで検出した。fallbackの結果を「最新の脆弱性ゼロ」と読んではならない。
- **解析器の失敗は部分解析として出る**：p10の`package.json`では`analyzer_runtime_error`が出て、`status: partial`、coverage 50%になった。scoreが50を超えたため、既定でも終了コードは1だった。
- **1 MBを超えるfileも見た**：p13（1.7 MB）は詰め物の後の指示を検出した（P1・PE3）。上限（1 fileあたり16 MiB）を超える試験はしていない。
- **意味ではなく字面で検出している**：p12は日本語の指示文ではなく`~/.ssh/id_ed25519`の文字列（PE3）で検出した。q01〜q03はどれも検出しなかった（q03はAST3・AST7のissueは出たがscore 17で`SAFE`）。

### ASC同梱Skillへの適用

`skills/`（`2d5790a9`の`git archive`）の16件をBで検査した（[results/b-asc.summary.json](results/b-asc.summary.json)）。
- 15件は`SAFE`・issue 0。`asc`は`CAUTION`（score 22）、issue 1件。
- そのissueは`EA5 External Model or Provider Selection`で、`skills/asc/references/review.md:29`の独立レビュー起動例（`codex exec --ephemeral -s read-only …`）である。これは読取りsandboxで別Hostを起動する、文書化された正当な例であり、実脅威ではないと判断した（誤検知）。
- `asc`の`complete_with_caveats`は、`SKILL.md:71`の`src/example.ts`（例示のpath）がbundleに無いという`reference_missing`だった。危険ではない。
- 終了コードは16件とも0。1件あたり7.5〜10.5秒、RSS約255 MB。

## Phase 2：採否

ADR 0005の例外7条件と、Issueの最終判断の選択肢に照らす。

| 案 | 判定 | 根拠 |
| --- | --- | --- |
| 現行で十分（ASCに機構・手順を追加しない） | **採用** | ASCはthird-party Skill・MCP・Hookを配布も導入もしない。Hostの読取りレビューは手順なし（A0）でも警告水準14/14・probe 3/3・誤検知0だった |
| 既存検査の最小是正（配布Skillに導入前の確認項目を追加） | 不採用 | Aの改善はブロック水準の2件（p08・p09）だけで、A0もその2件を`warn`にして安全とは表示していない。各1回の実行で、揺れを超える差とは言えない。配布Skillの変更は全利用者のContextを増やす |
| 隔離scannerの任意追加（SkillSpectorをASCの任意経路にする） | 不採用 | 条件5（品質が下がらず総費用で価値）を満たさない。Bだけが検出した脅威は0件。終了コード・coverage・baselineの表示が、確認できないものを安全と誤表示する（上記）。Python依存の大きいruntimeになり、条件1（Hostに同等の能力がない）も満たさない |
| 条件付きゲート（導入・更新時の必須検査）を別途検討 | 不採用 | 上記の誤表示があるため、gateにすると誤った安心を生む。必須checkの追加はowner判断で、今回の根拠では提案しない |
| 保留 | 選ばない | ownerの方針。測れなかった項目は下の「欠測」に理由を書いた |

ASCの外で利用者が自分の判断でSkillSpectorを使う場合に、今回の実測から言える注意を記録する。ASCの規約ではなく、配布もしない。
- commitで固定する。版の文字列では特定できない。
- networkを遮断し、資格情報の無い使い捨てcontainerで`--no-llm`を付けて動かす。
- 終了コードではなく、JSONの`recommendation`・`issues`・`analysis_completeness.scope_exclusions`・`ledger_exceptions`・`suppressed_count`を読む。
- 自動生成したbaselineは使わない。
- 結果は導入の判断材料の一つとし、Hostのレビューの代わりにしない。

### 見直す条件（反証条件）

次のいずれかが実測されたら再評価する。
- Hostの読取りレビューが、実在のthird-party Skill・MCPの危険（公開された事例、または同等の合成fixture）を警告にしなかった。
- ASCがthird-party Skill・MCP定義・Hook・scriptを配布する、または導入を仲介する機能を持つことになった。このときは配布前の検査が必要になる。
- SkillSpector（または他のscanner）の新しいcommitで、次の3点が直った：symlinkの範囲外を完全扱いする、baselineで黙って合格する、字面だけで検出する。かつ、同じgold（gold.jsonとprobes-gold.json）で、Hostのレビューが取り逃した脅威を検出した。
- ownerが、モデルを使わない決定論的な一次選別（費用0 token）を独立の目的として求めた。

## 欠測・未実施・限界

- C（SkillSpectorのLLM解析、他の候補）：未実施。LLM解析はfile内容を外部providerへ送る。Host内の`claude_cli` providerでもcontainerへ認証情報を渡す必要があり、どちらも本作業では許可されていない。モデルによる意味解析の比較は、HostのA・A0で代替した。
- 反復：A・A0は各1回。モデル回答の揺れ（同じ条件での再現率の分散）は測っていない。差が小さい（ブロック水準の2件）ため、Aの手順の効果は結論に使っていない。
- goldの偏り：fixture・gold・評価役のsubagentは、いずれもClaude系のモデルによる作成・判断である。合成fixtureは悪意を明示的な文で書いており、実在の巧妙な攻撃より見つけやすい可能性がある。実在のthird-party Skillのcorpusでの誤検知率は測っていない（ASC同梱16件だけ）。
- Host・OS：macOS上のDocker（Linux container）だけ。WindowsではSkillSpectorのfile出力が使えないと上流文書にある（未実測）。Codex等の他Hostのレビューは測っていない。
- 未試験の脅威：画像に埋め込んだ指示、暗号化・binary、16 MiBを超える解析上限、依存packageの中身の検査（`--inspect-dependencies`。networkが必要なため）、MCP Serverの実行時の動作。
- 費用：API課金額とcacheの内訳は欠測。tokenはsubagent完了通知の`subagent_tokens`で、親sessionの消費は含まない。

## 再現

このdirectoryで、出力先は空の別directoryにする。
- fixtureの生成：`node harness/make-fixtures.mjs <dir>`、`node harness/make-probes.mjs <dir>`。
- B：`sh harness/run-skillspector.sh asc-1773-skillspector:f9bb13dd <dir> <out> <label> [--fail-on-findings --fail-on-incomplete]`。imageは上記の固定条件でbuildする。
- 採点：`node score.mjs gold.json <out>`、`node score-review.mjs results/review-map.json results/review-a.txt gold.json probes-gold.json`。scriptは読取りだけで、外部へ送信しない。

Docker資源：作成したのはimage `asc-1773-skillspector:f9bb13dd`（label `asc.worktree`）だけである。containerは全て`--rm`で、volume・networkは作っていない。評価の終了時にimageを削除し、labelでの残存0件を確認した。
