<!--
このファイルはAGENTS.mdが定める4セグメント・4ゲートの規約に基づく雛形であり、Issue毎に複製して使う（セグメント: spec、成果物: SPEC.md、ゲート: spec-gate）。
-->

# SPEC: launch_worker/worker-launch-verify の完了確認が、ワーカーに配達されない report status 投稿を前提としており、実運用で10/10のfalse-positive blockedを生む

- Issue: `ISSUE-642`
- 作成者: `spec_worker`
- 対象ブランチ: `bugfix/642-worker-completion-report-contract-gap`

## 目的・背景

GitHubモード＋Agent tool dispatch運用において、`.agent-skill-chain/scripts/worker-launch-verify.sh`
（および `.agent-skill-chain/adapters/claude.sh` の `launch_worker` 末尾の同型チェック）は、
segment worker（spec/design/implementation/validation）の完了確認として「workerが
`report-status.sh <issue_id> <role> <segment> completed <push済みHEAD>` を投稿済みであること」
を要求する。

しかし、workerへ実際に配達される契約（`segment start` の出力＝`config/roles.yaml` の
`role_contracts.<role>` のYAMLダンプ、および Agent tool dispatch経路で追加提示される
dispatchプロンプト）には、この報告手順を実行すべきという指示が一切含まれていない。
4ロール共通の `role_contracts.*.completion` はいずれも「commit + push済み」（spec_workerの
みDraft PR作成済みを追加）で終わり、`report-status.sh` / `report status` への言及が無い。
Agent tool dispatchのdispatchプロンプトも「作業完了後の最終応答は完了状態・target_sha・
簡潔な1文要約のみに限定」とテキスト応答での報告のみを指示し、`report-status.sh` の実行には
一切言及しない。

この結果、指示に従って忠実に作業したworkerほど報告を行わずに終了し、`worker-launch-verify.sh`
は必然的に「report不在」（対象segmentの初回起動時）または「前サイクルの古いcompleted report」
（2回目以降の起動時、報告target_shaが常に前サイクルの値、現在HEADが直後に確定する新サイクルの
値と一致する）を観測してblocked判定を返す。由来Issue（techbeansjp/chintainet-wp-theme #55）
での実測では10/10がblockedとなり、いずれも直後に人間エスカレーション経由の事後補填で
矛盾なくcompletedが確定していた。判定ロジック自体は入力に対して正しく動作しており、誤って
いるのは「報告が行われる」という前提である。

本Issueは、workerへ配達される契約に完了報告手順を確実に含め、正しく報告されたcompletion
が`worker-launch-verify.sh`によって正しくcompletedと判定されるようにするとともに、報告が
本当に行われなかった場合の`blocked_reason`が前サイクルの報告との取り違えによる誤解を招く
表現にならないようにすることを目的とする。

## 要求 → 要件 → 受入条件

### 要求

進行役は、segment workerが契約に従って正常に作業を完了した場合、`worker-launch-verify.sh`
による完了確認が誤ってblockedと判定されることなく、確実にcompletedとして通過しなければ
ならない。また、workerが実際に報告を行わなかった場合には、その事実を前サイクルの報告との
取り違えなく正確に示すblocked判定を得られなければならない。

### 要件

- `segment start` が生成するcontract（`role_contracts.<role>` に基づく出力）は、対象role
  （spec_worker/design_worker/implementation_worker/validation_worker）によらず、segment
  完了時に `report-status.sh <issue_id> <role> <segment> completed <push済みHEAD>`
  （またはそれに相当するreport status投稿）を実行すべきことを明示する指示を含む。
- Agent tool dispatch経路（`_dispatch_via_agent_tool` が組み立てるdispatchプロンプト）にも、
  同旨の完了報告指示を明記する。既存の「最終応答は完了状態・target_sha・簡潔な1文要約のみに
  限定する」という指示（role_contract本文の生成コンテキスト非流入を担保する制約）とは矛盾
  しない形で両立させる。
- 完了報告手順の追加は、各roleの既存completion条件（commit + push済み、spec_workerの
  Draft PR作成済み等）を変更・弱化しない。既存条件への追加としてのみ働く。
- `worker-launch-verify.sh` の完了確認は、dispatch開始より前に作成された既存のcompleted
  reportを、新しいdispatchの完了根拠として採用しない。dispatch以降に作成された報告が
  存在しない場合は、「workerがreportを投稿していない（契約不履行の可能性）」ことを一意に
  示すblocked判定を返す。
- blocked判定時のメッセージは、報告済みSHAと現在HEADの不一致を報告するかのような、報告
  主体・報告サイクルの取り違えを誘発する表現を含まない。

### 受入条件（Acceptance Criteria）

#### AC-1: 全4ロール共通のcontractに完了報告手順が含まれる

- Given: `segment start` が spec_worker・design_worker・implementation_worker・
  validation_worker のいずれかのroleに対してcontractを生成する。
- When: 生成されたcontract本文（`role_contracts.<role>` に基づく出力）を検査する。
- Then: 4ロール全てで共通して、対象segment完了時に `report-status.sh <issue_id> <role>
  <segment> completed <push済みHEAD>`（またはそれに相当するreport status投稿）を実行する
  ことを明示する指示が含まれている。
- 検証方法見込み: `automated`

#### AC-2: Agent tool dispatchのdispatchプロンプトにも完了報告指示が明記される

- Given: `worker.agent_tool_dispatch.enabled` が有効な状態で `_dispatch_via_agent_tool`
  がdispatchプロンプト（Agent tool呼び出しの `prompt` 引数相当）を組み立てる。
- When: 生成されたdispatchプロンプトを検査する。
- Then: dispatchプロンプトに、成果物のcommit・push後にreport status投稿を実行してから
  最終応答するよう明示する指示が含まれる。既存の「最終応答は完了状態・target_sha・簡潔な
  1文要約のみに限定する」という指示は維持されたままである。
- 検証方法見込み: `automated`

#### AC-3: 契約に従い報告したworkerの完了がcompletedと正しく判定される

- Given: workerが配達されたcontractの指示に従いsegmentの成果物をcommit・pushし、続けて
  `report-status.sh <issue_id> <role> <segment> completed <push済みHEAD>` を実行してから
  終了した。
- When: `.agent-skill-chain/scripts/worker-launch-verify.sh <issue_id> <dispatch_temp_dir>`
  を実行する。
- Then: 完了確認がcompletedと判定されblockedにならず、writer leaseが解放される。
- 検証方法見込み: `automated`

#### AC-4: 前サイクルの古い報告を新サイクルの完了根拠として採用しない

- Given: 同一issue・同一role・同一segmentについて、前回サイクルのcompleted報告が既に存在
  する状態で新しいdispatchが開始され、workerがまだ新しい報告を投稿していない。
- When: dispatch開始後・workerの新しい報告投稿前の時点で `worker-launch-verify.sh` を
  実行する。
- Then: 完了確認は前回サイクルの報告を新しいdispatchの完了根拠として採用せず、blocked判定
  を返す。
- 検証方法見込み: `automated`

#### AC-5: blocked_reasonが報告不履行を正確に示し取り違えを誘発しない

- Given: AC-4と同じ状況（dispatch開始以降に作成された新しい報告が存在しない）。
- When: `worker-launch-verify.sh` がblocked判定を返す。
- Then: `blocked_reason` は「workerがreportを投稿していない（契約不履行の可能性）」ことを
  一意に示す文言であり、報告済みSHAと現在HEADの不一致（前サイクルの報告を新サイクルの
  ものと取り違えたかのような表現）を示す文言を含まない。
- 検証方法見込み: `manual`

#### AC-6: 既存のcompletion条件が変更・弱化されない

- Given: 本Issueの修正が適用された状態。
- When: 各roleの既存completion条件（commit + push済み、spec_workerのDraft PR作成済み等、
  `config/roles.yaml` の `role_contracts.*.completion` が定める既存項目）を確認する。
- Then: これらの既存条件はいずれも変更・削除されておらず、完了報告手順の指示は既存条件への
  追加としてのみ働く。
- 検証方法見込み: `manual`

## スコープ外

- `report-status.sh` 呼び出し失敗・不一致時の再読込（backoff付きリトライ）ロジックの追加。
  Issueで防御的・任意の対応として提案されているが、本Issueの必須スコープには含めない。
- consumer project側の `config/roles.yaml` を個別に手動編集して報告手順を追記する運用。
  契約への付加をどの生成箇所（`segment start` 出力組み立て・`_dispatch_via_agent_tool` 等）
  で機械的に実現するかの具体的な実現方式はDESIGN.mdで確定する。
- headless subprocess方式・Agent tool dispatch方式以外の新規dispatch経路の追加。
- `worker-launch-verify.sh` によるcompletion確認以外の文脈での `report-status.sh` 呼び出し
  契機（例: 進行役自身がworkerを務める場合の `templates/claude/skills/segment-work/SKILL.md`
  手順）の変更。
- `report-status.sh` / `worker-report.schema.yaml` が定める報告データ構造自体（スキーマ）の
  変更。
