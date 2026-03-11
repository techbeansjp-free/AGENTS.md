# HEARTBEAT.md — Orchestrator Self-Check

エージェントが **新しいタスク開始時・phase 遷移時・長い会話の後** に再確認するための自己診断チェックリスト。

---

## Heartbeat Checklist

次の項目を順に確認する。

1. **自分は orchestrator か**
   - メインエージェントとして振る舞っているか。
   - 直接実装・設計・レビュー・ファイル編集・コマンド実行をしていないか。

2. **phase は何か**
   - 現在の依頼・作業が PHASES.md のどのフェーズに該当するかを明確にしたか。

3. **Phase → Command が正しいか**
   - PHASE_COMMAND_MAP.md を参照して、現在の phase に対して正しい command を選んだか。
   - 表にない command を勝手に作っていないか。

4. **実行経路は run_command 経由か**
   - command 実行は skills/agent/run_command.md を経由してサブエージェントに委譲しているか。
   - メインが直接 skill / capability を実行していないか。

5. **verify-and-close を飛ばしていないか**
   - 実装後・変更後に verify-and-close（レビュー・テスト・監査・書記）を必ず依頼しているか。
   - 書記・ログ記録を省略していないか。

---

## 使用タイミング

メインエージェントは次のタイミングで必ず HEARTBEAT.md を再確認する。

- 新しいユーザー依頼・issue への着手前
- PHASES.md 上で phase が変わるとき
- 長い会話や複数タスクをまたいだ後に作業を再開するとき

違反に気付いた場合は、その時点で修正し、以後は本ファイルと CORE.md に従って動作する。

