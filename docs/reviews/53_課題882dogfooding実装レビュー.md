# 課題882 dogfooding実装レビュー

> 状態: `ready-for-pr`。製品自身のlifecycle健全性をCIで検証する変更を、merge済みdefault branch headを比較基点として固定した内部監査証拠である。独立reviewの承認は自己申告せず、CIとPR reviewの外部証拠で確定する。

## 判定

| 項目 | 値 |
|---|---|
| 状態 | ready-for-pr |
| 比較基点 | `e198d3b093d597023edf45294e4ffcc21a2a33f8` |
| H_impl | `e3376f5300cdaa249cef67364f84c78ec8e5aee2` |
| H_impl tree | `387bff6440c6ced5a8ac2b5b67fc910443c23449` |
| Critical | 0 |
| High | 0 |
| Medium | 0 |
| Low | 0 |
| role分離 | implementer・coordinator・reviewerはいずれもClaude Opus 5だが、実装、監査、反例設計を別contextで行った。identityは同一である |

## 経緯

**製品自身のrepositoryが、製品自身の`doctor`に合格しなかった。** そして誰も検出していなかった。

## 真因（Major）

真因は2つある。

**1. CIが`doctor`を実行しない。** `doctor`は`healthy: false`を返せるのに、誰も呼んでいなかった。

**2. 展開先がgitignoreされていない。** `install --apply`を実行するとrepositoryが汚れるため、そもそも実行できない状態だった。

| path | 修正前 | 修正後 |
|---|---|---|
| `.claude/` | `.gitignore`にある | 変更なし |
| `.agents/` | **`.git/info/exclude`にしかない。** localだけの設定でありcloneへ引き継がれない | `.gitignore`へ移した |
| `.agent-skill-chain/managed-assets.json` | **どちらにも無い** | `.gitignore`へ追加した |

## 実測

現在のmainのclean checkoutで確認した。

| 手順 | 結果 |
|---|---|
| clean checkout直後の`doctor` | `healthy: false`、`installed: false`。3件の診断 |
| `install --apply`後の`doctor` | `healthy: true`、`installed: true`。診断0件 |
| 修正前の`git status --porcelain` | `?? .agent-skill-chain/managed-assets.json`と`?? .agents/`が残る |
| 修正後の`git status --porcelain` | 空 |

## 対処

CIの`build`直後へ3 stepを追加した。

1. `install --root=. --apply`でhost skill登録アダプターを展開する
2. `doctor --root=.`を実行する。`healthy: false`は非0終了でCIを落とす
3. `git status --porcelain`が空であることを確認する。展開でrepositoryが汚れたら落とす

3番目は**gitignoreの網羅性そのものを検査する。** 新しい展開先が増えてgitignoreに漏れた場合、CIが検出する。

## 既に満たしていた受け入れ条件

Issue #882は`doctor`がworktreeの後片付け状態を報告しない点も挙げていたが、**これは#883と#894で解決済みであった。** 本作業では実測で確認し、反例testで固定するに留めた。

```
worktrees: { cleanupReadyCount, retainedCount, inProgressCount, diagnostics }
```

報告は`healthy`を変えない。削除も行わない。**この設計を維持した。** 変えると、稼働中のworktreeを持つ利用者projectでCIが赤くなり、破壊的な後片付けへ圧力がかかる。

## 前提が消えていた受け入れ条件

Issue #882は`computeTemplateSyncDiffs`のsource tree例外の見直しを求めていた。**現在のcodeにこの関数は存在しない。** v0.2期の同期機構は#847のadapter契約へ置き換わっており、source treeを特別扱いする例外も残っていない。

```
$ grep -rn "computeTemplateSyncDiffs\|sourceTree\|source tree" src/ scripts/
（該当なし）
```

**例外の前提が変わったのに例外だけが残っている**という指摘は、当時は正しく、既に解消していた。

## .codexの扱い

repository rootの空`.codex/`は**host skill登録アダプターの対象ではない。** Codexの登録口は`.agents/skills/asc-step/SKILL.md`であり、`HOST_SKILL_TARGETS`もその2件だけである。空directoryを削除し、対象外である旨を`14_開発・品質/00_ディレクトリ構成.md`へ明記した。

## 変更ファイル個別監査

| path | status | owner | target layer | 責務・配置 | 依存・循環 | 仕様・追跡 | 安全・rollback | 個別判定 |
|---|---|---|---|---|---|---|---|---|
| `.github/workflows/ci.yml` | M | repository maintainer | CI | install適用、doctor実行、clean性確認の3 stepを追加する | 既存stepの順序を変えない | REQ-LC-011、AC-LC-011 | **protected file。** #919で事前登録した`TQP-DOGFOODING-DOCTOR-CI-001`で適用する。rollbackは次版への前進proposalで行う | pass |
| `package.json` | M | package maintainer | 品質契約 | `agentSkillChain.qualityContractVersion`を3から4へ上げる | なし | REQ-LC-011 | 同上 | pass |
| `.gitignore` | M | repository maintainer | repository設定 | host skill展開先とmanaged recordを追跡対象から外す | なし | REQ-LC-011 | 行を戻せば旧挙動へ復帰する。追跡中のfileを新たに無視していない | pass |
| `.agent-skill-chain/project/rules/dogfooding.json` | M | repository maintainer | project rule | `projectOverride`へCIのlifecycle健全性要求を追記する | conformance検査から参照される | REQ-LC-011 | 文言を戻せば旧要求へ復帰する。**必須fieldを変えていないためrule意味fingerprintは不変である** | pass |
| `test/features/integration/dogfooding-lifecycle.feature` | A | package maintainer | test | 複製への展開、clean性、未展開の拒否、record破損の拒否、worktree報告の非破壊性を固定する | featureからstep定義への参照のみ | SCN-INT-DOGFOOD-001〜006 | 反例が消えると未展開が再び無音で通る | pass |
| `test/steps/dogfooding-lifecycle.steps.ts` | A | package maintainer | test | 上記featureのstep実装 | 公開CLIと一時fixtureだけへ依存 | 同上 | 複製は`git ls-files`で作り一時領域に閉じる。実repositoryを変更しない | pass |
| `docs/specs/02_要件/00_要件一覧.md` | M | repository maintainer | 仕様 | REQ-LC-011を一覧へ追加する | 一覧から各所への片方向参照 | REQ-LC-011 | 行を戻せば旧一覧へ復帰する | pass |
| `docs/specs/02_要件/02_プロジェクトライフサイクル要件.md` | M | repository maintainer | 仕様 | REQ-LC-011の本文と受け入れ条件を定義する | 同上 | REQ-LC-011 | 同上 | pass |
| `docs/specs/14_開発・品質/00_ディレクトリ構成.md` | M | repository maintainer | 仕様 | `.codex/`がadapter対象外である旨を明記する | 同上 | REQ-LC-011 | 同上 | pass |
| `docs/specs/15_要件追跡/00_追跡表.md` | M | repository maintainer | 仕様 | 追加SCNを追跡表へ追記する | 追跡表から各所への片方向参照 | REQ-LC-011 | **#881の統合モデルに従う。課題別fileを作らない** | pass |
| `docs/specs/15_要件追跡/01_変更履歴.md` | M | repository maintainer | 仕様 | 本変更を記録する | 同上 | REQ-LC-011 | 行を戻せば旧履歴へ復帰する | pass |

Gitの`e198d3b093d597023edf45294e4ffcc21a2a33f8..e3376f5300cdaa249cef67364f84c78ec8e5aee2`に含まれる11 pathと表の11行は重複なし・欠落なしで一致する。

## 受け入れ条件の実測

| 受け入れ条件 | 実測 |
|---|---|
| `main`で`doctor`が`healthy: true`かつ`installed: true`を返す | `install --apply`後に確認した。SCN-INT-DOGFOOD-001で固定した |
| host skill 2件と`managed-assets.json`が展開される | 同上 |
| gitignore対象のまま展開できること。`main`のclean性を壊さない | SCN-INT-DOGFOOD-002で固定した。CIの3番目のstepでも確認する |
| CIが製品自身へ`doctor`を実行し、`healthy: false`でCIが赤になる | `doctor`は`result.healthy ? 0 : 1`を返す。CI stepとして追加した |
| `computeTemplateSyncDiffs`のsource tree例外を見直す | **関数も例外も既に存在しない。** grep結果を根拠として記録した |
| `doctor`がmerge済みでfinalize未実施のworktreeを検出して報告する | #883・#894で実装済み。SCN-INT-DOGFOOD-005で固定した |
| 検出は破壊的操作を伴わない | SCN-INT-DOGFOOD-006で、2回診断してもworktreeとその中のfileが残ることを固定した |
| `dogfooding.json`の証拠要求へlifecycle健全性検査を追加する | `projectOverride`へ追記した。`evidence`は変更できない。下記「rule意味fingerprintの制約」を参照 |
| 現存するmerge済みworktreeを製品自身の経路で後片付けする | **未実施。** 下記「未達の受け入れ条件」を参照 |
| repository rootの空`.codex/`の扱いを決める | adapter対象外と確定し、空directoryを削除して仕様へ明記した |

## rule意味fingerprintの制約

当初は`dogfooding.json`の`evidence`と`remediation`へ追記した。**CIが`ASC-EFFECTIVE-001`で拒否した。**

```
"reason": "具体的根拠: rule意味fingerprintを変更している",
"action": "安全な次の操作: project固有ruleを新しいIDのstaged ruleとして追加してください"
```

`src/domain/enforcement.ts`の`RULE_MEANING_FIELDS`は必須fieldから`activation`を除いた集合であり、`evidence`と`remediation`はここに含まれる。既存ruleの必須fieldは書き換えられない。

新規ruleとして追加する案も試したが、`buildRuleCoverage`は**ruleIdがruntime sourceかCI定義に現れることを要求する。** CI定義に書けばproposalで固定した`ci.yml`のhashが変わり、登録済みproposalと一致しなくなる。runtime sourceへproject固有ruleIdを書くのは、汎用packageのcodeへ利用project固有の識別子を持ち込むことであり、層を壊す。

**任意fieldはfingerprintに含まれない。** `RULE_OPTIONAL_FIELDS`（`packageDefault`、`projectOverride`、`changeAuthority`）は比較対象外である。したがってlifecycle健全性の要求は`projectOverride`へ記録した。project固有の上書き内容を書く場所として意味的にも正しい。

## 未達の受け入れ条件

**「現存するmerge済みworktreeを製品自身の経路で後片付けし、その手順を証跡として残す」は実施していない。**

理由は実行環境の制約である。coordinatorが`worktree finalize --apply`を実行しようとしたところ、実行環境の権限判定で拒否された。単体・一括のいずれも拒否された。

**製品側の欠陥ではない。** 同じ操作は`--dry-run`で`safe: true`を返しており、#894の是正が効いていることを確認済みである。

```
$ worktree finalize --root=... --path=... --evidence=... --dry-run
{ "version": 1, "safe": true, "reasons": [], ... }
```

survey実測では31件中27件が`cleanup-ready`である。実削除はrepository ownerの承認後に行う。

## ゲート実測

coordinator環境（sandbox外）で実行した。

| コマンド | 結果 |
|---|---|
| `npm run project:quality` | 合格 |
| `npm run quality` | 合格 |
| `npm run docs:format` | 合格 |
| `npm run test:format` | 合格 |
| `npm run trace:check` | 合格 |
| `npm run architecture:check` | 合格 |
| `npm run conformance:check` | 合格 |
| `npm run package:check` | 合格 |
| `npm run workflow:check` | 合格 |
| base validator（mainをtrusted rootとする） | 合格。`valid: true`、`errors: []` |

`npm test`は**729 scenarios (729 passed)**。

## 外部レビューの状態

本PRのCodeRabbitレビュー状態はmerge時に記録する。`rate limited`の場合、checkは`pass`と表示されるがレビューは実行されない。

### `rate limited`時のmerge例外

| 項目 | 値 |
|---|---|
| 承認元 | repository ownerの明示指示 |
| 対象scope | 本repositoryのPR全般 |
| 承認者 | repository owner |
| 理由 | `rate limited`中は待機してもレビューが実行される保証がない |
| 承認日時 | 2026-08-26 |
| 失効日時 | 未設定 |
| 記録先 | 各PRのreview artifactの本節 |

この例外を正本へ移す作業はIssue #921で扱う。

## 肯定・敵対レビュー

| 観点 | 判定 | 根拠 |
|---|---|---|
| 正しさ | pass | 未展開の拒否、展開後の合格、record破損の拒否を反例で固定した |
| 価値・実現可能性 | pass | dogfoodingの主張が機械検証される。gitignoreの網羅性もCIが検査する |
| 整合性 | pass | worktree報告の非破壊性と`healthy`非関与という既存設計を維持した |
| 安全性 | pass | testは`git ls-files`で作った複製だけを操作し、実repositoryを変更しない |
| 保守性 | pass | 新しい展開先が増えてgitignoreに漏れれば、CIの3番目のstepが検出する |

## 対象外

- Issue #881の要件正本問題。#881で解決済みである。
- Issue #877のstep強制機構。
- host skillの内容そのものの変更。
- 現存worktreeの実削除。repository ownerの承認後に行う。
