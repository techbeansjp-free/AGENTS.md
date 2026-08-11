<!--
このファイルはAGENTS.mdが定める4セグメント・4ゲートの規約に基づく雛形であり、Issue毎に複製して使う（セグメント: spec、成果物: SPEC.md、ゲート: spec-gate）。
-->

# SPEC: worker完了報告の照合がタイムスタンプ比較のみに依存し、target_shaが変化しない再試行で無関係な過去サイクルの報告を誤って完了根拠として採用しうる

- Issue: `ISSUE-661`
- 作成者: `spec_worker`
- 対象ブランチ: `bugfix/661-worker-completion-dispatch-token`

## 目的・背景

ISSUE-642（PR #655）・ISSUE-658（PR #659）で構築した `.agent-skill-chain/adapters/claude.sh`
の `_verify_worker_completion_report` は、segment worker（spec/design/implementation/
validation）の完了確認として、`report latest` が返す最新報告の `status`・`target_sha` が
現在HEADと一致し、かつ `created_at` がdispatch開始時刻（`DISPATCH_STARTED_AT`）以降である
こと（GitHub backendは秒精度丸めにより+999msの猶予付き）だけを根拠にしている。

この判定は、**target_shaが前回サイクルから変化していない状態でverifyが再実行される場合**
（例: 何らかの理由でblockedとなった後、新規commitが無いまま
`worker-launch-verify.sh` が再実行される、または同一HEADに対しdispatchが再試行される）に、
無関係な過去サイクルの `completed` 報告を「今回のもの」として誤って完了根拠に採用しうる。
タイムスタンプ比較（ISSUE-658の秒精度補正を含む）は「dispatch開始時刻より後に作成された
報告か」という確率的な手がかりに過ぎず、GitHub backendの秒精度の粗さ・複数の並行dispatch
サイクルの存在・target_sha自体が変化しないケースの組み合わせにより、報告が確実に今回の
dispatchサイクルに由来することの証明にはならない。AGENTS.md 不変条件I8（完了を騙るケース
を安全側で判定する）の趣旨に照らすと、この確率的な判定への依存は本質的なギャップである。

本Issueは、dispatchサイクルごとに一意な識別子をworkerの完了報告へ機械的に含めさせ、完了
判定がこの識別子の完全一致を必須条件とすることで、「この報告は確実に今回のdispatchサイクル
に由来する」ことを確率的推測ではなく機械的に証明できるようにすることを目的とする。

## 要求 → 要件 → 受入条件

### 要求

進行役（`worker-launch-verify.sh` 等の完了確認処理）は、segment workerの完了報告が今回の
dispatchサイクルに由来することを、確率的なタイムスタンプ比較のみに頼らず機械的に証明できる
根拠に基づいて判定しなければならない。target_shaが前回サイクルから変化していない状態で
完了確認が再実行された場合でも、無関係な過去サイクルの報告を今回サイクルの完了根拠として
誤って採用してはならない。

### 要件

- dispatchの各起動サイクルは、他のいかなる過去・並行のdispatchサイクルとも一致しない一意な
  識別子（以下、dispatchトークン）を持つ。
- workerへ配達されるcontractは、完了報告時にこのdispatchトークンを報告へ含めるべきことを
  明示する指示を含む。この指示は、既存の完了報告手順（`report-status.sh <issue_id> <role>
  <segment> completed <push済みHEAD>` の実行指示、ISSUE-642・ADR-0060で確立済み）への上乗せ
  として働き、既存指示を置き換えない。
- workerの完了報告データ構造は、このdispatchトークンを保持できる。
- 完了判定（`_verify_worker_completion_report` に相当する処理）は、報告に含まれるdispatch
  トークンが今回のdispatchサイクルのトークンと完全一致することを、completed判定の必須条件
  とする。トークンが欠落している報告・今回のトークンと一致しない報告は、今回サイクルの
  完了根拠として採用しない。
- target_shaが前回サイクルから変化していない状態（同一HEADへの再dispatch、blocked後の
  再実行等）でも、dispatchトークンが不一致であれば過去サイクルの `completed` 報告を今回の
  完了根拠として採用しない。
- dispatchトークン照合の導入は、既存のcompletion条件（commit + push済み、spec_workerの
  Draft PR作成済み等、`config/roles.yaml` の `role_contracts.*.completion` が定める既存
  項目）を変更・弱化しない。既存条件への追加としてのみ働く。
- ローカルバックエンド（1 segment 1 file構造）に対しても、GitHub backendと矛盾しない単一の
  照合契約が成立する。
- dispatchトークンの値・報告への含め方（`report-status.sh` への追加引数か、contract記述への
  埋め込みか）、既存のタイムスタンプ比較（ISSUE-658）を廃止するか併用するかの判断、
  `worker-report.schema.yaml` へのフィールド追加を伴う場合の `schema_version` 更新要否は、
  本SPECの必須要件を満たす具体的な実現方式としてDESIGN.mdで確定する。

### 受入条件（Acceptance Criteria）

#### AC-1: dispatchサイクルごとに一意なdispatchトークンが発行される

- Given: `_dispatch_via_agent_tool`（またはheadless起動経路の同等の初期化処理）が新しい
  dispatchサイクルを開始する。
- When: 発行されたdispatchトークンを、同一Issue・同一segmentに対する別のdispatchサイクル
  （過去または並行して実行中のもの）で発行されたdispatchトークンと比較する。
- Then: 両者は一致しない。
- 検証方法見込み: `automated`

#### AC-2: 発行されたdispatchトークンがworkerへ配達されるcontractへ機械的に含まれる

- Given: dispatchサイクルが開始され、workerへ配達されるcontractが組み立てられる。
- When: 組み立てられたcontract本文（またはdispatchプロンプト）を検査する。
- Then: 完了報告時に今回のdispatchトークンを報告へ含めるべきことを明示する指示が、具体的な
  トークン値入りで含まれている。既存の完了報告手順の指示（`report-status.sh ...` の実行
  指示）は維持されたままである。
- 検証方法見込み: `automated`

#### AC-3: workerの完了報告にdispatchトークンを含められる

- Given: workerが契約の指示に従い、成果物のcommit・push後に完了報告を投稿する。
- When: 投稿された完了報告を、進行役側の完了確認処理（`report latest` に相当する取得処理）
  から読み出す。
- Then: worker投稿時に指定したdispatchトークンの値を、欠落・改変なく読み出せる。
- 検証方法見込み: `automated`

#### AC-4: dispatchトークンが完全一致する報告のみが完了根拠として採用される

- Given: workerが配達されたcontractの指示どおりにdispatchトークンを含む完了報告を投稿し、
  報告の `status`・`target_sha`・`created_at` は既存の完了判定条件（AC-3・ISSUE-642・
  ISSUE-658）を満たしている。
- When: 完了確認処理が、今回のdispatchサイクルのdispatchトークンと報告に含まれるdispatch
  トークンを照合する。
- Then: 両者が完全一致する場合に限り、当該報告は今回サイクルの完了根拠として採用され、
  completedと判定される。
- 検証方法見込み: `automated`

#### AC-5: target_shaが変化しない再試行で過去サイクルの報告を完了根拠として誤採用しない

- Given: 同一Issue・同一role・同一segmentについて、前回サイクルで投稿された `completed`
  報告（前回サイクルのdispatchトークンを含む）が存在し、target_shaが前回サイクルの
  push済みHEADから変化していない状態で新しいdispatchサイクルが開始され、workerがまだ新しい
  完了報告を投稿していない。
- When: 新しいdispatchサイクルの完了確認処理を実行する。
- Then: 前回サイクルの報告に含まれるdispatchトークンが新しいdispatchサイクルのトークンと
  一致しないため、当該報告は今回サイクルの完了根拠として採用されず、blocked判定となる。
  target_shaが前回サイクルと同一であること、またはタイムスタンプ比較のみでは、completed
  判定を成立させない。
- 検証方法見込み: `automated`

#### AC-6: dispatchトークンが欠落・不正な報告はblockedとして安全側に扱われる

- Given: workerの完了報告にdispatchトークンが含まれていない、または今回のdispatchサイクルの
  トークンと一致しない値が含まれている。
- When: 完了確認処理を実行する。
- Then: completedとは判定されずblockedとなり、`blocked_reason` は今回サイクルの報告として
  確認できなかった旨を示す。
- 検証方法見込み: `automated`

#### AC-7: 既存のcompletion条件が変更・弱化されない

- Given: 本Issueの修正が適用された状態。
- When: 各roleの既存completion条件（commit + push済み、spec_workerのDraft PR作成済み等、
  `config/roles.yaml` の `role_contracts.*.completion` が定める既存項目）を確認する。
- Then: これらの既存条件はいずれも変更・削除されておらず、dispatchトークン照合は既存条件
  への追加としてのみ働く。
- 検証方法見込み: `manual`

#### AC-8: ローカルバックエンドでも矛盾なく整合する

- Given: coordination backendがローカルモード（1 segment 1 file構造の報告）である。
- When: 本Issueで導入するdispatchトークン照合契約を、ローカルバックエンドのreport取得・
  完了判定処理へ適用する。
- Then: ローカルバックエンド固有の報告構造（同一segmentに対する過去サイクルの報告が同一
  ファイルへ上書きされ残存しない特性）を踏まえても、GitHubモードと矛盾しない単一の照合契約
  として成立し、誤って過去サイクルの報告を完了根拠として採用する余地がない。
- 検証方法見込み: `manual`

## スコープ外

- dispatchトークンの具体的な値の生成方法・報告への具体的な受け渡し経路（`report-status.sh`
  への追加引数か、contractの完了報告手順ブロックへの埋め込みか等）の確定。DESIGN.mdで確定
  する。
- 既存のタイムスタンプ比較（ISSUE-658の `created_at`・`DISPATCH_STARTED_AT` 比較）を廃止
  するか、dispatchトークン照合と併用するかの判断。本SPECはdispatchトークンの完全一致を
  completed判定の必須条件とすることのみを要求し、タイムスタンプ比較の存廃はDESIGN.mdで
  確定する。
- `worker-report.schema.yaml` へのフィールド追加を伴う場合の具体的なスキーマ変更内容・
  `schema_version` 更新要否・consumer projectの既存報告データとの後方互換の具体的な移行
  手順の確定。
- 新規ADR（ADR-0060のフォローアップ節が予告する、識別子ベース比較への切替えを記録する
  ADR）の起票・内容確定。design segmentの責務とする。
- headless subprocess方式・Agent tool dispatch方式以外の新規dispatch経路の追加。
- `worker-launch-verify.sh` によるcompletion確認以外の文脈での `report-status.sh` 呼び出し
  契機（例: 進行役自身がworkerを務める場合の運用手順）の変更。
- dispatchトークンの暗号論的な強度（衝突耐性・予測困難性の数学的保証）の規定。本SPECが
  要求するのは「過去・並行の他サイクルと一致しない一意性」のみであり、暗号学的乱数生成
  方式の選定はDESIGN.mdの実現方式に委ねる。
