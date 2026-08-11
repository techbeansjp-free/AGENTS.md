# ADR

```yaml
id: ADR-0061
status: proposed
title: worker完了報告の照合へdispatchサイクル固有トークンの完全一致判定を追加し、タイムスタンプ比較と併用する
tags: [worker-launch, worker-launch-verify, report-status, agent-tool-dispatch, worker-report-schema]
supersedes: []
superseded-by: null
deprecated-reason: null
```

## Context

ADR-0060（ISSUE-642・ISSUE-658）は、`.agent-skill-chain/adapters/claude.sh`の`_verify_worker_completion_report`が
segment worker（spec/design/implementation/validation）の完了確認として、`report latest`が返す最新報告の
`status`・`target_sha`が現在HEADと一致し、かつ`created_at`がdispatch開始時刻（`DISPATCH_STARTED_AT`）以降で
あること（GitHub backendの秒精度丸めに対する+999msの猶予付き）を根拠とする判定を確立した。

この判定は、target_shaが前回サイクルから変化していない状態（何らかの理由でblockedとなった後、新規commitが
無いまま`worker-launch-verify.sh`が再実行される、または同一HEADに対しdispatchが再試行される場合）に、
無関係な過去サイクルの`completed`報告を「今回のもの」として誤って完了根拠に採用しうる。タイムスタンプ比較
（ADR-0060の秒精度補正を含む）は「dispatch開始時刻より後に作成された報告か」という確率的な手がかりに過ぎず、
GitHub backendの秒精度の粗さ・複数の並行dispatchサイクルの存在・target_sha自体が変化しないケースの組み合わせ
により、報告が確実に今回のdispatchサイクルに由来することの証明にはならない。AGENTS.md不変条件I8（完了を騙る
ケースを安全側で判定する）の趣旨に照らすと、この確率的な判定への依存は本質的なギャップである（ISSUE-661）。

ADR-0060のConsequencesは、この識別子ベース比較への切替えを「検討したが却下した選択肢4-(b)」として記録し、
「将来必要になった場合は新規ADRを作成し関係をsupersedes/superseded-byで記録する」ことを予告していた。本ADRは
その予告された新規ADRであり、ADR-0060全体の決定（contractへの完了報告手順の機械的付加、鮮度判定の存在自体）
を置き換えるものではなく、その一部（識別子ベース比較の不在）を補うため`supersedes`は空とする。

### 検討した選択肢

1. **タイムスタンプ比較を識別子ベース比較で完全に置き換える。**
   実装は単純になるが、ADR-0060 決定4-(c)が確立した診断メッセージの分離（「報告が1件も無い/dispatch開始前
   のみ」と「報告はあるがstatus/target_sha不一致」を区別する既存の2種の`blocked_reason`）を失う。トークン
   不一致だけでは「そもそも報告が無い」のか「別サイクルの報告がある」のかを区別する追加情報（`created_at`）
   が失われ、人間エスカレーション時の診断可読性が落ちる。
2. **識別子ベース比較のみを新設し、既存のタイムスタンプ比較を撤去せず両方を必須条件として併用する（採用）。**
   トークン完全一致は「今回のdispatchサイクルに由来する」ことを機械的に証明する十分条件であり、タイムスタンプ
   比較が持っていた「そもそも報告が無い／dispatch開始前の報告しかない」という診断分岐はそのまま活用できる。
   判定コストは既存判定に1回の文字列比較を追加するだけで無視できる。SPEC.mdの要件「既存のcompletion条件を
   変更・弱化しない」（AC-7）とも整合する。
3. **`worker-report.schema.yaml`の`schema_version`をv2へ引き上げ、`dispatch_token`を必須フィールドとする。**
   スキーマ上必須にすると、`dispatch_token`を渡さない既存呼び出し・過去の報告データ・`dispatch_token`未対応の
   consumer projectのカスタムワーカーが報告そのものに失敗し、AC-7（既存条件の非弱化）に反する。トークン一致
   要求は完了判定ロジック（アプリケーション層）側の必須条件とし、スキーマ層では任意プロパティに留める（採用）。
4. **トークンをworkerが自律生成する（例: worker自身がUUIDを発番）。**
   進行役側が期待値を知り得ない自己申告値になり、「report未報告」と「別workerが別の値を騙って報告」を機械的
   に区別できず、I8が求める安全側判定を満たさない。トークンは必ず起動側（`claude.sh`）が発行し、workerは
   受け取った値をそのまま返すだけの役割に限定する。

## Decision

1. **トークンはdispatchサイクルの起動側（`.agent-skill-chain/adapters/claude.sh`）が生成する。** Agent tool
   dispatch経路（`_dispatch_via_agent_tool`）は既存の`dispatch_temp_dir="$(mktemp -d
   .../agent-skill-chain-worker-dispatch.XXXXXX)"`が生成する一意なディレクトリ名の`basename`をそのまま
   dispatchトークンとして再利用する。headless起動経路（`launch_worker`）は同じ命名規則の`mktemp -u`（ディレ
   クトリを作らずファイル名のみ生成）で同形式のトークンを生成する。いずれも新規の乱数生成コードを追加せず、
   既存のOSレベルの`mktemp`一意性保証にそのまま乗る。暗号論的な強度（衝突耐性・予測困難性の数学的保証）は
   要求しない（SPEC.mdスコープ外）。
2. **トークンはworkerへ配達される実際の指示文字列（Agent tool dispatchの`prompt:`行、headlessの
   `prompt_file`内容）へ具体的な値入りで追記する。** `config/roles.yaml`の`role_contracts.*.completion`・
   `src/commands/segment.ts`の`buildCompletionReportBlock`が生成する既存の`report-status.sh`指示文言は変更
   しない。トークン埋め込みは独立した追記文として置き、既存指示への上乗せとしてのみ働く。
3. **`report status`/`report latest` CLIは`dispatch_token`を末尾への追加専用の任意項目として扱う。**
   `report status`は8番目の任意位置引数として`dispatch_token`を受理し、`worker-report.schema.yaml`へ追加した
   任意プロパティ（`required`に含めない）へ設定する。`schema_version`は`agent-skill-chain/worker-report/v1`
   のまま変更しない（既存必須フィールド・既存プロパティの意味を変えない後方互換な追加のため）。`report
   latest`は既存の`status=`/`target_sha=`/`created_at=`出力に`dispatch_token=<値または空文字>`を追加行として
   出力する。
4. **`_verify_worker_completion_report`は、既存の未報告判定・鮮度判定・status/target_sha判定に続く第4の判定
   として、`report latest`が返すトークンと今回サイクルの期待トークンとの完全一致を追加する。** 不一致・
   期待値欠落はいずれも安全側でblockedとし、既存3分岐と独立した専用の`blocked_reason`文言（過去サイクルの
   報告の可能性を示す文言）を返す。両dispatch経路の呼び出し側（`launch_worker`のインライン呼び出し、
   `worker-launch-verify.sh`）は、それぞれが保持する期待トークン（生成した変数、または`contract.sha256`の
   `DISPATCH_TOKEN`）をこの判定へ渡す。
5. **既存のタイムスタンプ比較（ADR-0060）は撤去せず併用する。** トークン完全一致とタイムスタンプ鮮度判定は
   いずれもcompleted判定の必須条件として独立に働き、どちらか一方が満たされないだけでblockedとなる。

## Consequences

- 利点: target_shaが変化しない再試行（blocked後の再実行、同一HEADへの再dispatch）で無関係な過去サイクルの
  `completed`報告を完了根拠として誤採用するケースが、確率的なタイムスタンプ推測ではなく機械的なトークン完全
  一致によって排除される。既存のcompletion条件・診断メッセージの分離は維持されるため、回帰リスクを最小化
  できる。スキーマを後方互換に保つことで、`dispatch_token`未対応のconsumer project・過去の報告データが
  引き続き有効なまま残る。
- 欠点: `report latest`の出力形式が1行増える（ADR-0060で確立済みの増分パターンを踏襲するため影響は限定的）。
  `contract.sha256`監査ファイルに新しいキー（`DISPATCH_TOKEN`）が増え、これを欠いた古い形式のdispatch一時
  ディレクトリが万一残存していた場合は、`DISPATCH_STARTED_AT`欠落時と同様に監査証跡欠落としてblocked扱いに
  なる（安全側の挙動として意図的）。headless起動経路は`dispatch_temp_dir`のような永続的な監査ディレクトリを
  持たないため、トークンの生成・使用が単一の関数呼び出し内のローカル変数に閉じており、Agent tool dispatch
  経路ほどの外部監査可能性を持たない（ただし headless 経路自体が非同期の再実行を許さない単一同期呼び出しで
  あるため、AC-5が想定する「再実行による過去サイクル誤採用」のリスクは元々Agent tool dispatch経路より低い）。
- フォローアップ: `.agent-skill-chain/standards/AGENT_TOOL_DISPATCH.md`は、本ADRの決定内容に合わせて
  `DISPATCH_TOKEN`と新しいblocked条件の説明を追記する（文書の現状追従であり、新たな決定ではないため
  本ADRの対象外の作業として実装セグメントで行う）。
