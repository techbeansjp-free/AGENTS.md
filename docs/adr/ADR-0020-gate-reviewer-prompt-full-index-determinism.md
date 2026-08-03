# ADR

```yaml
id: ADR-0020
status: proposed
title: gate reviewer-prompt の差分index行をclone非依存の決定的表現にするため--full-indexを採用する
tags: [gate, reproducibility, review-evidence]
supersedes: []
superseded-by: null
deprecated-reason: null
```

## Context

`gate reviewer-prompt`（`buildReviewerPrompt()`、`src/commands/gate.ts`）が組み立てるレビュア判定プロンプトには、判定対象成果物の`git diff --no-ext-diff --no-color <base>...<target>`出力が「判定対象の差分」セクションとしてそのまま埋め込まれる。この出力の`index <abbrev-old>..<abbrev-new>`行が使う省略hashの桁数は、実行時にgitが採用する`core.abbrev`（既定`auto`）に依存し、その値はリポジトリが保持する総オブジェクト数によって変動する。

この結果、同一の`(issue_number, gate_id, target_sha, base_sha)`を与えて`gate reviewer-prompt`を実行しても、実行するclone（新規clone・履歴を蓄積した使い回しclone・CIのcheckout・進行役のローカルclone等）が保持する総オブジェクト数が異なれば、プロンプト本文のbyte列が変わり、`evidencePromptDigest()`が算出する`prompt_digest`も変わる。`gate verify-evidence`は`expectedPromptDigest`を検証実行時のcloneで独自に再計算し記録済みの`prompt_digest`と比較するため、生成clone・検証clone間で総オブジェクト数が完全一致しない限りこの比較は成立し得ず、strict profile（2レビュア）を要求する全Issueのspec/design/implementation/validation各ゲートで、review evidence投稿後の検証が非決定的に失敗し得る（実測: Issue #351／PR #357のspec-gate strictレビューで3clone・3種類の異なるdigestを観測）。

対策候補として次の2案を検討した。

- (a) `git diff`呼び出しに`--full-index`を追加し、index行を常にリポジトリのハッシュアルゴリズムに応じた完全長（SHA-1なら40桁）で出力させる。
- (b) `--abbrev=<固定N>`のように固定桁数を明示指定する。

(b)は、指定した固定桁数`N`でもcloneの総オブジェクト数次第では一意性確保のためgitがさらに桁数を伸長し得る（`--abbrev`の「最低保証桁数」という意味論上、`N`は下限に過ぎず上限にはならない）ため、根本解決にならない。

また、Issue #369のspec-gate strictレビューにおいて、AC-2が要求する「意図的に大量のオブジェクトを追加投入して省略hashの一意性伸長が実際に発生する状態を再現したclone」について、必要オブジェクト数・生成方法が未指定であり、実際に`core.abbrev=auto`の自動伸長を自然発生させるテストfixtureの構築コストが高い可能性がある旨の非blocking指摘（`ac2-test-fixture-feasibility`）を受けた。

## Decision

`buildReviewerPrompt()`内の判定対象差分を生成する`git diff`呼び出しに`--full-index`を追加し、index行のhash桁数をcore.abbrevの値に一切依存しない完全長へ固定する（案(a)を採用）。

回帰テストにおけるAC-2の検証は、`core.abbrev`を明示的に異なる値（例: `7`・`12`・未設定＝auto）に設定した複数clone環境を用意し、`buildReviewerPrompt()`の出力が全clone間で完全一致することを確認する方式で構築する。総オブジェクト数の差は`core.abbrev=auto`時の自動伸長を左右する一因に過ぎず、根本原因は「実行時に有効となるabbrev桁数がclone毎のローカルなgit状態に依存する」ことそのものであるため、`core.abbrev`の明示設定はこの根本メカニズムを決定的かつCI実行時間内に代理検証する手段として妥当である。これに加え、可能な範囲で総オブジェクト数を実際に大きく変えたclone（新規clone vs 追加blob投入clone）でも出力一致を補助的に検証する。

## Consequences

- 利点: `prompt_digest`の決定性が回復し、review evidenceを生成したcloneと検証するcloneが異なっても`gate verify-evidence`が成功するようになる。将来のgit実装変更（`core.abbrev=auto`の既定ロジック変更等）の影響を受けない。
- 欠点・フォローアップ: 本fixのマージ前に生成・記録された既存のreview evidence（例: Issue #351／PR #357の既失敗ラウンド）は、fix適用後にプロンプトのバイト列が変わるため`prompt_digest`が再一致することはなく、当該Issueは`gate reviewer-prompt`の再実行・レビュア再判定・`gate submit-evidence`の再提出が別途必要になる（Issue #369のSPEC.mdスコープ外節が明示するとおり本Issueの対応範囲には含めない、運用上の申し送り事項）。
- テストで`core.abbrev`の明示設定を一意性伸長の代理指標として用いる判断は、実オブジェクト数由来の自然発生ケースを完全に再現するものではない。将来的に、実運用規模に近い総オブジェクト数から自然に`core.abbrev=auto`の伸長が発生するケースを追加検証する余地を残す。

---

## accepted 後の不変項目・可変項目

| 区分 | 項目 |
|---|---|
| 不変（accepted 後は変更不可） | `id`、Context、Decision、Consequences、`supersedes` |
| 可変（ライフサイクル遷移に伴い更新可） | `status`、`superseded-by`、`deprecated-reason`、`tags` |

本文（Context / Decision / Consequences）の変更が必要になった場合は、新しい ADR を作成し `supersedes` / `superseded-by` で旧 ADR との関係を記録する。既存 ADR の本文を書き換えてはならない。

## ライフサイクル

```text
DESIGNワーカー   → ADR を proposed で作成
設計レビュア     → ADR 本文をレビュー（read-only）→ content digest を承認
進行役           → adr-finalize.sh を起動
ADR finalization → writer lease を取得 → status を accepted へ更新
ワーカー           → commit・push → content digest を再検査
```

- `proposed → accepted`: 設計ゲート承認時に遷移する。設計レビュアは ADR 本文をレビューし content digest を承認するのみ（read-only、直接 status を書き換えない）。進行役が `.agent-skill-chain/scripts/adr-finalize.sh` を起動し、専任の ADR finalization ワーカーが writer lease を取得したうえで `status` のみを `accepted` に更新して commit・push する（`.agent-skill-chain/config/roles.yaml` の `adr_finalization_worker`、`scope: adr_status_only`）。finalization ワーカーは書込み前に content digest を再検査する。
- `accepted → superseded`: 新しい ADR を含む同一 PR 内で、新 ADR の作者（ワーカー）が旧 ADR の `status` / `superseded-by` を同一 PR で更新する。`supersedes` ⇔ `superseded-by` の対称性・参照先の実在が機械検査される。
- `accepted → deprecated`: 前提が消滅し後継が無い場合に遷移する。`deprecated-reason` に1行の理由を記録する（存在検査あり）。

## related_adrs 参照ルール

他 Issue の `DESIGN.md` から本 ADR を参照する場合は `related_adrs:` フィールド（構造化リスト）を用いる。stale 参照検査（`adr-lint.sh check`）はこのフィールドのみを対象とし、`accepted` の ADR のみ参照可能とする。本文中の自然文による歴史的言及（例: 「本決定は ADR-0007 を置き換える」）は検査対象外であり許可される。
