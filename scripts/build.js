import fs from 'node:fs';
import path from 'node:path';

const required = [
  'bin/agent-skill-chain.js', 'AGENTS.md',
  '.agent-skill-chain/docs/00_運用ポリシー.md',
  '.agent-skill-chain/docs/01_開発ワークフロー.md',
  '.agent-skill-chain/docs/02_品質基準.md',
  '.agent-skill-chain/schemas/project-policy.schema.json', '.agent-skill-chain/policy/default.json',
];
const missing = required.filter((file) => !fs.existsSync(path.resolve(file)));
if (missing.length) throw new Error(`パッケージ資産が不足しています: ${missing.join(', ')}`);
fs.chmodSync(path.resolve('bin/agent-skill-chain.js'), 0o755);
process.stdout.write('v0.3パッケージ資産検査: 合格\n');
