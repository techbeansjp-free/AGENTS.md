# ADR

```yaml
id: ADR-0005
status: proposed
title: リリース版数をpackage.json semverへ統一し、版数bumpコミットをmainへPR経由(admin merge)で反映し、marketplace/apm公開を廃止する
tags: [release, versioning, distribution, github-actions, branch-protection]
supersedes: []
superseded-by: null
deprecated-reason: null
```

## Context

agent-skill-chain 新実装（PR #191 でmainへマージ）には、旧実装の `.github/workflows/release.yml` に相当するリリース自動化が存在せず、mainのGitHub Releaseは統合マージ以降更新が止まっている。ISSUE-196 でリリース自動化を復元するにあたり、恒久的に効く2つの判断を確定する必要がある。

第1に版数体系。旧実装は `package.json` を `npm version patch` で semver bump する一方、実際のgitタグ・GitHub Release は JST日時形式 `vYYYYMMDD.HHMMSS` という別体系で生成していた。この二重体系が、ISSUE-196 の SPEC レビューで「バージョンが後退しないとは何に対してか」を曖昧にし、AC-5 の重大な不明確さの原因になった。後続の実装・検証が同じ罠を踏まないよう、版数体系そのものを設計判断として固定する必要がある。

第2に、自動リリースが行う版数bumpコミットを main へどう反映するか。自動化は `package.json` の `version` を書き換えるコミットを main に着地させる必要があるが、main は branch protection 下にあり、AGENTS.md 不変条件 I4 は「mainへの変更はPR経由のみ」を上書き不可の規約として要求する。旧設計案はこのコミットを bypass_actor 登録済み admin PAT で main へ生pushする恒久機構を採ったが、これは I4 と正面から緊張する恒久判断であるにもかかわらず ADR に未記載であった。可修復な外部要因（ゲートCIの `ANTHROPIC_API_KEY` 等 secrets 未設定）を理由に I4 違反を恒久アーキテクチャへ焼き込むべきではない、という設計ゲートの反証レビューを受け、この点を恒久判断として確定する。

第3に配布物公開の範囲。旧実装は `release-marketplace`・`apm-release` ジョブで Claude/Cursor marketplace パッケージと apm パッケージの生成物を公開していた。しかし新パッケージは npm レジストリを経由せず `npx github:techbeansjp-free/AGENTS.md` によるGitHub直接参照配備を主導線とし、配布前提が旧実装と異なる。加えて、現存する `.claude-plugin/marketplace.json` は既に削除済みのパス（`.agent-skill-chain/source/`・存在しない `.adapters/claude`）を参照したまま放置され、リポジトリの実態と矛盾している。

第4に、無人ワークフローによる自動 admin bypass が I8「安全側ラチェット」の禁止規定に抵触しないかという規範解釈上の論点。上記の版数bump反映方式（本ADR Decision で確定する、人間の都度判断を介さず機械が admin merge を自動発動する構造）について、本Issueの design-gate strict レビューで2名のレビュアの判定が割れた。一方は「既に承認済みの bypass_actor 能力を狭スコープで自動発動するもので妥当（pass）」とし、他方は「I8 が定める『autonomy の昇格は人間の明示行為のみ』の検査手段が明記する〈昇格 workflow が存在しないことを含め検査〉に、無人 workflow による自動 admin bypass が該当し得る（blocking）」とした。これは技術的欠陥ではなく規範解釈の対立であり、機械検査では決着しない。I8 が禁ずるのは「autonomy レベルそのものを人間の関与なく引き上げる昇格 workflow」であって、既に人間が承認済みの固定された特権能力を狭い機械検査可能なスコープで発動することとの境界をどう引くかが論点であった。この境界判断は本ADR自身が扱う恒久判断の一部であるため、規範解釈の帰結を本ADR内に自己完結して確定し、今後同種の疑義が再燃しないよう traceability を残す。

## Decision

**版数体系**: リリース版数は `package.json` の semver を唯一の正本とする。gitタグは `v<semver>`、GitHub Release の tag/name も同一文字列とし、`package.json`・タグ・Release の3者を常に単一の `target` 値から生成して定義上一致させる。日時形式など semver 以外の版数体系は採用しない。後退禁止（ISSUE-196 要件4）の比較は semver 正規表現 `^v[0-9]+\.[0-9]+\.[0-9]+$` に一致する既存タグのみを対象とし、旧日時形式タグ（`v20260720.060726` 等）は非一致として比較から機械的に除外する。これにより「新旧版数体系をまたいだ比較をしない」を体系選択自体で保証する。

**版数bumpコミットのmain反映方式（I4適合）**: 版数bumpコミットは main へ生pushせず、必ずPRを経由して反映する。自動化は短命ブランチ `release/bump-v<target>` 上に `chore(release): v<target> [skip ci]` コミットを作成・pushし、`gh pr create` で機械生成の版数台帳更新PRを起こし、`gh pr merge --admin --squash --subject "chore(release): v<target> [skip ci]"` でマージする。squashコミットのメッセージはブランチ側commitを自動では引き継がず、`--subject`/`--body` を明示しない限りリポジトリのsquash既定メッセージ設定（PRタイトル由来など）に従い `[skip ci]` を欠きうる。これが欠落するとmainへのsquashコミットが本ワークフローを再トリガし無限ループ防止（要件5）が破綻するため、`--subject` でメッセージそのものを明示固定し、squash既定設定に一切依存せず `[skip ci]` の生存を保証する。

このマージは required status check を bypass する。ただしこれは「新しいゲート免除カテゴリの発明」ではない。ruleset の bypass_actor には Repository admin による required status check bypass 能力が既に承認済みで恒久的に存在し、進行役はこれを `gh pr merge --admin` として都度手動発動している。本決定は、その**既存の承認済み特権bypass能力を、人間が都度手動発動する代わりに、狭く機械検査可能なシナリオに限って自動発動する**ものである。自動発動を許すのは以下2条件をいずれも機械的に満たすPRに限定する: (a) head ブランチが `release/bump-v*` に一致し、(b) 変更ファイル集合が `package.json`（および `needCommit` に伴い変化した場合の `package-lock.json`）のみである。すなわち「本Issueが設計・実装し尽くした、非Issue駆動の版数台帳更新のみを行うPR」に限定される。いずれかの条件を満たさない（bump スコープを超えた変更が紛れ込んだ）場合は自動admin mergeを行わず `human_required` として停止する。I4 が求めるのは「PR経由」であって「全チェックが緑であること」ではないため、生pushをPR経由 admin merge へ置き換えることで I4 の文言上の要求を満たしつつ、ゲートCIの secrets 未設定という可修復な別問題には一切依存しない構造とする。このbump PRは SPEC/DESIGN/PLAN/VALIDATION を伴わない機械生成の版数台帳更新のみのPRであり、Issue成果物ではなく、既に承認済みの決定（本ADRを含む ISSUE-196 の design-gate 承認）の機械的執行に過ぎない。ブランチ名に `target` 版数を含めることで同一版数のbumpブランチ・PRの重複作成を自然に防ぐ。

**残余リスクの恒久的受容**: 上記は、人間の都度判断を伴わず自動的に admin bypass を行使する構造である。レビューが対置した「進行役が都度 `gh pr merge --admin` を判断する」運用との違いは、判断者が人間ではなく機械であり、判断根拠が上記(a)(b)の機械検査に固定される点にある。この「人間の判断を介在させない自動admin bypass行使」を、狭スコープ限定・スコープ逸脱時 `human_required` 停止・secret最小権限管理を前提として明示的に受け入れる恒久判断とする。

**I8「昇格workflow」禁止規定との関係と人間承認**: Context 第4点で述べた規範解釈上の対立——無人 workflow による自動 admin bypass が I8 の検査手段〈autonomy の昇格は人間の明示行為のみ／昇格 workflow が存在しないことを含め検査〉に抵触し得るか——について、design-gate 承認プロセスを通じてリポジトリオーナー（人間）に確認し、明示的な判断を得た。**判断内容: 「既に承認済みの bypass_actors（admin）能力を、狭いスコープ（`package.json`・必要に応じ `package-lock.json` のみの変更に限定）に限って自動発動するものとして許容する。design-gate を承認扱いとし実装フェーズへ進めてよい」。** すなわち本決定が発動するのは autonomy レベルそのものを機械が自律的に引き上げる「昇格 workflow」ではなく、既に人間が承認済みで恒久的に存在する固定特権を、機械検査可能な狭スコープに限定して発動する執行機構であり、I8 が禁ずる自律的 autonomy 昇格には該当しない、という境界解釈をリポジトリオーナーが確定した。I8 が要求する「人間の明示行為」は、まさにこの進行役からリポジトリオーナーへの確認と、それに対する上記の明示的承認によって充足されている。本 ADR（design-gate 承認プロセスを経て accepted へ遷移する成果物）自体がこの人間の明示行為の証跡であり、今後この構造に対し I8 抵触の疑義が再燃した場合は本節が確定した境界解釈と人間承認の記録を参照して決着させる。

**版数bumpの追跡可能性（I1）の結線先**: 版数bumpコミットの由来は ISSUE-196（本Issue、リリース自動化の設計・実装Issue）である。bumpを引き起こした個別のIssue（paths対象を変更した側）ではない。I1「全変更はIssueに紐づく」は、当該bumpを「リリース自動化という仕組みが機械的に生成した成果」として本Issue（仕組みの由来）へ結線することで満たす。個別変更Issueとbumpコミットを1:1で結線することは要求しない。

**配布物公開の範囲**: 旧 `release-marketplace`・`apm-release` に相当する marketplace/apm 生成物の公開ジョブは新実装で踏襲せず廃止する。主導線 `npx github:...` は生成物公開を要さないためである。併せて、実態と矛盾し誤解を招く `.claude-plugin/marketplace.json` を ISSUE-196 の実装で削除する。

## Consequences

- リリース版数の後退判定・整合判定が単一 semver 軸に閉じ、旧実装の二重体系に起因する曖昧さが解消される。実装・検証は semver 比較1本で AC-4/AC-5 を機械検証できる。
- 初回の自動リリースは、既存の semver 一致タグが無いため `package.json` 現行版数 `0.2.0` を seed として patch 加算した `v0.2.1` となる。旧日時形式タグは以後のリリース系列に一切影響しない。
- 版数bumpが main へ生pushされず必ずPR経由 admin merge で反映されることで、I4「mainへの変更はPR経由のみ」を文言通り満たす。branch protection の緩和や生push特権を恒久機構へ焼き込まず、既に運用中の admin merge 特権と同一の権限モデルに収まる。ゲートCIの secrets 未設定という別問題からリリース自動化が切り離され、当該問題の解消有無に関わらずリリースが機能する。
- bump PR の Check Run 未通過マージは、新規のゲート免除カテゴリではなく、既存の承認済み bypass_actor 能力を狭スコープ（head=`release/bump-v*` かつ変更=`package.json`（±`package-lock.json`）のみ）で自動発動したものである。スコープを逸脱したPRは自動admin mergeせず `human_required` で停止するため、無検査マージの対象は機械生成の版数台帳更新に閉じる。ただし bump の main 反映には bypass_actor 登録済み admin 資格情報（`RELEASE_MAIN_PAT`）が必要であり、この特権が漏洩・誤用されれば任意コミットの無検査マージに悪用されうる。secret の最小権限管理（bump PR の admin merge 用途に限定）と失効時の再登録運用を前提とする。生push権限が不要になった分、旧設計より攻撃面は縮小する。
- squashコミットのメッセージを `--subject` で明示固定することで、リポジトリのsquash既定メッセージ設定に依存せず `[skip ci]` の生存が保証され、bump PR のmainマージが本ワークフローを再トリガする暴走リリース経路（要件5破綻）が構造的に閉じる。
- admin merge が failした残骸として stale な bumpブランチ・PR が生じうる。次runは同一 `target` の既存ブランチ・PRを再利用してマージを再試行し、`target` が進んだ場合の stale PR は掃除対象となる（自己修復・冪等性は維持される）。
- marketplace/apm 経路の利用者がいた場合、その配布は停止する。現時点で主導線は `npx github:...` に一本化されているため実害は想定しないが、将来 marketplace 配布を再開する場合は本ADRを別ADRでsupersedeし、正しい生成元パスに基づく `marketplace.json` の再構築と公開ジョブの再設計を要する。
- `.claude-plugin/marketplace.json` の削除により、stale なパス参照によるツール・利用者の誤解が解消される。
