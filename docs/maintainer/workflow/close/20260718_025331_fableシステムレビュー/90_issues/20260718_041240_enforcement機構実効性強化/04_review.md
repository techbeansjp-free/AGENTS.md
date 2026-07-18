---
document_id: "f1a2b3c4-5d6e-4f7a-8b9c-0d1e2f3a4b5c"
---

# レビュー: enforcement機構の実効性強化（領域C: C-1〜C-9）

**前のステップ**: [03_実装計画.md](./03_実装計画.md)

実装先: `.worktree/bugfix/20260718_092843-enforcement機構実効性強化/`（ブランチ `bugfix/20260718_092843-enforcement機構実効性強化`）。

---

## 実装内容の確認

02_設計.md の対応方針（C-1〜C-9・全9件、C-1のユーザー承認済み推奨案含む）どおり実装した。詳細は 03_実装計画.md §1・§2 を参照。

- 変更ファイルは所有範囲（`.agent-skill-chain/source/enforcement/` 配下）に収まっている。
- 変更した全シェルスクリプトを `bash -n` で構文確認し、エラーなし。
- 各項目について実機相当のフック呼び出し・使い捨て git リポジトリでの `audit.sh` 実行により動作確認済み（03_実装計画.md §テスト観点 参照）。

---

## 敵対的観点（REVIEW_DUAL_LENS）

1. **R1B の判定順序と R1 の相互作用**: R1B は R1 のブロック（`block()`＝即 `exit 2`）の後に評価されるコードパスに置かれているため、R1 が先に block した場合 R1B は評価されない。しかし R1（`runtime/` 配下）と R1B（`source/enforcement/**` 等）は保護対象パスが重ならない設計であり、対象パスがどちらか一方にしかマッチしない前提であることを実装・テストで確認済み。両方に同時マッチしうる病的なパス（例: シンボリックリンクで両方を指す）は本実装のスコープ外（既存 R1 の symlink 検査と同水準の限界として許容）。
2. **`ASC_ENFORCEMENT_SELF_DEV` の解除が worker のみでなく main（orchestrator）にも及ぶ点**: R1B は ROLE を判定条件に含めていないため、`ASC_ENFORCEMENT_SELF_DEV` が設定されている間は main（orchestrator）による enforcement 正本への直接 Edit/Write も解除される（R2 の main 制限とは独立ガードのため）。ただし R2 は R1B とは別途評価され、main が Edit/Write を試みれば R2 で改めて block されるため、実害は「R1B の追加保護が一時的に外れる」に留まり、main の直接実作業禁止という既存の絶対強制（R2）は損なわれない。
3. **AUDIT_STRICT の対象外変数（WORKTREE_NAMING_AUDIT_ENABLED 等）**: strict モードは `*_GATE_ENABLED` 命名規則の4変数のみを強制対象とし、`WORKTREE_NAMING_AUDIT_ENABLED`（命名規則が異なる）は対象外。これは 02_設計.md の記述（「`*_GATE_ENABLED`・`MAIN_WORK_GATE_TOLERANCE_SECONDS`・`WORKFLOW_DIRS` に限定」）に忠実だが、将来 `*_GATE_ENABLED` 以外の無効化トグルが追加された場合、strict でも骨抜きにされうる残存経路になりうる（設計判断としての既知のトレードオフであり、実装ミスではない）。
4. **C-5 の可用性コスト**: jq 非搭載環境では、enforce-on 時に正規の subagent 委譲も `IS_SUBAGENT=0` と評価され、main と同様の R2 制限を受ける（worker が実作業できなくなる）。これは 02_設計.md 反復1で明記済みの許容されたトレードオフであり、jq 導入が回避策として案内されている。
5. **C-6 の best-effort 性**: `bash -c "sqlite3 ..."` の検知は、`-c` 引数の**最初のトークン**のみを見る簡易実装であり、`bash -c "alias s=sqlite3; s foo.db"` のような間接呼び出しは検知できない（既存コメントで正直に明記済み・全面的な静的解析は非目標）。
6. **C-7 の除外条件の広さ**: `..` 除外は「`.agent-skill-chain/runtime/` を参照しかつ `..` を含む」パス全体を対象とするため、carve-out の有無に関わらず一律 block になる。正当な carve-out 対象パスは `..` を含まない前提（02_設計.md 反復2で確認済み）のため実運用上の誤 block は想定されないが、将来 carve-out 対象が拡張され `..` を要する正当パスが生じた場合は本ガードとの再整合が必要になる。
7. **#42 のスコープ**: `check_enforcement_diff_has_evidence` は「対象差分に enforcement 正本の変更が含まれるか」のみを見ており、#25 と同様に「その委譲・レビュー証跡が同一の変更に対応するか」までは突合しない（許容窓すら設けていないため #25 より緩い代わりに、command 種別の限定は #25 と同一）。これは 02_設計.md の具体案どおりの実装であり、対象差分と無関係な過去の委譲ログでも PASS しうる限界がある（#25 と同型の限界として README #42 行に明記はしていない。今回追加漏れであり是正候補）。

---

## must-preserve（不変条件）

1. **R2（orchestrator の Write/Edit/Shell 拒否）の絶対強制は変更しない**: 本実装のいずれの変更も R2 の判定条件・block メッセージ・評価順序を変更していない。R1B は R2 とは独立した path 軸ガードとして追加した（R2 の前段に置いたが、R2 の評価を妨げない no-op フォールスルーではなく exit 2 の即時 block である点は、対象パスが root 側〈enforcement 正本〉のみに限定されるため R2 の評価領域〈全ファイル〉と衝突しない）。
2. **既存の carve-out（.gitignore 厳密一致・templates・doc allowlist）の許可範囲は、`..` を含まない正当なパスに対しては変更しない**: C-7 のガードは `..` を含むパスのみを新たに block 対象へ追加するものであり、既存の正当な carve-out 経路（`..` を含まない）への影響はない。
3. **`is_sqlite3_invocation` の既存の非対象ケース（`grep sqlite3 doc.md` 等）を誤 block しない**: C-6 追加後もテーブル駆動テストで確認済み。
4. **audit.sh の既存チェック（#1〜#41）の合否判定ロジックは変更しない**: `set -e` → `set +e` の変更（C-9）は、各 check が `EXIT_CODE=1` を明示的に設定する既存の集約方式に依存しており、既存チェックの FAIL/PASS 条件そのものは変更していない。
5. **`AUDIT_GIT_RANGE` は AUDIT_STRICT の強制対象に含めない**: CI が正当に渡す差分範囲の入力であるため、strict モードでも上書き・無視されない（02_設計.md 反復1で明記の是正済み事項）。
6. **jq 搭載環境での既存の agent_id・tool_name・command・file_path 抽出ロジックは変更しない**: C-5 の変更は jq **非搭載**時の agent_id フォールバックのみに限定。

---

## docs 更新

- 要否: 不要
- 理由: 本変更は `.agent-skill-chain/source/enforcement/` 配下（フレームワーク自身の強制機構）の実装・ドキュメントであり、消費者向けシステム仕様書（`docs/`）の更新を要する対象ではない。変更内容は enforcement 配下の README.md・DESIGN.md 自体に反映済みであり、それらが当該変更の正本ドキュメントである。

---

## 完了判定

- 02_設計.md の対応方針どおり C-1〜C-9 の全9件を実装完了。
- 変更は実装先worktree（`bugfix/20260718_092843-enforcement機構実効性強化`）でコミット済み。
- push・PR 作成は本タスクのスコープ外（進行役の指示により実施しない）。
