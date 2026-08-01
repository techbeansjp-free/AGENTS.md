# SPEC: trusted gate recorderを専用GitHub App登録なしでもfailureにしない

- Issue: `ISSUE-331`
- 作成者: `spec_worker`
- 対象ブランチ: `bugfix/331-verify-publish-neutral-secrets`

## 目的・背景

`agent-skill-chain / trusted gate recorder` workflow（`.github/workflows/agent-skill-chain-trusted-gate.yml`、`repository_dispatch`イベントで起動され、main上でのみ実行される）の`record` jobは、ゲートレビュー証跡をdurableなGitHub Check Runとして記録するために、専用GitHub App（Checks write・Commit statuses write・Metadata read権限を持つ）の認証情報として`ASC_GATE_APP_ID`・`ASC_GATE_APP_PRIVATE_KEY`を要求する。これらが本環境に設定されていないため、「Prepare dedicated-App in-progress Check and envelope」ステップが「ASC_GATE_APP_IDが構成されていません」（または`ASC_GATE_APP_PRIVATE_KEY`が同様に未設定であることを示すエラー）を出して非0で終了し、job全体がfailure（赤）として終了する。この状態はPR #317実行分のワークフロー実行ログで実際に確認されている。

なお、本Issueの起票時点では、同じ根本原因クラスの問題として`.github/workflows/agent-skill-chain-gate.yml`の`verify-and-publish` job（spec/design/implementation/validationの4ゲートをmatrix実行し、既にローカルで投稿済みのPR review証跡を`gate verify-evidence`で検証し、`verify gate-report`でSPEC.md等成果物のdigest整合性を検証するjob）についても、`ANTHROPIC_API_KEY`・`CLAUDE_CODE_OAUTH_TOKEN`等のAIモデル呼び出し用secretsの未設定が原因でfailureになる、という前提が示されていた。しかし実際に`agent-skill-chain-gate.yml`の内容を確認した結果、このworkflowにはAIモデル呼び出し用のsecretsへの参照が一切存在しないことが判明した。`verify-and-publish` jobはAIモデルを直接呼び出さず、既に生成済みの証跡ファイル・PR review・成果物ファイルの整合性を検証するだけであり、AIモデル呼び出し用secretsを必要としない。過去に観測された`verify-and-publish`の失敗（例：「approved_artifacts のファイルが削除されています（digest不一致として扱います）: SPEC.md」というエラー）は、`target_sha`のGit object解決に関する実装上の不具合が原因であり、この不具合はISSUE-316として特定され、対応するプルリクエストによって既にmainへ修正済みである。したがって、AIモデル呼び出し用secretsの未設定を理由に`agent-skill-chain-gate.yml`側の挙動を変更する必要はなく、本SPECは`agent-skill-chain-trusted-gate.yml`の専用GitHub App認証情報未設定問題のみを対象とする。

専用App認証情報が未設定であることに起因するfailureと、記録処理を実際に実行した結果として検出された本当の問題（真正性検証の失敗等）によるfailureとが、現在のjob結果・Check Run結果からは区別できない。この区別不能性は、開発チームがCI結果を都度目視判断してadmin mergeする運用を常態化させ、本来検知すべき問題の見逃しにつながるリスクを持つ。

## 要求 → 要件 → 受入条件

### 要求

専用GitHub Appの認証情報（`ASC_GATE_APP_ID`・`ASC_GATE_APP_PRIVATE_KEY`）が本環境に用意されていないことに起因して`trusted gate recorder`の`record` jobがfailure（赤）で終了する状態を解消し、「記録処理を実行できる手段が用意されていない既知の状態」と「記録処理を実行した結果として検出された、見逃してはいけない失敗」とをCI結果・Check Run結果から機械的に区別できるようにする。あわせて、専用App認証情報が用意されている環境（または後述の代替信頼機構が正しく構成された環境）では、既存の記録動作を後退させない。

### 要件

- `record` jobは、専用App認証情報（`ASC_GATE_APP_ID`・`ASC_GATE_APP_PRIVATE_KEY`）が未設定であることを検出した場合、failureとして終了してはならない。終了状態の具体的な設計（skipped/neutralとして終了させるか、専用GitHub App要件自体を撤廃し認証情報の有無に依存しない代替の信頼機構に置き換えるか）は、両案を比較検討したうえで設計セグメントで確定する。
- いずれの設計を採る場合も、AGENTS.mdの不変条件I2が定める「Check Runの成功状態を専用App/Workflowに限定する」「同一GitHub Actions Appであることだけをsource trustの証明にしてはならない」という真正性保証の水準を後退させてはならない。専用App自体を撤廃する設計を採る場合は、それに代わる手段（例：signer-workflow・digest・certificateを検証するattestationに基づく、特定workflow identityへの限定）が同水準の保証を満たすことを示さなければならない。この保証水準を後退させずに設計できないと判明した場合、design segmentはAGENTS.md改定の要否を含めて人間判断（human_required）へ昇格しなければならない。
- 専用App認証情報が設定されている環境（または代替信頼機構が正しく構成された環境）では、Check作成・attestation生成・attestation検証・Check Runのfinalizeという既存の記録処理内容・合否判定を変更してはならない。
- `record` jobの終了状態がskipped/neutralまたはそれに類する状態に変わった場合、GitHub branch protection（ruleset）側でその状態が「未実行のまま実質的に合格扱い（false pass）」として扱われ、本来満たすべきでない記録がなされないままPRやゲートが先へ進んでしまう事態を招いてはならない。この意味論の技術的な確定は、GitHub Actionsの既知の挙動に依存するため、設計セグメントで検証・確定すべき前提条件として扱ってよい。

### 受入条件（Acceptance Criteria）

#### AC-1: 専用App認証情報未設定環境でrecord jobがfailureとして終了しない

- Given: 本リポジトリのGitHub Actions secrets/variablesに`ASC_GATE_APP_ID`または`ASC_GATE_APP_PRIVATE_KEY`のいずれかが設定されていない
- When: `repository_dispatch`イベントにより`agent-skill-chain / trusted gate recorder` workflowの`record` jobが起動される
- Then: 当該jobはfailure（赤）として終了しない。具体的な終了状態（skippedまたはneutralとして終了するか、専用App認証を前提としない代替の信頼機構によって記録処理自体が正常に完了するか）は設計セグメントで確定する内容に従う。
- 検証方法見込み: `automated`

#### AC-2: 専用App/Workflowによるsource trust保証水準が後退しない

- Given: 設計セグメントがAC-1の対応方針として「App未設定時のneutral/skip化」「専用App要件自体の撤廃と代替信頼機構への置換」のいずれを採用した場合でも
- When: ゲートの成功状態がrequired statusとしてCheck Runへ記録される
- Then: AGENTS.mdの不変条件I2が定める、専用App/Workflowに限定されたrequired statusの真正性保証（同一GitHub Actions Appであることだけをsource trustの証明にしない、という水準を含む）が、変更後も同水準以上で維持されていることを確認できる。この確認は設計セグメントの成果物（DESIGN.md/ADR）において明示的に記述される。維持できないと判明した場合は、AGENTS.md改定の要否を含め人間判断へ昇格する。
- 検証方法見込み: `manual`

#### AC-3: 専用App認証情報設定済み環境（または代替信頼機構構成済み環境）で既存動作が後退しない

- Given: `ASC_GATE_APP_ID`・`ASC_GATE_APP_PRIVATE_KEY`が設定されている、または設計セグメントで確定した代替の信頼機構が正しく構成されている
- When: `record` jobが起動される
- Then: 従来通り（あるいは採用された設計における正規の完了経路として）Check作成・attestation生成・attestation検証・Check Runのfinalizeが実行され、いずれかの検証に失敗した場合は従来通りfailureとして終了する。
- 検証方法見込み: `automated`

#### AC-4: 終了状態の変更がbranch protectionのrequired statusをすり抜けさせない

- Given: branch protection（ruleset）のrequired status checksに、`trusted gate recorder`が記録するCheck Run名、または`record` job自体のstatusが登録されている
- When: AC-1の変更により、専用App認証情報未設定環境で当該statusの終了状態が変化する
- Then: そのstatusがGitHub上で「必須チェック未実行（pending、後続のマージ・ゲート進行が止まる）」として扱われるか「合格相当（pass）」として扱われるかを、GitHub Actionsの既知の挙動に基づき設計セグメントで検証・明確化する。意図せず合格相当（false pass）として扱われ、記録されるべきCheck Runが記録されないままゲートが先へ進んでしまう場合は、それを防ぐための対応（required statusの再定義等、具体的な実現方法は設計セグメントで確定する）を設計セグメントの対応方針に含める。
- 検証方法見込み: `manual`

#### AC-5: 「実行して失敗」と「未実行」がCI結果から機械的に区別できる

- Given: `record` jobがAC-1の理由（専用App認証情報未設定、または代替信頼機構未構成）により記録処理を実行できていない状態にあり、それ以外に記録処理が検出した真正性検証の失敗等の問題が存在しない
- When: 人間またはエージェントが、そのjob・Check Runの結果を確認する
- Then: 各job・Check Runの結果（conclusion値）だけを見て、「専用App認証情報・代替信頼機構が未構成のため実行されなかった既知の状態」であるか「実行された上で検出された、見逃してはいけない失敗」であるかを、個々のログを開かずに判別できる。
- 検証方法見込み: `hybrid`

## スコープ外

- `.github/workflows/agent-skill-chain-gate.yml`の`verify-and-publish` jobの挙動変更。このjobはAIモデル呼び出し用secrets（`ANTHROPIC_API_KEY`・`CLAUDE_CODE_OAUTH_TOKEN`等）を参照しておらず、過去に観測された失敗はISSUE-316（`target_sha`のGit object解決に関する実装不具合）が原因であり、既にmainへ修正済みである。
- `.agent-skill-chain/scripts/gate-local-review.sh`によるローカルレビュー実行手順・運用プロセス自体の変更。
- 専用GitHub Appを実際に作成・登録し、`ASC_GATE_APP_ID`・`ASC_GATE_APP_PRIVATE_KEY`を本リポジトリのGitHub Actions secrets/variablesとして設定するprovisioning作業自体（本Issueはこれらが「無い」環境での終了状態、またはこれら自体を不要にする設計を扱う。実際にAppを登録して稼働させる運用は別Issueの対象たりうる）。
- AGENTS.mdの不変条件I2自体の文言改定。AC-2・AC-4で必要と判明した場合の改定要否判断は、設計セグメントが人間判断へ昇格する形で扱い、本SPECの範囲では改定内容を確定しない。
- `agent-skill-chain / ci` workflowの`verify` job、`detect-segments` job、`CodeRabbit`連携、`reconcile`・`risk-ratchet`・`self-test`の各workflowの挙動変更。
- `DESIGN.md`・`PLAN.md`・ADRの作成（設計セグメントの責務）。
- AC-1・AC-2で言及した「App未設定時のneutral/skip化」と「専用App要件の撤廃」のいずれを採用するかの決定、および採用された設計の具体的な実現方法の確定（設計セグメントで確定する前提条件として、本SPECは要求と満たすべき保証水準のみを記載する）。
