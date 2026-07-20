# DESIGN: agent-skill-chain — 完全自走の実効化: ruleset実適用・worker/review adapterのclaude切替実機検証

- Issue: `ISSUE-180`
- 対応する SPEC: `SPEC.md`

## 目的・対象範囲・前提・用語

本設計の目的は、リポジトリ `techbeansjp-free/AGENTS.md` において「完全自走（人間が介在しなくても、真に危険な場合以外は止まらない）」を、既存機構を新規実装せずにライブ環境で有効化・機械強制する具体的方式を確定することである。対象は3点。(1) ライブの GitHub 側でゲート Check Run（`agent-skill-chain/{spec,design,implementation,validation}-gate` と `verify`）を `main` と統合ブランチ双方で required として機械強制する。(2) `worker.adapter`/`review.adapter` を `human` から `claude` へ切り替える。(3) 本物の `claude` CLI で `launch_worker` を人間介在なく1セグメント完走させ、正常経路で `human_required` が誤発火しないこと・真の異常時のみ発火することを実測する。

前提: 本リポジトリは agent-skill-chain の**正本（配布元）**であると同時に、その規律を自らに適用する**ドッグフーディング消費者**でもある二役を兼ねる。正本アセット（`.agent-skill-chain/templates/` 配下の配布物）へ消費者固有・一過性の設定を混入させてはならない（混入すると `setup-ruleset.sh` 経由で全下流消費者へ再配布されてしまう）。

用語（自己完結のため本文で定義する）:
- **required check**: branch protection / ruleset でマージ条件として必須指定された Check Run。未達の PR はマージ不可になる。本 Issue の対象は `agent-skill-chain/{spec,design,implementation,validation}-gate` と CI job 名 `verify` の計5コンテキスト。
- **統合ブランチ**: 本 Issue 群の base である `chore/162-agent-skill-chain-bootstrap`。各 Issue の PR を `main` への最終マージ前に集約する一過性ブランチ。最終マージ後は削除される想定。
- **正本 ruleset**: `.agent-skill-chain/templates/github/provisioning/rulesets/main.json`。`conditions.ref_name.include` は現状 `refs/heads/main` のみを対象とし、required_status_checks に上記5コンテキストを定める。`setup-ruleset.sh`（`setup ruleset` CLI の薄いラッパー）が対象リポジトリの GitHub Rulesets API へ適用する。
- **launch_worker**: `.agent-skill-chain/adapters/claude.sh` のセグメント作業ワーカー起動関数。lease取得 → `segment start`（role_contract取得）→ ワーカー起動 → 完了確認（`report latest` の直近レコードの `status=completed` かつ `target_sha` が push 済み HEAD と一致）→ lease解放、の順で1セグメントを機械的に完走させる。認証欠如・CLI不在・timeout・完了偽装検知の各異常では `report_status blocked`（`human_escalation_requested` 扱い）を書いて非0非3で返すフェイルセーフを持つ。
- **使い捨て検証**: 検証専用に作成し確認後にマージせず close・削除する一回性のブランチ／PR。ライブの機械強制やダミー失敗の挙動を実測するために用い、成果物・履歴を `main`・統合ブランチへ混入させない。
- **human_required（誤発火）**: 認証あり・CLI 利用可という正常な前提のもとで、`launch_worker` のフェイルセーフ経路や `launch_gate_reviewer` の `gate mark-human-required` が呼ばれてしまうこと。

## 要件 → 設計要素の対応表

| 要件 / AC-ID | 対応する設計要素 | 備考 |
|---|---|---|
| 要件1（ruleset実適用） / `AC-1`,`AC-2` | 設計要素A-1「main への正本 ruleset 適用」 | 正本 `main.json` を無変更で `setup-ruleset.sh` により実適用 |
| 要件2（main・統合ブランチ双方での機械強制） / `AC-3` | 設計要素A-2「統合ブランチ保護の実現方式」（本文「統合ブランチ機械強制の実現方式（設計判断）」で採用案(b)を確定） | 採用: 統合ブランチへの branch protection 個別適用。却下: (a)正本 ruleset の ref 拡張・(c)別 ruleset |
| 要件3（failing check がブロックする実機確認） / `AC-4` | 設計要素A-3「使い捨て失敗 PR による実機確認」 | `verify` を意図的に失敗させる使い捨て PR で `mergeable != MERGEABLE` を実測 |
| 要件4（adapter の claude 切替） / `AC-5` | 設計要素B「config の adapter 切替」 | `worker.adapter`・`review.adapter` を `human`→`claude` |
| 要件5（launch_worker 実機完走） / `AC-6`,`AC-7` | 設計要素C「launch_worker 実機完走手順」 | 使い捨て Issue・disposable segment で本物 `claude` CLI 起動、証跡採取 |
| 要件6（正常経路で human_required 誤発火せず／真の異常時のみ発火） / `AC-8`,`AC-9` | 設計要素C「human_required 対照確認」 | 正常経路（発火せず）と認証欠如注入（発火）の対照。異常注入の自動テストは既存 `worker-adapters.test.ts` が網羅済み |
| 要件7（既存テストスイート維持） / `AC-10` | 設計要素D「回帰の維持」 | adapter 切替はテストの tmp-repo 隔離により無影響。`npm test` 全 pass を維持 |

## 責務・境界

### コンポーネント構成

#### A. ライブ GitHub 保護の実適用（要件1・要件2・要件3）

- **A-1. `main` への正本 ruleset 適用**（AC-1・AC-2）: 正本 `.agent-skill-chain/templates/github/provisioning/rulesets/main.json` を**無変更**のまま、`.agent-skill-chain/scripts/setup-ruleset.sh`（`setup ruleset` CLI の薄いラッパー）経由で `techbeansjp-free/AGENTS.md` へ適用する。`rulesetStep`（`src/commands/setup.ts`）は既存 ruleset 一覧を取得し、同名 `main-protection` があれば `PUT`、無ければ `POST` する冪等実装であり、現状 `[]`（未適用）なので新規 `POST` になる。適用後、ruleset `main-protection` が `enforcement: active` で存在し、`required_status_checks` に5コンテキスト（`agent-skill-chain/spec-gate`・`design-gate`・`implementation-gate`・`validation-gate`・`verify`）が含まれることを GitHub API で実測確認する。
  - **既存 classic 保護との共存**: `main` には現状 classic branch protection（`required_status_checks.contexts: ["self-enforce"]`, app_id 15368）が別途存在する。ruleset と classic protection は GitHub 側で**論理和（union）**として評価されるため、ruleset 適用後の `main` は「`self-enforce`（既存）＋5コンテキスト（新規）」がいずれも required になる（より厳格側へ動くのみ）。既存 `self-enforce` 保護の是非・整理は本 Issue のスコープ外（SPEC.md スコープ外「過去状態の遡及監査」）とし、削除・改変しない。

- **A-2. 統合ブランチ保護の実現方式**（AC-3）: 統合ブランチ `chore/162-agent-skill-chain-bootstrap` は現状 protection 未設定（`branches/<branch>/protection` が 404）である。ここへ同等の required check を機能させる。実現方式の比較検討と採用判断は後述「統合ブランチ機械強制の実現方式（設計判断）」に記す。**採用案: 統合ブランチへ classic branch protection を個別適用する**（`PUT /repos/{owner}/{repo}/branches/{branch}/protection`）。正本 `main.json` は一切変更しない。

- **A-3. 使い捨て失敗 PR による実機確認**（AC-4）: A-1・A-2 適用後、`verify` を意図的に失敗させる差分を含む使い捨てブランチ・PR を作成し、`gh pr view --json mergeable,statusCheckRollup` で `mergeable` が `MERGEABLE` でない（required check 未達によりマージ不可）ことを実測する。`verify` を確実に失敗させる差分としては、ライブ対象ファイルへの禁止語（`lint-vocab` 違反）混入、または既存単体テストを1件失敗させる改変を用いる（`verify` job 内の型検査・テスト・lint いずれの失敗も `verify` の失敗として伝播する）。確認後、この使い捨て PR・ブランチはマージせず close・削除し、`main`・統合ブランチへ混入させない。

#### B. config の adapter 切替（要件4・AC-5）

`.agent-skill-chain/config/agent-skill-chain.yaml` の `worker.adapter`（現 `human`）と `review.adapter`（現 `human`）をいずれも `claude` へ変更する。これは実機検証を成立させるための設定変更であり、恒久既定値とするかの意思決定は SPEC.md スコープ外。
- **回帰無影響の根拠**（AC-10 と連動）: テストスイートは adapter の実値をリポジトリ本体から読まず、`test/helpers/tmp-repo.ts` の `setWorkerAdapter`/`setAdapter`/`unsetAdapter` により各テスト専用の tmp-repo 内で明示設定する（例: `gate-judgment.test.ts` は `unsetAdapter` で除去し「未設定時の CLI 既定フォールバック（`claude`）」を検証する）。したがって本体 config の値を `claude` に変えてもテストの期待は変わらない。

#### C. launch_worker 実機完走・human_required 対照確認（要件5・要件6）

- **C-1. 検証セグメントの選定**（AC-6・AC-7）: 使い捨て Issue を1件用意し、launch_worker の全契約経路（lease取得→segment start→本物 `claude` CLI 起動→ワーカー自身の checkpoint push＋`report_status completed`→完了確認→lease解放）を最も副作用少なく通せる**`spec` セグメント**を第一候補とする。`spec` は上流セグメント成果物への依存が無く、単一の `SPEC.md` 生成のみで完結し、`launch_worker` が要求する「report latest が `status=completed` かつ `target_sha` = push 済み HEAD 一致」を満たしやすい。副作用の局所化のため、この検証は**ローカルバックエンド（`coordination.backend: local`）の使い捨て作業ツリー**で行うことを推奨する（GitHub 上に検証用 Issue/PR/ref を残さず、lease も Git 管理下状態ファイルで完結するため後始末が容易）。ただし launch_worker の契約自体は backend 非依存であり、GitHub バックエンドでの実施を妨げない。
- **C-2. 完了判定と証跡**（AC-6・AC-7）: `launch_worker <issue_id> spec` が終了コード0で返り、`report latest <issue_id> spec` の直近レコードが `status=completed` かつ `target_sha` が `git rev-parse HEAD` と一致し、lease が解放（`lease-release` 済み）されていることを確認する。launch_worker の標準出力・標準エラー（認証実値は非出力）と report-status 記録を証跡として採取し VALIDATION.md に記載する。
- **C-3. human_required の対照確認**（AC-8・AC-9）:
  - **正常経路（発火しないこと）**: C-2 の正常起動中および完了時に、フェイルセーフ経路（`report_status blocked` の `human_escalation_requested` 扱い）が一度も発火していないこと（report 履歴に blocked が無いこと）を確認する。
  - **異常注入（真の異常時のみ発火すること）**: 認証欠如（`env -u ANTHROPIC_API_KEY -u CLAUDE_CODE_OAUTH_TOKEN` で launch_worker を起動）を対照条件として注入し、`report_status blocked`（`human_escalation_requested=true`, `blocked_reason` に「認証」を含む）が発火し非0非3で返ることを確認する。この対比により「正常経路では発火せず、真の異常時のみ発火する」ことを裏付ける。
  - **自動テストの現況**: 認証欠如・起動失敗・完了偽装・target_sha 不一致の各フェイルセーフは `test/integration/worker-adapters.test.ts` が WORKER_CMD スタブ＋env 操作で既に網羅している（AC-9 の automated 部分は追加実装不要。既存テストが pass することを AC-10 の回帰確認で担保する）。本 Issue で新規に加えるのは本物 `claude` CLI を用いた**正常経路との対照（manual/live 部分）**である。

#### D. 回帰の維持（要件7・AC-10）

本 Issue の全変更（config の adapter 切替、DESIGN/PLAN 等の文書追加）を統合ブランチ上へ反映した状態で `npm run build && npm test` が全 pass することを実測確認する。ライブの ruleset/branch protection 適用は GitHub 側の状態変更でありコードベースを変えないため、テスト結果には影響しない。config の adapter 切替は B の根拠により無影響。

### 依存関係

```text
A-1(main ruleset適用) ─┐
A-2(統合ブランチ保護) ─┼→ A-3(使い捨て失敗PRでブロック実機確認)
B(config adapter切替) ──→ C(launch_worker実機完走・human_required対照) ─→ D(回帰: npm test 全pass)
```

循環依存は無い。A 群（GitHub 保護）と B→C（adapter・自走実機）は独立に着手できる。D は全変更反映後に行う。

## 統合ブランチ機械強制の実現方式（設計判断）

要件2/AC-3 が求める「`main` と統合ブランチ双方で required check を機械強制する」実現方式について、以下3案を比較した。

### 採用案 (b): 統合ブランチへ classic branch protection を個別適用する

`PUT /repos/techbeansjp-free/AGENTS.md/branches/chore%2F162-agent-skill-chain-bootstrap/protection` に、`main.json` と同一の5 required contexts を持つ classic branch protection を適用する。正本 `main.json` は一切変更しない。

採用理由:
1. **正本アセットの純粋性を保つ**: 統合ブランチ名 `chore/162-agent-skill-chain-bootstrap` は本リポジトリのブートストラップ限定・一過性の構築物であり、下流の消費者リポジトリには存在しない概念である。これを正本 `main.json`（`setup-ruleset.sh` 経由で全消費者へ配布される）へ書き込むと、消費者へ無意味な ref パターンが再配布され、二役（正本×消費者）の境界を侵す。本リポジトリはこの種のドッグフーディング固有値の配布物への漏洩を過去に繰り返し修正してきた経緯があり、同種の混入を避ける。
2. **一過性・可逆性**: 統合ブランチは `main` への最終マージ後に削除される想定の一過性ブランチである。branch protection は当該ブランチに対して命令的（imperative）に適用・削除でき、ブランチ削除時に自然に消える。正本アセットの構造を恒久的に変える案(a)より切り戻しが局所的で安全。
3. **SPEC の観測状態を直接解消する**: SPEC.md が現状として観測した「統合ブランチが protection 未設定＝404」を、まさに `branches/<branch>/protection` エンドポイントを 404 でない状態にすることで直接解消する（AC-3 の検証手段が参照するエンドポイントと一致）。

### 却下案 (a): 正本 ruleset `main.json` の `conditions.ref_name.include` を拡張する

`refs/heads/chore/162-*` 等のパターンを `main.json` の include に追加する案。**却下**。理由: 上記採用理由1の裏返しで、正本かつ配布物である `main.json` に消費者固有・一過性のブランチ名パターンを恒久的に焼き込むことになり、`setup-ruleset.sh` で全下流消費者へ再配布される。`verify-template-sync.sh` の対象でもあり、消費者側にも無意味な ref パターンが同期される。正本／消費者の分離という本システムの中核前提に反する。

### 却下案 (c): 統合ブランチ用の別 ruleset を ad-hoc に作成する

`main.json` とは別に、`refs/heads/chore/162-agent-skill-chain-bootstrap` を対象とする専用 ruleset（例: `integration-branch-protection`）を GitHub API で ad-hoc 作成する案。正本 `main.json` を汚さない点は採用案(b)と同等で、機構としては成立する。しかし**却下**。理由: (i) ruleset は `branches/<branch>/protection` エンドポイントを populate しないため、SPEC.md が明示する「404 の解消」という AC-3 の観測指標を文言どおりには満たさない。(ii) 一過性ブランチ1本のために独立した ruleset オブジェクトを増設するのは、単一の branch protection PUT に比べ管理面（一覧・削除・混同リスク）が重い。UNIX 原則「疑わしい機能は追加しない」に照らし、より小さい面積の手段（採用案(b)）を選ぶ。

### 採用案の具体コマンド案

`main` への ruleset 適用（A-1）:

```bash
# 正本 main.json を無変更で実適用（冪等: 既存 main-protection があれば PUT、無ければ POST）
./.agent-skill-chain/scripts/setup-ruleset.sh techbeansjp-free/AGENTS.md
# 確認
gh api repos/techbeansjp-free/AGENTS.md/rulesets            # [] でなく main-protection(active) が出る
gh api repos/techbeansjp-free/AGENTS.md/rulesets/<id> --jq '.rules[] | select(.type=="required_status_checks")'
```

統合ブランチへの branch protection 適用（A-2、body 案）:

```bash
gh api -X PUT \
  "repos/techbeansjp-free/AGENTS.md/branches/chore/162-agent-skill-chain-bootstrap/protection" \
  --input - <<'JSON'
{
  "required_status_checks": {
    "strict": true,
    "contexts": [
      "agent-skill-chain/spec-gate",
      "agent-skill-chain/design-gate",
      "agent-skill-chain/implementation-gate",
      "agent-skill-chain/validation-gate",
      "verify"
    ]
  },
  "enforce_admins": false,
  "required_pull_request_reviews": {
    "required_approving_review_count": 0,
    "dismiss_stale_reviews": true,
    "require_code_owner_reviews": false
  },
  "restrictions": null
}
JSON
# 確認（404 が解消され protection が返る）
gh api "repos/techbeansjp-free/AGENTS.md/branches/chore/162-agent-skill-chain-bootstrap/protection"
```

補足:
- `enforce_admins: false` は `main` の既存 classic 保護と同値であり、本リポジトリの admin merge（`gh pr merge --admin`）運用を温存する。required check 未達の PR は `mergeable`/`statusCheckRollup` 上でブロック状態として観測され（AC-3/AC-4 の検証はこれを見る）、admin bypass はそれとは別の明示的なマージ操作である。
- classic protection の PUT body は `required_status_checks`・`enforce_admins`・`required_pull_request_reviews`・`restrictions` の4フィールドを揃える必要がある（`restrictions: null` = 誰でもマージ可の意）。会話スレッド解決の強制（`main.json` の `required_review_thread_resolution`）を統合ブランチにも揃えたい場合は `required_conversation_resolution` の付与を実装時に検討する（AC-3 の必須要件ではないため任意）。

## 関連ADR

新規 ADR は作成しない。

判断根拠: ADR は「なぜその**アーキテクチャ上の**判断をしたか」を後から参照するための成果物である。本 Issue の中核判断（統合ブランチには採用案(b)の branch protection を用いる）は、正本アセット `main.json` を**一切変更しない**一過性・命令的な provisioning 操作であり、コード・スキーマ・配布物の構造を変えない。恒久的な抽象・契約の新設を伴わないため、ADR 化する durable な意思決定に当たらない。「正本 ruleset は安定・汎用な ref のみを対象とし、消費者一過性ブランチは正本外の手段で保護する」という原理は本 DESIGN.md 内に自己完結して記載しており（前節）、これで追跡可能性（I1）は満たされる。#178 でも同様に、変更が durable な architecture 決定に当たらない場合に ADR を新設しない判断を採っている。

```yaml
related_adrs: []
```

## 障害・ロールバック考慮

- 想定される失敗モードとロールバック:
  - **ruleset 適用で意図せず全 PR がブロックされる**: 適用直後、`self-enforce` に加え5コンテキストが required になるため、必要な Check Run を報告しない過去 PR がマージ不可になり得る。切り戻しは `gh api -X DELETE repos/techbeansjp-free/AGENTS.md/rulesets/<id>` で ruleset を削除すれば適用前状態（`[]`）へ戻る（`main.json` 自体は無変更なので配布物への影響なし）。
  - **統合ブランチ保護の切り戻し**: `gh api -X DELETE repos/.../branches/chore/162-agent-skill-chain-bootstrap/protection` で 404（未設定）状態へ戻せる。統合ブランチ削除時にも自然消滅する。
  - **使い捨て検証物の残存（AC-4/AC-6）**: 使い捨て PR・ブランチ・検証用 Issue・lease ref が残ると `main`・統合ブランチや WIP 枠を汚す。後始末を手順化する（PLAN.md の後始末タスクで close/delete/prune を必須化）。
  - **adapter 切替による回帰**: 万一テストが本体 config を参照して落ちる想定外があれば、config を `human` へ戻せば即時復旧する（1行の値変更のため可逆）。ただし B の根拠によりテストは tmp-repo 隔離のため無影響を見込む。
- 影響を受ける既存機能:
  - `main`・統合ブランチのマージ条件が厳格化する（required check 未達 PR がマージ不可になる）。これは本 Issue の目的そのものであり意図した変更。
  - 配布物（`main.json` 等の `.agent-skill-chain/templates/`）・CI workflow・ソースコードは**変更しない**（ライブ設定と config 1箇所の adapter 値のみ）。

## 制約・未決事項・対象外

- **共有インフラへの不可逆操作の扱い**: ruleset の本適用・統合ブランチ protection の本適用は本リポジトリの共有 GitHub 設定を変える不可逆・共有影響のある操作である。使い捨て検証（disposable な Issue/PR/ブランチ/ローカル lease）は自由に進めてよいが、本適用の直前ではユーザーへの確認を挟む（PLAN.md 注意事項に明記）。
- **対象外（SPEC.md スコープ外の再掲）**: `worker.adapter`/`review.adapter` を恒久既定値として `claude` に固定するかの意思決定、`main` の既存 `self-enforce` classic 保護の整理、`claude` CLI の恒久起動フラグ（`--permission-mode` 等）の確定、`human_required` 4異常経路すべての網羅的故障注入、過去 commit の遡及監査。
- **未決事項**: 統合ブランチ protection に会話スレッド解決強制（`required_conversation_resolution`）を含めるか（AC 必須ではなく実装時の任意判断）。C の検証を GitHub バックエンドで行うかローカルバックエンドで行うか（本設計はローカル使い捨てを推奨するが、実施バックエンドは検証者が最終決定してよい）。
