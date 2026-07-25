# DESIGN: trusted gate recordingとreport materialization

- Issue: `ISSUE-283`
- 対応する SPEC: `SPEC.md`

## 要件 → 設計要素の対応表

| 要件 / AC-ID | 対応する設計要素 | 備考 |
|---|---|---|
| AC-1 | TrustedGateRecorder / GateCheckStore / ReportMaterializer | 記録からADR finalizationまで |
| AC-2 | ImmutableContextValidator / ArtifactVerifier | SHA・gate・成果物をfail-closed検証 |
| AC-3 | ActorAuthorizer / EvidenceVerifier v3 | recorder権限とreviewer独立性を分離 |
| AC-4 | 配布workflow・同期検査 | setup/upgradeはテンプレート正本を展開 |
| AC-5 | BootstrapGuard | #274の固定SHAだけを一回限り移行 |

## 責務・境界

### コンポーネント構成

- `LocalEvidenceProducer`（#274）: protected baseの隔離launcherでevidence v3をPR Reviewへ記録しdispatchする。
- `ActorAuthorizer`: dispatch actorの実効権限をGitHub APIで解決し、write以上だけを許可する。
- `ImmutableContextValidator`: PR/current head/default base/Issue/gate/profileとdefault-branch実行SHAを照合する。
- `EvidenceVerifier`: 最新attemptだけを選び、v3 schema・人数・slot・run・launcher・verdictを再検証する。
- `ArtifactVerifier`: target Git objectから成果物digestを再計算する。candidate codeは実行しない。
- `TrustedGateRecorder`: 検証済み最終reportをcanonical conclusionへ写像し、Check outputへreport/digestを保存する。
- `GateCheckStore`: GitHub Check Run。GitHubモードの唯一のゲート正本である。
- `ReportMaterializer`: same-App全conclusion中の最新Checkだけを読み、success時だけ非正本cacheを復元する。
- `AdrFinalizer`: materialize済みdesign reportと現在ADR digestを照合してstatusだけを更新する。
- `BootstrapGuard`: #274固定SHA・owner承認・Sol/xhigh PASS・非gate CI・未使用を検査し証跡を残す。

### 依存関係

```text
LocalEvidenceProducer → PR Review API
                           ↓
repository_dispatch → ActorAuthorizer → ImmutableContextValidator
                                      → EvidenceVerifier → ArtifactVerifier
                                                        ↓
                                              TrustedGateRecorder → GateCheckStore
                                                                          ↓
                                                     ReportMaterializer → AdrFinalizer
```

workflowは`repository_dispatch`でdefault branchの固定SHAをcheckoutする。入力はPR番号・gate・target SHAのみで、
reportやverdictは受け取らずAPIから再取得する。PR branchのscript・action・packageを実行しない。

## Check記録プロトコル

Recorderはcanonical名で`in_progress` Checkを作り、作成応答のApp identityをrulesetのintegrationと照合する。
検証済みreport、canonical evidence digest、review attempt、artifact digestを`output.text`へJSONで保存して
completedへ更新する。発行後にcurrent SHAのsame-App最新runを再取得し、ID・conclusion・output digestが
一致した場合だけ完了する。不一致時は作成runを`action_required`へ更新して非zero終了する。

Materializerはcurrent PR headとcanonical名を固定し、same-Appの全runを作成順で比較する。最新runが
success以外なら停止し、過去successへfallbackしない。successでもreport schema・target・gate・evidence digest・
target Git objectのartifact digestを再検証してから`reviews/<gate>.yaml`へcacheする。cacheはCheck正本の複製であり、
単独では承認根拠にならない。

## 関連ADR

```yaml
related_adrs:
  - id: ADR-0013
    relation: adopts
```

ADR-0013は同一PRでproposedとして導入するため、design gateは本文を直接承認対象に含める。

## 障害・ロールバック考慮

- stale SHA、不正gate、権限/API不明、v3不正、App不一致、最新非successはすべてsuccessを発行・復元しない。
- Check更新後の再読取失敗は同じrunを`action_required`へ倒す。復旧は証跡修正後の新dispatchで行う。
- workflowを停止する場合も既存required checkは失敗側に残り、branch protectionを緩和しない。
- ロールバックは本変更のworkflow/CLIをPRでrevertする。bootstrap bypassの再利用は許可しない。
