# SPEC: コア監査のモデル選択を Sol xhigh 必須へ更新する

- Issue: `ISSUE-271`
- 作成者: `core-model-policy-worker`
- 対象ブランチ: `process/271-core-audit-model-selection`

## 目的・背景

agent-skill-chain 自身のコア規約・状態遷移・ゲート・Coordination Backend・配布ルールを変更または監査する作業は、誤りが全 consumer project へ波及する。一方、現行の登録済み project policy は strict review の人数と独立性だけを定め、使用モデルと reasoning 強度を強制しない。Codex adapter の reviewer 既定値も要求水準未満であり、未登録の旧メモは規範にならない。

本変更は、対象作業を機械的に分類し、独立レビューにベンダー中立な最上位能力を要求する。Codex ではその実装値を `gpt-5.6-sol` と `xhigh` に固定する。Claude Code では実在しないモデル名を推測せず、実行環境が申告・検証した同等級モデルと最大利用可能 reasoning のみを許可する。要求能力を証明できない場合は暗黙に降格せず `human_required` で停止する。

GitHub モードの自己拡張コアレビューは、公式 `openai/codex-action@v1` が Codex CLI と Responses API proxy を準備する。利用者の継続操作は repository secret `OPENAI_API_KEY` の一度限りの登録だけとし、以後は PR push ごとに必要 reviewer 数を自動起動する。

## 対象・前提・用語

- 対象: 本リポジトリの GitHub/ローカル両 Coordination Backend で起動する独立 gate reviewer。
- コア変更: 登録済みモデル選択ポリシーが列挙するコア資産パターンに差分がある変更。
- コア監査: コア資産の妥当性調査を目的とし、実行入力で `core_audit` と明示された監査。
- 必要能力: `frontier_coding` と `maximum_reasoning` の組。ベンダー固有のモデル名とは分離する。
- 独立レビュー: 成果物を変更できない gate reviewer による conformance/falsification 判定。
- 通常作業: コア変更でもコア監査でもない作業。依頼者または実行環境の明示選択を尊重する。
- 公式根拠: OpenAI の現行 Codex manual と GPT-5.6 model guidance。外部参照はモデル指定の由来であり、本仕様の要求自体は本書に完結している。

## 入力・出力

- 入力: Issue ID、gate ID、review profile、target SHA、変更ファイル、監査区分、選択 adapter、adapter が使用するモデル・reasoning 設定、GitHub 自動レビュー用 credential。
- 出力: `core_review_required` の機械判定、adapter 別の検証済み起動設定、または `human_required` の gate 状態。
- 永続証跡: manifest 登録済みポリシー、変更コード・テスト、gate report、Check Run またはローカル review。

## 要求 → 要件 → 受入条件

### 要求

コア監査とコア規約変更の独立レビューには Sol xhigh 相当の能力を必須化し、利用不能・検証不能時は安全側に停止する。通常作業の明示的なモデル選択は維持し、旧モデル選定メモとの矛盾を解消する。

### 要件

- manifest 登録済みの規範だけで、コア対象パターン、明示的な監査区分、ベンダー中立能力、adapter 別実装値、失敗時挙動を判断できる。
- コア変更は target SHA の差分から、コア監査は明示入力から判定し、いずれも strict review を要求する。
- GitHub モードの自己拡張コアレビューは Codex adapter と公式 Codex Action を選び、Strict の reviewer 2体を独立呼出しとして機械強制する。
- Codex adapter はコア独立レビューを `gpt-5.6-sol` / `xhigh` / read-only permission profile でのみ起動し、上書き値も一致を検証する。GitHub Action は OS 権限も `drop-sudo` で縮小する。
- Claude adapter は、環境が申告する実在モデル・reasoning 値に加えて `frontier_coding` / `maximum_reasoning` の能力証明を検証して起動する。固定の架空モデル名や Codex 固有値を Claude CLI へ流用しない。
- GitHub Codex 自動レビューの利用者設定は repository secret `OPENAI_API_KEY` だけとする。未設定、必須モデル・強度・能力証明・CLI・認証の利用不能または不一致は、gate を `human_required` とし非成功で停止する。
- 通常作業では既存 adapter 設定と依頼者・実行環境の明示的上書きを尊重する。
- 旧メモは manifest 登録済みの現行ポリシーへ更新し、設定・adapter・CI・テストを同じ変更で整合させる。

### 受入条件（Acceptance Criteria）

#### AC-1: 登録済み規範だけで対象と能力契約を判定できる

- Given: project policy manifest と登録済み文書だけを読む
- When: コア変更またはコア監査のモデル要件を判断する
- Then: 対象パターン、監査区分、`frontier_coding` / `maximum_reasoning`、adapter 別実装値、利用不能時の `human_required` が一意に決まる
- 検証方法見込み: `automated`

#### AC-2: コア対象を機械分類して strict review を要求する

- Given: target SHA にコア資産の変更がある、または監査区分が `core_audit` と明示されている
- When: reviewer context と launcher が入力を解決する
- Then: `core_review_required=true` となり、standard 指定を含め strict profile 以外では起動せず `human_required` になり、strict では独立 reviewer 2体の verdict が揃うまで承認しない
- 検証方法見込み: `automated`

#### AC-3: Codex は Sol xhigh を厳密に使用する

- Given: コア独立レビューを Codex adapter で起動する
- When: モデルと reasoning effort を解決・検証する
- Then: GitHub では公式 Codex Action が CLI を準備し、ローカルでは Codex adapter が CLI を解決し、いずれも `gpt-5.6-sol` と `xhigh` と read-only 権限を使う。GitHub Action は `:read-only` permission profile と `drop-sudo` を併用し、不一致・未対応・利用不能なら `human_required` になる
- 検証方法見込み: `automated`

#### AC-4: Claude は同等能力を証明しベンダー固有表現を混同しない

- Given: コア独立レビューを Claude adapter で起動する
- When: Claude Code 用のモデル、reasoning、能力証明を解決・検証する
- Then: 実行環境が明示した実在モデルと最大利用可能 reasoning、および `frontier_coding` / `maximum_reasoning` 証明が揃う場合のみ起動し、Codex のモデル名・設定キーを Claude CLI へ誤適用しない
- 検証方法見込み: `automated`

#### AC-5: 利用不能時は成功扱いせず人間判断へ止める

- Given: `OPENAI_API_KEY`、必須モデル、reasoning、能力証明、CLI、認証のいずれかが欠落・不一致である
- When: CI またはローカル launcher がコア独立レビューを試みる
- Then: gate report または Check Run が `human_required` / `action_required` となり、`success` や `neutral` では完了しない
- 検証方法見込み: `automated`

#### AC-6: 通常作業の明示モデル選択を維持する

- Given: コア対象に分類されない通常作業で、依頼者または実行環境がモデル・reasoning を明示する
- When: 選択 adapter が reviewer を起動する
- Then: コア向け固定値へ強制変更されず、既存の明示選択とフェイルセーフ挙動が維持される
- 検証方法見込み: `automated`

#### AC-7: 配布物と旧メモを含む全層が同期する

- Given: model policy、設定、adapter、CI テンプレート、展開済み workflow、テストが存在する
- When: template sync、schema、policy、adapter、回帰検査を実行する
- Then: 旧メモとの重複・矛盾がなく、manifest 登録済み規範と配布物が一致し、全検査が成功する
- 検証方法見込み: `automated`

## 制約・完了条件・検証方法

- 1 Issue = 1 branch = 1 worktree = 1 PR、writer lease、4 checkpoint、reviewer read-only を維持する。
- モデル選択は project policy が package/adapter 既定より優先するが、コア不変条件を上書きしない。
- モデル可用性を推測しない。adapter が実際に表現・検証できない能力は利用不能として扱う。
- GitHub Codex 自動レビューは OpenAI 公式 Action を使い、PR controlled input に write 権限や repository secret を直接渡さない。
- 設定値追加が必要な場合は、ハードコード不可理由、project 差、schema、既定、後方互換、ADR 要否を設計で確定する。
- 全 AC を自動テストへ対応させ、型検査、lint、単体・変更範囲の結合テスト、SAST、依存関係・secret scan、template sync を実行する。
- 全変更と `VALIDATION.md` を push し、Draft PR が `Closes #271` を保持すれば完了とする。

## 未決事項

- なし。Claude adapter の具体的モデル名は実行環境の検証済み宣言を入力とし、規範では捏造しない。

## スコープ外

- 通常作業の既定モデルを一律に Sol/xhigh へ変更すること。
- provider 間でモデル名や CLI オプションが同一であると仮定すること。
- モデル品質を名前だけで自動推定すること。
- API モデル移行、価格・context 制限、prompt 改変、consumer project 固有ポリシーの強制変更。
