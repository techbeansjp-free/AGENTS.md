# PLAN: lint-references が .github/workflows/ を検査対象外にしており実デプロイ済みワークフローの § 参照違反を検出できない

- Issue: `ISSUE-221`
- 対応する DESIGN: `DESIGN.md`

## 実装順序・変更単位

DESIGN.md の設計要素A〜D を、以下の順序・単位で実装する。AC-1（是正前の違反再現）を確実に踏むため、走査対象拡張（#1・#2）を YAML 表記是正（#3）より先に行い、その中間状態で違反再現テストを固定してから是正する。

| # | 変更単位 | 内容 | 対応 AC-ID | 依存する変更単位 |
|---|---|---|---|---|
| 1 | `scan.ts: defaultReferenceFileRoots 追加` | `defaultLiveFileRoots(repoRoot)` の戻り値へ `path.join(repoRoot, '.github', 'workflows')` を加え `fs.existsSync` で実在のみへ絞る関数を新設（設計要素A）。`defaultLiveFileRoots`・`defaultVocabFileRoots` は変更しない | `AC-1, AC-4` | なし |
| 2 | `lint.ts: references() の走査ルート切替` | `references()` の `resolveTargets(args, root)` を `resolveTargets(args, root, defaultReferenceFileRoots)` へ変更し、import へ `defaultReferenceFileRoots` を追加（設計要素B）。`vocab()`・`resolveTargets` 既定引数は不変 | `AC-1, AC-2, AC-4` | `#1` |
| 3 | `root-cleanup.yml 表記是正（本体＋テンプレ正本）` | 両ファイル1行目 `§不変条件I4・§ディレクトリ構成` を `§不変条件I4 / §ディレクトリ構成` へ、完全同一文字列で同時変更（設計要素C）。`verify-template-sync` の1バイト一致を維持 | `AC-2, AC-3` | なし（ただし AC-2 成功は #1・#2 の対象化と合成） |
| 4 | `ビルド` | `npm run build` で `bin/agents-md.js` を再生成し、sh ラッパー（`lint-references.sh` は `bin/agents-md.js` を呼ぶ）へ変更を反映 | 全AC | `#1, #2` |
| 5 | `テスト追加・更新` | `test/unit/scan.test.ts` へ `defaultReferenceFileRoots`（`.github/workflows` を含む／非存在時は除外／vocab 集合不変）の検証、`test/integration/lint.test.ts` へ `.github/workflows` 配下 YAML の references 検出／是正後成功の検証を追加（設計要素A・B・D） | `AC-1, AC-2, AC-4` | `#1, #2` |
| 6 | `検証（各 lint スクリプト・npm test）` | `lint-references.sh` を本体・テンプレ正本両方に対し実行し違反ゼロ（AC-2）、`verify-template-sync.sh` 成功（AC-3）、`lint references` が他5本 YAML で新規違反を出さない（AC-4）、`lint vocab` が `.github/workflows` を巻き込まない、`npm test` 全通過を確認 | `AC-1〜AC-4` | `#3, #4, #5` |

## 実装順序の見直しについて

実装中に作業順序のみを見直す場合は本ファイルのみを更新すればよい。設計要素・責務・境界（`defaultReferenceFileRoots` を references 専用に分離し vocab を不変に保つ方針、2ファイル同時是正による同期維持）を変更する場合は DESIGN.md の更新と設計ゲートの再通過が必要になる。
