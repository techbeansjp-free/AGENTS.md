# ADR-0001 Git tagをSource Identity、GitHub Release assetをDistributionとする

- 状態: 承認済み
- 日付: 2026-09-29
- 決定者: repository maintainer（owner確定入力、Issue #1527）

## 文脈

Issue #1527以前、release workflowはGit tagとGitHub Releaseを作成するが、GitHub Releaseに配布物（tgz）を添付しなかった。利用者が実行する`agent-skill-chain`の実体は次の3経路のいずれかであり、どれも「今実行しているcodeがどのrelease versionか」を検証可能な形で示さなかった。

1. `npx github:techbeansjp-free/AGENTS.md[#<tag>]`（Git remoteから直接取得するsource経路）
2. GitHubが各Releaseへ自動生成する「Source code (zip/tar.gz)」（Gitのsource treeそのもの）
3. 手動でclone・buildしたsource

3経路すべてが同じ`package.json`を共有し、その`version`はrelease追随をやめたsentinel（Issue #1184）である。したがって、どの経路から実行していても`agent-skill-chain --version`相当の手段が無く、doctorやinstall/updateの記録versionが実際に検証済みのreleaseと一致する保証も無かった。

Issue #1216で「npx github維持」（source経路をこの後も使えるようにする）が決定済みである。本ADRはそれを覆さず、正式配布物という別の経路を追加する。

## 決定

**Git tagをSource Identity（どのcommitがreleaseされたかの証跡）とし、GitHub Release asset（固定名`agent-skill-chain.tgz`）をDistribution（利用者が実際に導入するbyte列）として区別する。** 両者は同じrelease対象SHAから1回のworkflow実行で生成され、`release-identity.json`（`version`・`tag`・`sourceSha`・`contentDigest`）がその対応関係を配布物内から検証可能にする。

- Source Identity: Git tag（`v<X.Y.Z>`）。誰でも`git`でcloneし、任意のcommitからbuildできる。**このtreeからbuildした実行はrelease版として自称しない**（`release-identity.json`が存在しないため`source`として識別される）。
- Distribution: GitHub Release asset `agent-skill-chain.tgz`。`build_distribution` jobが検証済みrelease対象SHAの一時treeへversionと`release-identity.json`を1度だけ付与し、`github_release` jobがdraft作成→添付→3者artifact digest一致確認→publishの順で公開する。**これだけが「release version」を名乗れる配布物である。**
- GitHubが自動生成する「Source code (zip/tar.gz)」は、Git tagが指すsource treeそのものであり、上記のDistributionではない。`release-identity.json`を含まないため、これを展開して実行しても`source`として識別される（誤表示しない）。

## 選択肢と不採用の理由

| 選択肢 | 不採用の理由 |
|---|---|
| npm registryへ公開し、npmのversion解決を正本にする | owner決裁で不採用が既に確定している（`.agent-skill-chain/project/rules/no-registry-publish.json`、`private: true`）。本ADRはこの決定を変更しない |
| `package.json.version`をrelease追随させ、それをrelease identityにする | Issue #1184でsentinel化を決定済み。既定branchへの書き込み無しでreleaseする制約（release-only commitを作らない）と両立しない |
| GitHubの自動生成source archiveを正式配布物として扱う | 検査していないbyte列（`npm run build`前のsource tree）を配布物と呼ぶことになり、BR-02「公開するbyte列は検査したbyte列と同一である」に反する |
| `npx github:`経路を廃止し、tgz配布だけにする | Issue #1216で「npx github維持」が既に決定済み。本ADRは維持したうえでtgz配布を追加するに留める |

## 影響

- `agent-skill-chain --version`、`doctor`、`install`/`update`の警告文が新設される（FR-08〜FR-12）。
- release workflowに`build_distribution` jobが追加され、`github_release` jobがdraft/publish分離される（FR-01〜FR-07、FR-13）。
- 利用案内・READMEの正式取得元の説明が、asset URL（版固定・`latest`）を主とし、`npx github:`をsource経路として区別する形へ変わる（FR-14、FR-15）。
- `npx github:`経路自体は変更・廃止しない（Issue #1216の決定を維持）。

## 関連

- Issue #1527
- Issue #1184（`package.json.version`のsentinel化）
- Issue #1216（`npx github:`維持の決定）
- `docs/specs/12_運用保守/00_運用設計.md`（release workflowの段・権限境界表）
- `docs/specs/02_要件/03_外部連携要件.md`（REQ-GH-007）
- `docs/specs/02_要件/02_プロジェクトライフサイクル要件.md`（REQ-LC-012）
