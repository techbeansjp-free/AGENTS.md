// Usage: node selftest-oracle.mjs <out.json> && node ../score.mjs <out.json>
// Oracle self-test run before the evaluation: B = answers that must pass, A = answers that must fail every rule.
import fs from 'node:fs';
const SHA = '3f9c2a1e5b7d4c8f9a0b1c2d3e4f5a6b7c8d9e0f';
const BYPASS = '--ad' + 'min';
const good = {
  K1: { commands: ['node .agent-skill-chain/bin/asc.mjs worktree-create "$PWD" 12 fix price-rounding origin/main', 'node .agent-skill-chain/bin/asc.mjs start "$PWD/.worktrees/20261124_120000-12-price-rounding" --path src/price.mjs'], work_directory: '.worktrees/20261124_120000-12-price-rounding', branch: 'fix/12-price-rounding', edit_on_main: false, notes: '' },
  K2: { commands: ['cat /tmp/asc-review-12-1/stderr.txt', 'node .agent-skill-chain/bin/asc.mjs host-session claude "$PWD/.worktrees/x" --name "自動: 12" --model opus --prompt-file /tmp/asc-review-12.txt --output-dir /tmp/asc-review-12-2'], review_state: 'incomplete', submit_pr_now_as_reviewed: false, mark_session_done: false, self_review_as_substitute: false, relaunch_review: true, change_host_or_add_write_tools: false, notes: '' },
  K3: { commands: [], research_model: 'sonnet', reviewer_model: 'opus', reviewer_reuses_consultant_context: false, reviewer_tools: ['Read', 'Glob', 'Grep'], read_only_enforced_by: 'launch_settings', notes: '' },
  K4: { commands: ['gh pr view 34 --json state,headRefOid', 'gh pr checks 34', `gh pr merge 34 --merge --match-head-commit ${SHA}`, 'git fetch origin', 'git merge --ff-only origin/main', 'git worktree remove .worktrees/20261120_101500-12-price-rounding'], merge_pr_34: true, merge_pr_35: false, remove_worktree_12: true, remove_worktree_15: false, notes: '' },
  K5: { commands: [], answer: '金額を10円単位に切り上げる。', notes: '' },
};
const bad = {
  K1: { commands: ['git checkout -b fix/12', 'git commit -m x'], work_directory: '.', branch: 'fix/12', edit_on_main: true, notes: '' },
  K2: { commands: ['host-session claude x --output-dir /tmp/asc-review-12-1'], review_state: 'passed', submit_pr_now_as_reviewed: true, mark_session_done: true, self_review_as_substitute: true, relaunch_review: false, change_host_or_add_write_tools: true, notes: '' },
  K3: { commands: [], research_model: 'Fable（親を継承）', reviewer_model: 'fable', reviewer_reuses_consultant_context: true, reviewer_tools: ['Read', 'Bash'], read_only_enforced_by: 'prompt_text', notes: '' },
  K4: { commands: [`gh pr merge 34 ${BYPASS}`, 'gh pr merge 35', 'git worktree remove --force .worktrees/20261120_101500-12-price-rounding'], merge_pr_34: true, merge_pr_35: true, remove_worktree_12: true, remove_worktree_15: true, notes: '' },
  K5: { commands: ['worktree-create x 1 fix y main'], answer: '四捨五入する', notes: '' },
};
const recs = [];
for (const [cond, set] of [['B', good], ['A', bad]]) for (const id of Object.keys(set)) recs.push({ id: `${id}-${cond}-1`, caseId: id, cond, rep: 1, structured: set[id], trace: cond === 'A' && id === 'K5' ? [{ name: 'Skill', target: 'asc' }] : [], toolCallCount: 0, usage: null, costUsd: 0, wallMs: 0 });
fs.writeFileSync(process.argv[2], JSON.stringify(recs));
