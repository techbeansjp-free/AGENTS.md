# DESIGN: lint-references が .github/workflows/ を検査対象外にしており実デプロイ済みワークフローの § 参照違反を検出できない

- Issue: `ISSUE-221`
- 対応する SPEC: `SPEC.md`

## 要件 → 設計要素の対応表

SPEC.md の全要件・全 AC-ID が、いずれかの設計要素に対応していることを示す。

| 要件 / AC-ID | 対応する設計要素 | 備考 |
|---|---|---|
| 要件: references のデフォルト走査対象へ本体 `.github/workflows/` を含める | 設計要素A（`defaultReferenceFileRoots` 新設）＋設計要素B（`references()` の呼び出し切替） | vocab のベース `defaultLiveFileRoots` は現状維持し、references 専用ルートで拡張する |
| 要件: `root-cleanup.yml`（本体・テンプレ正本）の `§不変条件I4・§ディレクトリ構成` を解決可能な記法へ是正 | 設計要素C（ワークフロー YAML 表記是正） | `・`区切りを空白＋`/`区切りへ変更 |
| 要件: 是正後 references は本体・テンプレ正本の両方に違反ゼロで成功 | 設計要素A＋B＋C | A/B で対象化し C で違反解消 |
| 要件: `verify-template-sync.sh` は引き続き成功（本体・テンプレ正本の1バイト一致維持） | 設計要素C（2ファイルへ同一変更を同時適用） | 変更は完全同一文字列 |
| 要件: 対象拡張後も他5本 YAML で新規違反が発生しない（無回帰の機械確認） | 設計要素A（対象拡張）＋設計要素D（無回帰確認） | 他5本は空白区切りで `headingCore()` により解決可能 |
| AC-1: 是正前に本体ワークフローの違反が再現できる（回帰テスト） | 設計要素A＋B | 対象化により是正前は違反検出される。単体（scan）＋統合（CLI）テストで担保 |
| AC-2: 是正後に本体・テンプレ正本の両方で lint が成功 | 設計要素A＋B＋C | 対象化＋表記是正の合成結果 |
| AC-3: `verify-template-sync` が引き続き成功 | 設計要素C | 本体・テンプレ正本へ同一変更 |
| AC-4: 対象拡張により他5本 YAML で新規違反が発生しない | 設計要素A＋D | `lint references` 実行結果で無回帰を機械確認 |

## 責務・境界

### コンポーネント構成

3つの独立した変更要素からなる。責務は「走査対象の決定（scan）」「サブコマンドの結線（lint）」「データ側の表記是正（YAML）」に分離し、1コンポーネントへ集中させない。

- 設計要素A `src/lib/scan.ts` — `defaultReferenceFileRoots(repoRoot: string): string[]` を新設する。`defaultLiveFileRoots(repoRoot)` の戻り値へ `path.join(repoRoot, '.github', 'workflows')` を追加した配列を返し、末尾で `fs.existsSync` により実在パスのみへ絞る（`.github/workflows` 非存在環境でも安全）。責務は references の走査ルート集合の決定に限定する。`defaultLiveFileRoots`（vocab のベース）・`defaultVocabFileRoots` は一切変更しない。
- 設計要素B `src/commands/lint.ts` — `references()` 内の `resolveTargets(args, root)` を `resolveTargets(args, root, defaultReferenceFileRoots)` へ変更し、import に `defaultReferenceFileRoots` を追加する。`resolveTargets` の既定引数・`vocab()` 側（`defaultVocabFileRoots` 使用）は変更しない。責務は references サブコマンドと新ルート関数の結線に限定する。
- 設計要素C ワークフロー YAML 表記是正 — `.github/workflows/agent-skill-chain-root-cleanup.yml`（本体）と `.agent-skill-chain/templates/github/.github/workflows/agent-skill-chain-root-cleanup.yml`（テンプレ正本）の1行目 `# 正本: AGENTS.md §不変条件I4・§ディレクトリ構成 / ADR-0007` を `# 正本: AGENTS.md §不変条件I4 / §ディレクトリ構成 / ADR-0007` へ、両ファイルへ同一文字列で同時変更する。空白が入ることで `SECTION_REF_RE`（除外文字集合に空白を含む）が `§不変条件I4` でキャプチャを止め、`headingCore()` が末尾 `I4` を除去して見出し「不変条件 I1〜I8」の芯「不変条件」と一致、`§ディレクトリ構成` も見出し「ディレクトリ構成」と一致して解決可能になる。
- 設計要素D 無回帰確認（テスト・検証手順） — 対象拡張により他5本 YAML（ci/reconcile/gate/release/risk）で新規違反が出ないことを `lint references` 実行と統合テストで機械確認する。`TEXT_EXTENSIONS` は既に `.yml` を含むため拡張子起因の追加変更は不要。

### 依存関係

```text
設計要素C（YAML 表記是正・データ） … 独立
設計要素B（lint.ts references）→ 設計要素A（scan.ts defaultReferenceFileRoots）→ fs/path
設計要素A（references 走査対象）→ 設計要素C の是正結果を対象化して検証（A/B が C の前だと AC-1 の違反再現、後だと AC-2 の成功）
```

`defaultReferenceFileRoots` は `defaultLiveFileRoots` を内部で呼ぶ一方向依存であり循環はない。vocab 経路（`defaultVocabFileRoots`）とは関数レベルで分離され相互干渉しない。

## 関連ADR

なし（既存関数の対象追加と YAML コメント1行の表記是正であり、新規の設計判断・破壊的変更を伴わない。SPEC がスコープ外と明記した `SECTION_REF_RE` 一般化も行わない）。

```yaml
related_adrs: []
```

## 障害・ロールバック考慮

- 想定される失敗モード1: `.github/workflows` が存在しない環境（consumer 導入直後等）で `defaultReferenceFileRoots` が非実在パスを返す。→ 末尾 `fs.existsSync` フィルタで除外し、拡張前と同一の走査集合へ縮退するため安全（`walkTextFiles` 側も `fs.existsSync` ガードあり、二重防御）。
- 想定される失敗モード2: 本体とテンプレ正本の片方だけ是正して `verify-template-sync.sh` が失敗する。→ 設計要素C は必ず2ファイルへ完全同一文字列を同時適用し、実装後に `verify-template-sync.sh` の成功を確認する（AC-3）。
- 想定される失敗モード3: vocab 検査へ `.github/workflows` が意図せず巻き込まれ新規回帰を生む。→ `defaultVocabFileRoots`/`defaultLiveFileRoots` を変更しない設計により構造的に排除。機械確認は `lint vocab` 実行で `.github/workflows/*.yml` が対象に含まれないこと、および `test/unit/scan.test.ts` の `defaultVocabFileRoots` 集合検証が不変であることで担保する。
- ロールバック手順: 設計要素A/B/C はいずれも小さな独立差分であり、`git revert` で個別または一括に切り戻せる。切り戻し後は拡張前の挙動（`.github/` 走査なし・`・`区切り表記）へ完全復帰する。
- 影響を受ける既存機能: `agent-skill-chain lint references`（走査対象が拡大）。`lint vocab`・`lint adr`・`lint secrets`・`verify-template-sync` の挙動は不変。
