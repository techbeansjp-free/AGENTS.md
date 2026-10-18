# 利用者シナリオによるASC v0.5受入調査

## 目標と完了条件

利用者が実配布物を導入して開発・更新・復旧できることを、開発checkoutに依存しない隔離した疑似プロジェクトで確認する。既存unit test件数を利用者の一連の作業の完了証明へ読み替えない。

完了は、以下の各領域について、期待結果・対象版/commit・実行経路・結果・限界が対応し、既知の不具合が修正/再検証され、残存未確認事項が明示された状態とする。未実行を成功としない。PRのmergeとreleaseはこの調査の完了条件に含めない。

| 領域 | 利用者の目的・期待結果 | 現在の証拠 |
|---|---|---|
| 初回導入 | 配布tarballをoffline導入、既存manifest/lockfileを保存 | C01–C04 成功 |
| 既存規約 | scoped/nested規約を選び、欠落時は黙って省略しない | C05/C15 成功。意味的な遵守は未評価 |
| 非Git・統合親 | Git初期化を要求せず開始、複数repoの対象を混同しない | C02/C10 成功 |
| Git共有 | clone/worktreeで同梱本体を起動、ASC_CLI/外部prefix不要 | C06 成功 |
| 更新・版指定 | 一つのworktreeを更新しても兄弟worktreeは旧版で継続 | C07/C08 成功 |
| 更新競合・復旧 | ローカル編集のある資産を無断上書きせず、解消後再試行 | C09/C18 成功。Git apply中のfile-size障害で部分書込みを再現し、選択復元後に再更新。実ディスク枯渇/電源断そのものは未実施 |
| ビルド・依存 | 既存の依存symlinkを利用し、ignore生成物を維持 | C11/C19 成功。pnpm 10.0.0、TypeScript 5.9.3で2 packageを実ビルド・実行テスト。React/ブラウザは未実施 |
| 失敗・再試行 | 失敗が別worktreeや次の正常検証を拒否しない | C12/C16 成功 |
| 検証の否定例 | 範囲外の変更、検証中のsource変更を成功扱いしない | C13/C14 成功 |
| 削除 | manifest列挙の配布資産のみ撤去、利用者成果/規約を保持 | C17 成功。hash不一致の編集済み配布資料を保存。文書に従う手動撤去でありuninstall CLIの実装ではない |
| 意味的実装・独立レビュー | 元要求から実装し、不足シナリオをReviewerが発見・是正 | 本CLI試験では未実施 |
| PR・CI・後始末 | 正しいbaseへ提出、CI遅延/失敗を扱い、merge後に利用者資産を保護 | 今回は外部通信を遮断しており未実施 |
| 複雑Goal | 契約変更・競合・中断後に必要な範囲だけ再計画 | 本CLI試験では未実施 |
| 別OS/Host | Mac/Windows、Codex/Claude Codeの実利用 | 本記録はLinux CLIのみ。他OSのCIをこの試験の実施とみなさない |

次は、更新中断/復旧、実プロジェクト相当の依存・ビルド、標準current-hostでの実装→独立レビュー→是正、複数Issue/外部PR・CIの順に、不足領域のケースを追加する。snapshot専用の状態管理を標準current-hostの実装済み能力と混同しない。過去の受入記録は対象commitと差分の適用範囲を照合してから再利用する。

## 再現方法と隔離境界

Linux、bubblewrap、Git、Node（npmを含む専用runtime prefix）が必要。

```sh
node scripts/run-consumer-scenarios.mjs
```

このdriverは配布用pack-candidateで未公開tarballを作り（公開版入力時は第1版を指定tarballで置き換え）、Node runtimeとOSコマンドをread-only、生成済みtarball・合成利用者データだけをwrite可能な`/work`として渡す。network/PID等のnamespaceを分離し、HOMEは空、環境変数はallowlist、開発repo・個人HOME・認証情報はmountしない。通常の製品起動にbubblewrapを必須化する変更ではなく、Linuxでの受入試験方法である。

`0.5.900-alpha.0/1`は更新・切戻し用の合成版番号。同じ製品ソースを異なる版番号でpackしている。公開版間の実コード差分を含む移行互換性は証明しない。版番号の合成を実リリースと誤認しない。

結果はdriverが出力する`/var/tmp/asc-consumer-acceptance-*`に保存。`provenance.json`に対象HEAD、tarball SHA256、隔離条件、所要時間、シナリオscript hashとpack内の全source hash、`results.json`にケース別結果を残す。用意したtarballから導入したCLIだけを実行し、製品モジュールを開発checkoutからimportしない。

## 2026-10-18の初回結果（合成版17ケース）

対象製品HEAD `d0cf43c5ae645a095b53d98f22b4955b0e5e30ed`。17ケース成功、隔離環境内の合計6.539秒（pack時間を含まない単発観測）。製品コードは本調査で変更していない。AI呼出し0回であり、モデルのレビュー品質・token消費・実開発の速度改善を示す数値ではない。

初回試験の失敗は試験側の3点（競合時exit 2の誤認、参照規約のコピー漏れ、合成依存のmain解決設定漏れ）だった。製品の期待動作を緩めず試験を修正し、空の環境で再実行した。今回の成功を「全機能に問題なし」や「全利用者シナリオの検証完了」とは扱わない。

独立レビューの指摘を受け、C12はexit 2・passed:false・検証コマンドexit 1を照合し、C17は編集済み配布資料をhash照合で撤去対象から除外する試験に補強した。公開版ではなく配布候補の試験であること、元ソースと試験scriptのhashを記録することも明確化した。

C02のpreview読取専用性は、実行前後の全ファイル内容hash・directory・symlink先・modeの同一性まで確認する。

## 公開済み版からの導入・更新

2026-10-18にGitHub Release v0.5.8の`agent-skill-chain-0.5.8.tgz`を取得し、配布側SHA256SUMSと一致を確認した。

- Release: https://github.com/techbeansjp-free/AGENTS.md/releases/tag/v0.5.8
- SHA256: `cd173b2240f3907421515160e1389edf81bd722f1d2d9dc3cf70554b3db93485`
- 公開側source commit: `c36e914af6bb4a2187261375f965820cb3a7578e`

```sh
node scripts/run-consumer-scenarios.mjs /absolute/path/agent-skill-chain-0.5.8.tgz
```

第1版にこの公開配布物、第2版に現在の配布候補を使い、同じシナリオで導入→更新→切戻しを確認する。公開版と候補の2つを、ともに公開済み版とは説明しない。公開版のダウンロードは試験外で行い、consumer sandboxにはネットワークを渡さない。

C18は検証専用Git shimが実際のgit apply子プロセスへfile-size制限を適用し、正常に書き終えられない状況を作る。製品や通常ユーザーへ制限を追加していない。部分更新したこと、CLIが成功を返さないこと、ownerの未commit編集が残ること、更新前inventoryの配布資産だけをrestoreすれば再実行できることを確認する。USAGEの通常更新手順へこの復旧方法を追記した。自動rollbackが実装済みとは扱わない。

## 追加結果（公開v0.5.8 → 配布候補、19ケース）

`published-results.json` / `published-provenance.json` が現在の追加試験結果。19ケースすべて成功。C19はpnpm 10.0.0とTypeScript 5.9.3の公式npm tarballをネットワーク外で取得し、sandbox内ではoffline installのみ実施。workspace linkを持つshared/appの両方を実際にtscでコンパイルし、appの実行結果をassertで確認した。検証対象は実在の利用者コードではなく合成コードであり、React・ブラウザ・DBの検証には代えない。

```sh
node scripts/run-consumer-scenarios.mjs /absolute/agent-skill-chain-0.5.8.tgz /absolute/tooling
```

`tooling`には`pnpm-10.0.0.tgz`と`typescript-5.9.3.tgz`を置く。省略時、C19はnot-runで記録する。driverは指定tarballの公開元を認証する機構ではない。公開版の入手先とSHA照合は上記の記録に基づき、任意に渡したファイルは単にsupplied-artifactとして扱う。CLIによる19ケースの成功は意味的レビュー・外部PR完走の証明ではない。

Toolingは公式npm registryの各固定版dist.integrity（SHA512）と実tarballを照合して`consumer-tooling.json`へpinした。driverは各tarballのSHA256と内包package name/versionを検査し、不一致ならsandboxへ渡す前に拒否する。
