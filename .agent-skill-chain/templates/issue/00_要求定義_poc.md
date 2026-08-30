# 00 要求定義（PoC集約版）

> `poc`は仮説を最速で検証するため、隔離した疑似project、事前定義したuse case・BDD scenario・機械observableをこの1文書へ固定する明示モードである。観測期間の経過を完了条件にせず、定義済みrunnerの実行直後にexact HEADへ結び付くEvidenceで判定する。[成果物用語と責務境界](../../docs/01_開発ワークフロー.md#成果物用語と責務境界)を正本とし、正式開発、release、自動merge、本番cleanupとして扱わない。宣言またはhigh risk確認が不完全な場合と、high risk条件を検出した場合は`full`へ単調昇格するか停止する。

## 0. 管理情報

| 項目         | 内容                                                |
| ------------ | --------------------------------------------------- |
| モード       | `poc`                                               |
| 件名         | （人が識別できる件名）                              |
| 正本         | （耐久トラッカー。同期前は「未同期」）              |
| 作成・更新日 | （ISO 8601形式）                                    |
| 安定識別子   | （必要な場合だけ。UUIDを一律必須にしない）          |
| 耐久性       | 書き込み後読み取り確認の完了までは一時情報          |
| 停止点       | pull request。release、自動merge、本番cleanupは禁止 |
| 仕様の所有箇所 | （この要求を所有する`docs/specs/`の該当箇所と引用。無い場合は仕様側の欠落として先に起票する） |

## 1. 目的、現在、期待状態（必須）

- 検証する仮説:
- 現在の問題:
- 期待する観測結果:
- PoCで得る判断材料:

## 2. 対象範囲と権限（必須）

- 対象内:
- 対象外:
- 維持する既存動作:
- 許可済みの書き込み:
- 別承認が必要な操作:
- 停止点: pull request

## 3. ドメイン影響（必須）

- 境界づけられたコンテキスト:
- 変更するモデル・操作:
- 既存の耐久用語台帳を読んだ証拠:
- ドメイン用語台帳の候補差分（用語ID、標準語候補、定義、コンテキスト、出典、類義語・禁止表現、状態）:
- business rule候補と関係する用語ID:
- 守る不変条件:
- 他コンテキストへの影響がない根拠:

## 4. PoC宣言（必須）

| 項目                     | 宣言                                                                                 |
| ------------------------ | ------------------------------------------------------------------------------------ |
| PoC目的                  | （検証する仮説と目的）                                                               |
| 隔離fixture ID           | （`FIX-...`の安定ID）                                                                |
| fixture root             | （repository相対の隔離疑似project path）                                             |
| 隔離境界Evidence         | （実環境・実data・外部副作用から隔離される機械的根拠）                               |
| 初期化Evidence           | （同じ初期状態へ戻せる機械的根拠）                                                   |
| runner ID                | （`RUN-...`の安定ID）                                                                |
| runner path              | （fixture内でprojectが所有する定義済みrunnerの相対path）                             |
| 成功条件                 | （観測可能な判断条件）                                                               |
| 中止条件                 | （停止する判断条件）                                                                 |
| 非対象                   | （今回扱わない範囲）                                                                 |
| データ・security上の制約 | 個人情報・機密情報を扱わず、検証用データだけを使用する。例外を発見した場合は停止する |
| 責任者                   | （判断責任者）                                                                       |
| full昇格条件             | 成功条件を満たして正式開発へ移す場合、またはhigh risk・不足成果物を検出した場合      |
| 廃止条件                 | 中止条件を満たした場合、仮説の採否を決定した場合、または継続責任者が不在になった場合 |

### 4.1 定義済みuse case（1件以上）

| use case ID | 利用主体 | 目的 |
| ----------- | ----- | ---- |
| UC-... | （利用者・system） | （達成したいこと） |

### 4.2 BDD scenario（各use caseに1件以上）

| scenario ID | use case ID | Given | When | Then | 固定argv |
| ----------- | ----------- | ----- | ---- | ---- | -------- |
| SCN-... | UC-... | （隔離fixtureの前提） | （runnerが行う操作） | （観測可能な結果） | （JSON文字列配列。任意commandではない） |

### 4.3 機械observable（各scenarioに1件以上）

| observable ID | scenario ID | 種別 | 対象 | 期待値 |
| ------------- | ----------- | ---- | ------ | -------- |
| OBS-... | SCN-... | exit-code / stdout-digest / stderr-digest / file-digest | （file-digestだけfixture相対path。その他は`-`） | （exit-codeは0、その他はSHA-256） |

ASCは検証対象HEADに追跡済みでlive bytesとも一致するfixtureだけをHEAD blobから一時copyへ復元し、実測digestで固定したNode runnerを宣言argvで実行する。任意shell・任意command・外部作成Evidenceは受け付けない。Linuxではbubblewrapのmount/PID/network等のnamespaceとread-only system mount、prlimit、timeout、出力上限を主隔離境界とし、Node Permission Modelは補助防御とする。実行ごとの`exitCode=0`・`signal=null`、ASCが計測したstdout/stderr/file digest、`declarationDigest`、fixture/runner digest、result/execution/global digest、exact `headSha`がすべて一致した場合だけ`poc-observations/<headSha>.json`をappend-onlyで固定してStep 9以降へ進める。

## 5. high risk確認（必須）

| 条件ID                 | 有無 | 根拠                          |
| ---------------------- | ---- | ----------------------------- |
| public-api             | 不明 | （公開API・公開契約への影響） |
| personal-data          | 不明 | （個人情報を扱わない根拠）    |
| confidential-data      | 不明 | （機密情報を扱わない根拠）    |
| external-exposure      | 不明 | （外部公開しない根拠）        |
| irreversible-operation | 不明 | （不可逆操作を行わない根拠）  |

`あり`、`不明`、根拠なし、変更fileによるquick失格条件の検出時はPoCを継続せず、`full`へ昇格するか停止する。

## 6. 要求、受け入れ条件、実行可能な受け入れ例（必須）

| ID    | 要求・受け入れ条件       | 観測方法                   | シナリオID |
| ----- | ------------------------ | -------------------------- | ---------- |
| AC-01 | （真偽を判定できる条件） | （コマンド、画面、記録等） | SCN-...    |

- project policyが選択した言語とrunner形式の実行可能な受け入れ例:

## 7. 最小設計

### 開発考慮事項の適用判定（必須）

| ID               | 考慮事項                                  | 判定                        | 理由                   | 要求・確認証拠                                       |
| ---------------- | ----------------------------------------- | --------------------------- | ---------------------- | ---------------------------------------------------- |
| DC-PRIVACY | Privacy/Security by Design | applicable / not-applicable | （範囲を限定した理由） | （AC・調査証拠） |
| DC-OBSERVABILITY | Secure Logging・Observability・運用可能性 | applicable / not-applicable | （範囲を限定した理由） | （ログ・保持・rotation・監視・復旧または対象外証拠） |
| DC-UX | Human-Centered UI/UX・アクセシビリティ | applicable / not-applicable | （範囲を限定した理由） | （利用場面・ACまたは非UI証拠） |
| DC-TOKENS | Design System・Design/Layout Token | applicable / not-applicable | （範囲を限定した理由） | （UI条件・tokenまたは非該当証拠） |

- 入力:
- 出力:
- 変更する責務:
- 依存方向:
- dependency graphのtopological orderと循環反例:
- authority/evidenceの自己参照を防ぐ方法:
- 信頼境界と承認:
- 失敗時の動作:
- 原子性・並行実行:
- 復旧・ロールバック:

## 8. 実装とテストの計画

| 順序 | 最小変更 | 必要Evidence                               | 合格条件     |
| ---: | -------- | ------------------------------------------ | ------------ |
|    1 | （変更） | （仮説・risk・ACに応じた再現可能な証拠） | （観測結果） |

- project policyが選択したtest layerごとの検証:
- 型検査・既存テスト一式:
- project policyが選択した静的検査:
- 実環境、実リモート、他worktreeを変更しない方法:

### 実装中発見の前向き記録

`workflow assess-discovery`へ`changedContractKinds`を含む構造化入力を渡す。`stop-or-promote-full`は判定だけではfileを変更しない。停止を選ぶ場合はその理由を下表へ記録し、正式開発を選ぶ場合だけ同じstagingへ`workflow promote-full`を明示実行する。

| 発見ID | 事実 | 影響 | 判断 | 対処 | 検証 | 仕様更新 | CLI disposition |
|---|---|---|---|---|---|---|---|
| DISC-001 | （観測事実） | （仮説・境界・AC） | （継続 / 契約再確定 / 停止 / full昇格） | （実施内容） | （再現可能なEvidence） | （更新先 / no-spec-impact根拠） | continue / rebaseline-affected-contracts / stop-or-promote-full |

## 9. P-01〜P-07の証拠

| 原則            | 証拠                       |
| --------------- | -------------------------- |
| P-01 worktree   | （専用作業場所）           |
| P-02 Markdown   | （この文書と判断記録）     |
| P-03 UNIX       | （単一責務と入出力）       |
| P-04 DDD        | （コンテキストと不変条件） |
| P-05 BDD        | （ACとSCNの対応）          |
| P-06 Evidence-driven Verification | （仮説の成否を判定する最小Evidence） |
| P-07 Zero Trust | （入力・状態・権限検証）   |

## 10. 仕様、図表、識別子

- `docs/specs/`更新対象、または範囲を限定した`no-spec-impact`根拠:
- 図表: 理解を大きく助ける場合だけ使う。理由:
- UUID等の識別子: 必要 / 不要。理由:

## 11. リスク、昇格・廃止判断、再開地点

- 主な失敗・悪用経路:
- 安全側への縮小:
- `full`昇格の根拠:
- 正式開発への昇格時に不足する成果物:
- 廃止時の検証資産の扱い:
- Step 10最終reviewの計画（reviewer割当・確認観点）:
- 次に実行するステップ:
- 再開に必要な状態:
