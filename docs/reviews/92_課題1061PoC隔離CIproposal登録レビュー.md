# 92 課題1061 PoC隔離CI proposal登録レビュー

> 状態: `candidate-verified / pending-external-attestation`。GitHub hosted runnerへbubblewrapを導入する品質契約を、二段階適用の第1段として登録する。実効のあるCI変更とversion更新は本PRへ含めない。

## 0. レビュー識別情報

| 項目 | 値 |
|---|---|
| 対象Issue | #1061 |
| 比較基点 | `ec4078336ec8d810e1b865adc1dfa030f04789a4` |
| H_impl | `2a3bfae05a69cda5b182684c9baab466b4e8ee94` |
| 対象tree | `9e64d85e05ffae0623c3fbb87f816f9af5bdec60` |
| ラウンド数 | 1 |
| Step chain | 迂回: ユーザーがASCスキル利用を明示禁止し、CIで観測した単一環境欠落を専用worktreeで局所是正しているため |
| 仕様の所有箇所 | `docs/specs/12_運用保守/00_運用設計.md`の品質契約二段階更新と`.agent-skill-chain/docs/01_開発ワークフロー.md`のPoC隔離前提 |
| 成果物行数 | 製品23行。支援層は本レビュー文書だけ |
| 縮小の先行評価 | 隔離fallback、test skip、任意実行物pathは安全境界を弱めるため不採用。既存のtrusted proposal二段階機構だけを再利用する |

## 1. 入力証拠

| 証拠 | 観測 | 判定 |
|---|---|---|
| PR #1062 run 33299842775 | 9 scenariosがすべて`/usr/bin/bwrap`欠落で失敗 | 単一のrunner provisioning欠落 |
| trusted base validator run 33300141033 | CI workflowの直接変更を未登録品質契約として拒否 | 保護機構は正常 |
| mainのCI SHA-256 | `73ab0558c7b59239acdd446db92a6477a03b34e40aac3074a8471c8d91b3eb6c` | proposalのbeforeと一致 |
| 適用予定CI SHA-256 | `db215ea983971d11fe731c68b4cd35b75fef9874b6579e17baf0119150736e28` | proposalのafterと一致 |
| version 8・9のhash | `2c624232cdd221771294dfbb310aca000a0df6ac8b66b696d90ef06fdefb64a3`・`19581e27de7ced00ff1ce50b2047e7a567c76b1cbaebabe5ef03f7c3017bb5b7` | 一段階更新 |
| trusted比較 | `check_project_quality --root=candidate --trusted-root=main` | `valid: true` |

## 変更ファイル個別監査

| path | status | owner | target layer | 責務・配置 | 依存・循環 | 仕様・追跡 | 安全・rollback | 個別判定 |
|---|---|---|---|---|---|---|---|---|
| `.github/trusted-quality-proposals.json` | M | repository maintainer | 品質契約registry | `TQP-POC-SANDBOX-CI-001`をstaged登録 | 既存validatorから参照されるだけで実行依存を追加しない | Issue #1061、運用設計の二段階契約 | 本段階では実効なし。適用後の取消は逆向きproposalで前進する | pass |

## 2. 受け入れ条件

| 条件 | Evidence | 判定 |
|---|---|---|
| proposal登録だけでCIを変更しない | 差分はregistry 1 fileだけ | pass |
| versionを8から9へ一段階だけ進める契約 | version targetのbefore・after hash | pass |
| 適用予定CI bytesを完全固定する | before・after SHA-256 | pass |
| test skipや隔離fallbackを導入しない | proposalの対象はCI provisioningだけ | pass |
| 同一PRでproposalを自己適用しない | `package.json`と`ci.yml`は無変更 | pass |

## 3. 肯定的評価

- runner差を製品側の安全性緩和で吸収せず、必要実行物をCIへ明示導入する。
- 既存の二段階更新契約をそのまま利用し、新しい例外機構を増やさない。
- 適用予定bytesとversionをhashで固定し、次PRの部分適用や追加変更をbase validatorが拒否できる。

## 4. 敵対的評価

| 反例 | 結果 |
|---|---|
| 本PRだけでCI判定が変わる | 不成立。version 8のままでproposalはstaged |
| proposalのhashを誤り適用不能になる | beforeはmain実測、afterは適用予定file実測と一致 |
| testをskipして見かけ上成功させる | 不成立。skip・fallback・test変更は対象外 |
| bubblewrap導入失敗を成功扱いする | 不成立。適用予定stepは`set -e`下で失敗しtest前に停止する |
| 適用までにmainのCI bytesが変わる | 成立しうる。その場合はhash不一致でfail-closedしproposalを再登録する |

## 5. 指摘

| ID | 深刻度 | 内容 | 状態 |
|---|---|---|---|
| S92-M-01 | Medium | 登録と適用の間にmainのCI bytesが変わるとproposalが陳腐化する | 構造的。登録merge直後に#1062へ取り込み、窓を最小化する |
| S92-L-01 | Low | 適用後のrollbackも二段階となる | rollback欄へ逆向きproposal手順を固定済み |

## 6. ラウンド固有の確認

ラウンド1で、正しさ、実現可能性、境界、失敗経路、rollback、範囲漏れを確認した。未解決Critical・Highは0件であり、同じ範囲を再起動しない。

## 7. テスト結果

| 検査 | 結果 |
|---|---|
| JSON構文解析 | pass |
| Prettier形式検査 | pass |
| `npm run project:quality` | pass |
| trusted root比較 | `valid: true` |

## 8. 配布物影響

| 変更path | 配布境界に入るか | 影響 |
|---|---|---|
| `.github/trusted-quality-proposals.json` | 入らない | repository局所のstaged品質契約だけを追加する |

判断: 配布物を更新しない

根拠: 変更は`.github/`のregistryだけであり、npm packageの`files`、製品source、公開CLI、schema、templateを変更しない。version 8のままなのでCIの実効も変わらない。

## 9. 独立reviewの成立

外部CIとimmutable reviewはPR作成後に取得する。現時点の`candidate-verified`は、hashとtrusted validatorの機械Evidenceだけを意味し、merge承認を自己申告しない。

## 10. 仕様整合性

仕様更新は不要である。`docs/specs/12_運用保守/00_運用設計.md`が既に定める二段階品質契約を使い、staged登録だけでは製品・CIの振る舞いを変更しない。

## 11. 総合判定と再開地点

判定: `candidate-verified / pending-external-attestation`。

- 未解決Critical・High: 0件
- 再開地点: 本proposal PRのCI・review・merge後、#1062へmainを取り込み、CI workflowとqualityContractVersion 9をhash完全一致で適用する

H_finalは本review artifactだけを加えるcommitとし、以後このtracked artifactを更新しない。
