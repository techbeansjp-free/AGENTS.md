# 93 課題1061 PoC隔離CI AppArmor代替proposal登録レビュー

> 状態: `candidate-verified / pending-external-attestation`。Ubuntu 24.04でbubblewrapのuser namespaceを許可する限定AppArmor profileを導入する品質契約を、二段階適用の第1段として登録する。実効のあるCI変更とversion更新は本PRへ含めない。

## 0. レビュー識別情報

<!-- prettier-ignore -->
| 項目 | 値 |
|---|---|
| 対象Issue | #1061 |
| 比較基点 | `9e2c1675951d3394eff7c2c7c33d393e9fb7d458` |
| H_impl | `6bd96b854fe5ba99220e60ca7d8c7f9ef334688d` |
| 対象tree | `57a4e7137932dcba737e7d07e91934489675a10c` |
| ラウンド数 | 1 |
| Step chain | 迂回: ユーザーがASCスキル利用を明示禁止し、CIで観測した単一OS policy差を専用worktreeで局所是正しているため |
| 仕様の所有箇所 | `docs/specs/12_運用保守/00_運用設計.md`の品質契約二段階更新と`.agent-skill-chain/docs/01_開発ワークフロー.md`のPoC隔離前提 |
| 成果物行数 | 製品23行。支援層は本レビュー文書だけ |
| 縮小の先行評価 | AppArmor全体無効化、network共有、隔離fallback、test skipは安全境界を弱めるため不採用。既存のtrusted proposal二段階機構だけを再利用する |

## 1. 入力証拠

| 証拠                          | 観測                                                                                                                                   | 判定                                            |
| ----------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------- |
| PR #1062 run 33300544642      | 9 PoC scenariosがすべて`bwrap: loopback: Failed RTM_NEWADDR: Operation not permitted`で失敗                                            | bubblewrap導入後に残るUbuntu 24.04 AppArmor制約 |
| Ubuntu 24.04向け限定修復      | `apparmor-profiles`の`bwrap-userns-restrict`を`apparmor_parser -r`でloadする                                                           | AppArmor全体無効化を避ける                      |
| bubblewrapのnetwork namespace | `--unshare-all`はhost networkを共有せず、sandbox内にはloopbackだけを作る                                                               | `--share-net`へ緩和しない                       |
| mainのCI SHA-256              | `73ab0558c7b59239acdd446db92a6477a03b34e40aac3074a8471c8d91b3eb6c`                                                                     | proposalのbeforeと一致                          |
| 適用予定CI SHA-256            | `ec85cd979d601e11c285fe93227038b46b92a2d93771afb0443e600b8cd0800d`                                                                     | proposalのafterと一致                           |
| version 8・9のhash            | `2c624232cdd221771294dfbb310aca000a0df6ac8b66b696d90ef06fdefb64a3`・`19581e27de7ced00ff1ce50b2047e7a567c76b1cbaebabe5ef03f7c3017bb5b7` | 一段階更新                                      |
| trusted比較                   | `check_project_quality --root=candidate --trusted-root=main`                                                                           | `valid: true`                                   |

## 変更ファイル個別監査

| path                                     | status | owner                 | target layer     | 責務・配置                                    | 依存・循環                                            | 仕様・追跡                        | 安全・rollback                                             | 個別判定 |
| ---------------------------------------- | ------ | --------------------- | ---------------- | --------------------------------------------- | ----------------------------------------------------- | --------------------------------- | ---------------------------------------------------------- | -------- |
| `.github/trusted-quality-proposals.json` | M      | repository maintainer | 品質契約registry | `TQP-POC-SANDBOX-CI-APPARMOR-001`をstaged登録 | 既存validatorから参照されるだけで実行依存を追加しない | Issue #1061、運用設計の二段階契約 | 本段階では実効なし。適用後の取消は逆向きproposalで前進する | pass     |

## 2. 受け入れ条件

| 条件                                             | Evidence                                      | 判定 |
| ------------------------------------------------ | --------------------------------------------- | ---- |
| proposal登録だけでCIを変更しない                 | 差分はregistry 1 fileだけ                     | pass |
| versionを8から9へ一段階だけ進める契約            | version targetのbefore・after hash            | pass |
| 適用予定CI bytesを完全固定する                   | before・after SHA-256                         | pass |
| AppArmor全体制約を無効化しない                   | 適用予定bytesは限定profileのinstall・loadだけ | pass |
| network共有、test skip、隔離fallbackを導入しない | proposal targetはCI provisioningだけ          | pass |
| 同一PRでproposalを自己適用しない                 | `package.json`と`ci.yml`は無変更              | pass |

## 3. 肯定的評価

- 製品のbubblewrap引数を変更せず、filesystem・process・networkの隔離契約を維持する。
- host全体の`kernel.apparmor_restrict_unprivileged_userns`を無効化せず、bubblewrap専用profileだけをloadする。
- 既存8→9 proposalを改変・削除せず、実差分のhashで一意に選べる代替案として前向きに追加する。

## 4. 敵対的評価

| 反例                                      | 結果                                                                                |
| ----------------------------------------- | ----------------------------------------------------------------------------------- |
| 本PRだけでCI判定が変わる                  | 不成立。version 8のままでproposalはstaged                                           |
| 元の8→9 proposalと誤って一致する          | 不成立。CI after hashが異なり、validatorは実target mapの完全一致を要求する          |
| AppArmorをhost全体で無効化する            | 不成立。sysctl変更は適用予定bytesにない                                             |
| `--share-net`でPoCの外部通信を許す        | 不成立。製品sourceは変更対象外                                                      |
| profileが取得・loadできないのにtestへ進む | 不成立。直後に`bwrap --unshare-all` smokeを実行し、失敗ならそのstepで停止する       |
| 適用までにmainのCI bytesが変わる          | 成立しうる。その場合はhash不一致でfail-closedし、既存proposalを書き換えず再登録する |

## 5. 指摘

| ID       | 深刻度 | 内容                                                | 状態                                                                               |
| -------- | ------ | --------------------------------------------------- | ---------------------------------------------------------------------------------- |
| S93-M-01 | Medium | Ubuntu image/package更新でprofile配置が変わる可能性 | install元pathを固定し、欠落時はtest前にfail-closedする。CIで実機Evidenceを取得する |
| S93-L-01 | Low    | 適用後のrollbackも二段階となる                      | rollback欄へ逆向きproposal手順を固定済み                                           |

## 6. ラウンド固有の確認

ラウンド1で、正しさ、実現可能性、境界、失敗経路、rollback、範囲漏れを確認した。未解決Critical・Highは0件であり、同じ範囲を再起動しない。

## 7. テスト結果

| 検査               | 結果          |
| ------------------ | ------------- |
| JSON構文解析       | pass          |
| Prettier形式検査   | pass          |
| trusted root比較   | `valid: true` |
| `git diff --check` | pass          |

## 8. 配布物影響

| 変更path                                 | 配布境界に入るか | 影響                                         |
| ---------------------------------------- | ---------------- | -------------------------------------------- |
| `.github/trusted-quality-proposals.json` | 入らない         | repository局所のstaged品質契約だけを追加する |

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
