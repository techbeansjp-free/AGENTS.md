# DESIGN: release publish の gh release create が --generate-notes を使わず、GitHub Release から What's Changed / Full Changelog の自動生成が失われている

- Issue: `ISSUE-226`
- 対応する SPEC: `SPEC.md`

## 要件 → 設計要素の対応表

| 要件 / AC-ID | 対応する設計要素 | 備考 |
|---|---|---|
| `AC-1` | `publish()` の引数組み立て（`--generate-notes` 追加） | 既存固定文は `--notes` として維持（自動生成 notes の先頭に付加される gh 公式仕様） |
| `AC-2` | `previousSemverTag()`（新設・純粋関数）＋ `publish()` の `--notes-start-tag` 条件付加 | 起点タグの選定ロジックを副作用なしで単体テスト可能にする |
| `AC-3` | `previousSemverTag()` が `undefined` を返す分岐（`--notes-start-tag` を付けない） | gh / GitHub の既定挙動（起点自動検出）に委ねる。失敗しないことは実測済み |
| `AC-4` | `publish()` の既存構造（semver 検査→冪等スキップ→作成）を不変に保つ | 変更は `gh release create` の引数組み立てとタグ一覧取得の追加のみ |

## 責務・境界

### コンポーネント構成

- `previousSemverTag(tags, target)`（`src/lib/release-version.ts` に新設）: 既存タグ一覧のうち `SEMVER_TAG_RE`（`^v(\d+)\.(\d+)\.(\d+)$`）に一致し、かつ `v` を除いた版数が `target` 未満のものの最大を、タグ名（`v` 付き）で返す。該当なしなら `undefined`。旧タイムスタンプ形式タグ（例: `v20260720.060726`）は `SEMVER_TAG_RE` 不一致により機械的に除外される。比較は既存の `compareSemver`（数値タプル比較。文字列比較では `0.2.9` > `0.2.10` の誤判定が起きるため）を再利用する。ファイル冒頭の既存規約どおり副作用を一切持たず、git/gh 実行は呼び出し側が担う。
- `publish()`（`src/commands/release.ts`）: 冪等スキップ判定の後、`git tag --list` でタグ一覧を取得し `previousSemverTag()` で起点タグを決定、`gh release create` の引数を組み立てる。`--generate-notes` は常に付与。起点タグが得られた場合のみ `--notes-start-tag <タグ名>` を追加する。`git tag --list` の失敗は既存の他コマンドと同様 `fail()` で非0終了する。

### 依存関係

```text
publish() → git tag --list（ローカルタグ一覧。release workflow は fetch-depth: 0 で checkout 済み、
            同一 job 内の resolve-version が同じ手段で動作している実績あり）
publish() → previousSemverTag()（純粋関数）
publish() → gh release create → GitHub generate-notes（What's Changed / Full Changelog の生成本体）
```

循環依存なし。`resolve-version`・`bump`・`tag` サブコマンドへの変更なし。

### 起点タグを明示指定する判断の根拠

GitHub の `previous_tag_name` 自動検出は Release 履歴由来であり、直前 semver タグではなく旧タイムスタンプ形式タグを起点に選びうることを実測で確認した（v0.2.2 に対する省略時、`v20260720.060726` を起点に選択）。「新旧版数体系をまたいだ比較をしない」という ADR-0005 と整合する成功基準を満たすため、自動検出に委ねず `--notes-start-tag` で明示指定する。逆に直前 semver タグが不在の場合は指定すべき値が存在しないため省略し、既定挙動（失敗しない・起点自動検出）に委ねる（AC-3 の許容範囲）。

## 関連ADR

```yaml
related_adrs:
  - id: ADR-0005
    relation: references
```

ADR-0005 は版数体系（semver 唯一の正本）・main 反映方式・marketplace/apm 廃止を確定した accepted ADR であり、本設計はその版数体系の下で Release 本文生成のみを補完する（新規 ADR は不要。恒久アーキテクチャ判断の変更を伴わないため）。

## 障害・ロールバック考慮

- 想定される失敗モード:
  - `git tag --list` 失敗 → `fail()` で非0終了。release workflow のリランで再試行可能（publish は冪等）。
  - `gh release create` 失敗（`--notes-start-tag` に指定したタグがリモート未存在等） → 従来どおり `fail()` で非0終了。本設計ではタグ一覧をローカル git から取得するため、workflow（fetch-depth: 0 checkout ＋直前の tag ステップ）ではローカルタグとリモートタグは一致する。
  - GitHub generate-notes の生成内容が期待と異なる（PR 経由でない commit のみの区間等） → コマンドは成功し、本文の What's Changed が空になるだけで Release 作成自体は失われない（安全側）。
- ロールバック手順: 本変更の revert で従来の固定文言のみの Release 生成へ戻る。データ移行・スキーマ変更を伴わないため revert のみで完結する。
- 影響を受ける既存機能: `release publish` のみ。`resolve-version`・`bump`・`tag`・冪等スキップ判定・標準出力/終了コード契約は不変。
