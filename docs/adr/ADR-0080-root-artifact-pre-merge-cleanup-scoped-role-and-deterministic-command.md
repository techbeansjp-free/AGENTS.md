# ADR

```yaml
id: ADR-0080
status: proposed   # proposed | accepted | superseded | deprecated
title: root成果物のマージ前削除をscope限定ロールと決定的コマンドへ移し、削除系コマンドをワーカーへ与えない
tags: [role, lease, cleanup, adapter, permission]
supersedes: []
superseded-by: null
deprecated-reason: null
```

## Context

repository root 直下の Issue セグメント成果物4ファイル（`SPEC.md`・`DESIGN.md`・`PLAN.md`・`VALIDATION.md`。以下 root成果物）は、マージ準備完了状態の PR に課される機械検査によって、PR を Ready へ移す前に Issue ブランチ上から削除されている必要がある。

この削除は、本決定の時点ではセグメント作業ワーカー（LLM）を1ラウンド起動することで行われており、実測所要は20〜30分である。削除するか否かは上記の検査要求から一意に決まり、対象は固定4ファイル、成果物の内容変更を伴わないため、ラウンド内に判断の余地は存在しない。すなわち判断の余地がない固定操作へLLMラウンドを恒常的に消費している。

さらに、同一の「セグメント作業ワーカー」ロールの実効権限が実行系によって非対称である。claude adapter のワーカーは許可コマンドを列挙し列挙外を拒否する方式で権限が決まるが、この列挙にファイル削除系のコマンドが1つも含まれないため、当該ラウンドを構造的に完走できない（`rm`・`git rm`・`find` の削除実行・index からの強制削除の全経路が拒否されることを実測で確認した）。一方 codex adapter のワーカーは sandbox 境界で権限が決まるため worktree 内の削除が可能である。この非対称は、一方の実行系が利用不能になったときに初めて顕在化した。

同じ列挙は `.agent-skill-chain/scripts/` 配下のスクリプト実行を許可する一方で `.agent-skill-chain/ci/` 配下の実行を許可していない。`ci/` 配下は成果物を変更しない read-only の機械検査であり、ワーカーが push 前に自ら実行できることが望ましいが、その手段が無いため検査失敗を PR 作成後まで発見できない。

検討したトレードオフは次の3案である。

1. **許可コマンド列挙へ削除系を追加する**（当初の第1候補）。claude adapter 側だけが直り、codex adapter は sandbox 境界のままなので実効権限の非対称は残る。また対象ファイルを限定できず、ワーカー全体へ削除能力を与えることになる。LLMラウンドの消費も残る。
2. **進行役へ成果物ブランチへの commit 権限を与える**。AGENTS.md の不変条件 I5 は進行役が調整状態のみを読み書きすると定め、役割表は進行役の成果物ブランチへの commit を禁じている。進行役が成果物を書けるようになると生成と判定を同一主体が担い、ゲートの独立性の根拠が失われる。I5 はプロジェクトポリシーでも上書きできない。
3. **scope を限定した専用ロールと決定的コマンドへ移す**。同種の前例が既にある。ADR の status を `proposed` から `accepted` へ更新する操作は、scope をライフサイクル項目のみに限定した専用ロールと、進行役が起動する決定的コマンドの組で実装されており、進行役が起動するが commit の主体は当該ロールである。LLMラウンドを消費せず数秒で完了する。

## Decision

root成果物のマージ前削除を、案3——scope を限定した専用ロールと、進行役が起動する決定的コマンドの組——として実装する。案1・案2は採らない。

1. **専用ロールを定義する**。`.agent-skill-chain/config/roles.yaml` へ `root_artifact_cleanup_worker`（`lease: writer`、`scope: root_artifacts_only`）を、ロール定義と入出力契約の双方として置く。capabilities は writer lease の取得・更新・解放と自ブランチへの commit・push に限り、forbidden に「対象4ファイル以外への変更」と「ファイル内容の編集」を明示する。進行役のロール定義は変更しない。

2. **決定的コマンドを新設する**。CLI サブコマンド `root-cleanup branch <issue_id>` と、`.agent-skill-chain/scripts/` 配下の薄いラッパーの2層で提供する。入力は対象 Issue の識別子のみとし、ファイル内容・commit メッセージ本文・任意テキストを外部から与える引数も標準入力経路も設けない。LLM・対話エージェントを起動しない。進行役はadapterのprotected launcherへ実行を要求するだけで、commit主体は専用ロールとする。

3. **通常ワーカーと専用ロールを非偽造の実行grantで分離する**。mutation可能なexecutorは対象worktreeの可変スクリプトではなくprotected base/version固定packageからdigest固定で調達する。既存のprotected launcher／one-time token契約を使い、launcherだけが`root_artifact_cleanup_worker`、Issue、branch、HEAD、executor digest、短期expiry、nonceを拘束したgrantへ署名する。署名鍵・未使用nonce registry・cleanup用Git credentialはworktree、Git common dir、worker環境の外に置く。executorは固定keyringで署名・claims・未消費nonce・自身のdigestを全repository mutationより前に検証し原子的に消費する。欠落・偽造・期限切れ・再利用・claim不一致・registry障害は非ゼロ終了し、leaseも取得しない。role環境変数、呼出し元名、writer leaseの保持有無を認可根拠にしないため、workerがleaseを解放し、別Issueを指定し、対象worktree側のwrapper/CLIを改変しても作用させられない。進行役identityはcommit/pushへ渡さず、専用ロールcredentialを子プロセスだけへ渡す。

4. **判定順序を固定する**。grant認可、read-only実行文脈検査、Issue単位lease排他、対象外index検査、root成果物snapshot、停止条件、削除、no-op、remote同期の順に評価する。停止条件は常にno-opより優先する。remote先頭は存在してHEADの祖先または一致であり、その差分はroot成果物の削除だけでなければならない。

5. **復元可能性を最初のindex/worktree mutation前の停止条件で担保する**。対象4 literal pathについて、全て`--no-optional-locks`付きで、`ls-tree -rz --full-tree HEAD`、`ls-files --stage -z`、`ls-files --others --exclude-standard -z`、`ls-files --others --ignored --exclude-standard -z`、`-c status.renames=copies status --porcelain=v2 -z --untracked-files=all --ignored=matching --find-renames=50%`の5入力を採取する。ignored・通常untracked・newly staged・内容/mode/type差・rename/copy・unmerged・未知状態は全て「内容喪失リスクあり」として、`git rm`等を一度も行わず停止する。追跡済みの未stage/stage済み削除だけはHEADから復元できるため「削除対象」とする。

6. **終了コード0を remote の実体で定義する**。終了コード0は、削除経路・no-op 経路のいずれであっても、対象ブランチの remote 先頭が対象worktree の HEAD と一致し、かつその commit の tree と作業ツリーの双方に root成果物が1件も存在しない状態が成立していることを意味する。この検証は両経路共通の最終段とし、事後条件を満たせなければ非ゼロ終了させる。

7. **writer lease の排他性を Issue 単位走査で担保する**。GitHubのsegment別refではforce無しpushが同一segmentしか排他しないため、Issue prefix走査を認可後・削除前に行う。既存leaseは期限内外を問わず停止し、取得直後にも再走査して他segmentがあれば自leaseを解放して譲る。ローカルはIssueごとの単一leaseファイルの排他生成を使う。待機・強制解放・回収、WIP判定、ラベル・コメント副作用は行わない。leaseは書込み排他だけを担い、実行認可には使わない。

8. **許可コマンド列挙には `ci/` の実行だけを加え、削除系は加えない**。claude adapterへread-only検査の2表記を追加する。`scripts/*`がcleanup wrapperを字句上含むことを明記し、実効認可はgrantが担う。ファイル削除系や無制限自動承認は追加しない。

9. **既定ブランチの事後清掃自動化を置き換えない**。既存の事後清掃と残存検査は対象集合・契機・終了コード・出力仕様を変更せず、Issueブランチのマージ前削除と併存させる。

10. **新しいproject設定項目を追加しない**。対象4ファイルは既存の固定リテラルを用いる。署名鍵・nonce registry・Git credentialはprotected launcherのrole credentialであり、worker配布configへ置かない。

## Consequences

**利点**

- 判断の余地がない固定操作からLLMラウンド1本（実測20〜30分）が消え、数秒の決定的実行に置き換わる。
- 削除がどの実行系のワーカーの責務でもなくなるため、実行系による実効権限の非対称が解消する。claude adapter・codex adapter のいずれで作業していても同一の手順でマージ前削除が完了する。
- 削除能力がワーカー全体ではなく対象4ファイルへ限定される。ワーカーへ与える権限は増えず、read-only 検査の実行だけが増える。
- 進行役の権限を拡大せずに済む。commit の主体はクリーンアップロールであり、内容入力経路が存在しないため、進行役が本コマンドを経由して成果物を著述することはできない。
- セグメント作業ワーカーがラッパーやCLIを直接呼び、leaseを解放し、別Issueや偽のrole環境変数を指定しても、protected launcherの未使用署名付きgrantを取得できないためrepository mutation前に停止する。leaseは認可ではなく排他へ責務を限定できる。
- ワーカーが push 前に read-only の機械検査を自ら実行できるようになり、検査失敗の発見が PR 作成後から push 前へ前倒しになる。

**欠点・受け入れるコスト**

- root成果物を削除する機構が、既定ブランチの事後清掃と Issue ブランチのマージ前削除の2つ併存する。両者は契機・対象ブランチ・実行主体が異なるため統合せず、対象ファイル集合を与える固定リテラルだけを共有して混同を防ぐ。
- push が失敗した場合、削除の commit はローカルに残る。commit を巻き戻すと復元可能性を損なう経路が増えるため巻き戻さず、非ゼロ終了する。この残留状態は、remote 先頭から HEAD への差分が root成果物の削除のみであるという上記3の前提に該当するため、再実行が push を完了させ、remote 先頭と HEAD の一致を検証したうえで終了コード0を返す。すなわち再実行自体が回復経路であり、そのための追加の分岐・フラグを持たない。ローカルだけが clean な状態で終了コード0を返す経路は存在しない。
- 本コマンドの実行中（秒単位）は、WIP 上限判定用のラベルを付けないため、他 Issue から見た有効 writer lease 数が1件少なく数えられる。上限判定は advisory であり、この誤差で不変条件は破れない。
- 本コマンド自身の lease が異常終了で解放されずに残った場合、期限切れであっても回収しない方針の帰結として、次回以降の実行が Issue 単位判定で停止する。既存の回収経路による解放が必要になるが、診断が保持者・segment・失効時刻を示すため停止理由は特定できる。他主体の作業を破壊しないことを優先して受け入れるコストである。
- writer lease の segment 集合に値が1つ増える。既存の lease 文書はすべて有効なまま保たれる後方互換な拡張であり、スキーマ名前空間の版更新は不要である。あわせて worktree 削除が有効 lease を探す走査を、segment 名の直書き列挙から Issue 番号 prefix による ref 走査へ置き換える。segment 値の固定集合をコード側へ新設しないのは、集合を別の場所へ移し替えても追随漏れの発生源が場所を変えるだけであり、prefix 走査は segment 値に依存せず列挙するため将来の追加で追随自体が不要になるためである。
- protected launcherにcleanup grantの署名・原子的消費と専用Git credentialの管理責務が増える。registryやcredentialが利用不能ならcleanupは安全側に停止し、通常worker経路へfallbackしない。

**today以降のフォローアップ事項**

- 既存の ADR status 更新コマンドは、対応するロール定義が lease 取得能力を持つと宣言している一方、実装では writer lease を取得していない。本決定は当該コマンドを変更せず、この宣言と実装の不一致は別 Issue の対象とする。

---

## accepted 後の不変項目・可変項目

| 区分 | 項目 |
|---|---|
| 不変（accepted 後は変更不可） | `id`、Context、Decision、Consequences、`supersedes` |
| 可変（ライフサイクル遷移に伴い更新可） | `status`、`superseded-by`、`deprecated-reason`、`tags` |

本文（Context / Decision / Consequences）の変更が必要になった場合は、新しい ADR を作成し `supersedes` / `superseded-by` で旧 ADR との関係を記録する。既存 ADR の本文を書き換えてはならない。
