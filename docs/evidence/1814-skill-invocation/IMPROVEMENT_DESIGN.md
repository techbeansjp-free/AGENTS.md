# 改善の設計案：読む契機を`project-assets`の既定の選択肢として提案する（#1814、未実装）

開発時の検証資料であり、配布対象に含めない。実装の前の設計の素案である。どの仕組み（`CLAUDE.md`の文例・SessionStartのhook）を既定にするかは、測定の後にownerが決める。測定で不足が無ければ実装しない（[decision-criteria.md](decision-criteria.md)の規則1）。

## 守ること

- 利用者の`CLAUDE.md`・`AGENTS.md`・hook・設定を、利用者の確認なしに作成・上書きしない（Issueの禁止。[v05/USAGE.md](../../../v05/USAGE.md)「project-assetsはこれらの文書を自動生成・上書きしない」）。
- 提案は差分として表示し、利用者がその差分を指定して承認したときだけ適用する。表示から承認までの間にfileが変わっていたら適用しない。
- 既存の内容を消さない・並べ替えない・書式を変えない。変えずに追記できない場合は自動で適用せず、手で貼る文と場所だけを示す。
- 採用した文は利用者の所有物とし、配布版の更新で自動変更しない（USAGEの現行の扱い「配布版更新時は採用済みの文例まで自動変更されない」と同じ）。

## 変更箇所

| 場所 | 変更 |
| --- | --- |
| `src/project-assets.mjs`の`projectAssets` | 計画（`--apply`なし）の結果に`readTrigger`を加える。登録Hostに`.claude`があり、まだ採用されていなければ、選択肢ごとに対象path・動作（作成／追記）・現在のsha256（無ければ`absent`）・unified diffを返す。既定の選択肢（測定で決まったもの）を`default`で示す。既存の`changes`・`conflicts`の意味は変えない |
| 同上の適用 | `--apply`に`--adopt-read-trigger <id>@<表示されたsha256>`を加えたときだけ、その選択肢を適用する。sha256が現在のfileと違えば全体を止める（計画と適用の間の変更の検出。既存の`Asset changed after planning`と同じ考え方）。配布資産の適用と同じtransaction（一時ディレクトリでの差分の作成、`git apply`、失敗時の復元）に載せる |
| `CLAUDE.md`の選択肢 | 末尾に区切り付きの塊（`<!-- asc:read-trigger v1 -->`〜`<!-- /asc:read-trigger -->`）で文例を追記する。fileが無ければ塊だけのfileを作る。塊が既にあれば提案しない。最後の行は閉じの区切りになるので、測定の条件Iでは文例が回答のどこかに現れるかで確かめる（#1814のprobe-checkの条件I。interfaceや文例の頭の文面が変わった場合は`harness/condition-i.mjs`だけを直す） |
| `.claude/settings.json`の選択肢 | JSONとして読み、`hooks.SessionStart`の配列へ1件を足す。他のkeyとhookは保持する。元のfileを同じ書式（2空白のindent）で書き直すと元のbytesに戻らない場合（コメント・別の書式）は、自動で適用せず手で貼る断片を示す。同じcommandの登録が既にあれば提案しない |
| hookのcommand | `node "$CLAUDE_PROJECT_DIR/.agent-skill-chain/bin/asc.mjs" read-trigger --hook`。新しい`src/read-trigger.mjs`（`src/resume-context.mjs`と同じ形）が、同梱本体の`v05/USAGE.md`の文例を`additionalContext`として返す。文例の正本はUSAGEの1か所のまま（複製しない）。版の更新で文面は同梱本体とともに変わり、利用者の`settings.json`は変わらない。読取りだけで、networkと書込みは無い。失敗しても終了コード0でsessionを止めない |
| `bin/asc-v05.mjs` | `project-assets`の引数に`--adopt-read-trigger`を加え、`read-trigger --hook`を加える。help文を直す |
| `src/runtime-files.json` | `src/read-trigger.mjs`を同梱本体へ加える |
| `.agent-skill-chain/distribution.json` | 採用した選択肢のid・path・塊のsha256を情報として記録する（所有の主張ではない）。以後の計画では、塊が変更・削除されていても提案し直さず、変更もしない |
| `uninstallProjectAssets` | 採用した塊・hookは利用者の所有物として残し、`retained`に表示する。消す場合の差分は利用者が別に確認する |
| `v05/USAGE.md` | 「ASCを読む契機を利用先へ採用する（任意）」を、提案と承認の手順へ書き換える。Codex（`AGENTS.md`・`.codex/hooks.json`）は測定の対象外なので、従来の手で採用する文例のまま残す |
| `test/test_project_assets.mjs`等 | 計画は書き込まない／承認なしの`--apply`は`CLAUDE.md`・設定を変えない／古いsha256の承認は止まる／既存のhookと他のkeyを保持する／書式を保てない`settings.json`は自動で適用しない／2回目は提案しない／uninstallは残す、の反例を加える |

## 利用者から見た流れ（案）

```text
$ node <prefix>/node_modules/agent-skill-chain/bin/asc-v05.mjs project-assets . --register-claude-skill
{ ..., "readTrigger": { "default": "claude-hook",
    "options": [ { "id": "claude-hook", "path": ".claude/settings.json", "action": "create", "beforeSha256": "absent", "diff": "..." },
                 { "id": "claude-md",   "path": "CLAUDE.md",             "action": "append", "beforeSha256": "3f1c…", "diff": "..." } ] } }
$ node …/asc-v05.mjs project-assets . --register-claude-skill --apply --adopt-read-trigger claude-hook@absent
```

`--adopt-read-trigger`を付けなければ、配布資産だけが従来どおり適用され、`CLAUDE.md`と設定は変わらない。

## 未決

- 既定にする選択肢（測定とownerの判断）。
- 文例の区切りの書式と、`CLAUDE.md`が`AGENTS.md`を参照するだけの利用先での追記先（USAGEの「共有規約を一方から参照している場合は正本だけへ追記する」に従い、参照先を判別できなければ自動では提案しない）。
- hookの文面をUSAGEの文例のままにするか、より強い文面（条件S）にするか（Sは今回の費用の上限では測らない）。
