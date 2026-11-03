// Replay the original frozen fixtures. Never replace their original freeze record.
import fs from 'node:fs';
import path from 'node:path';
import { here, root, scenarios, stages, checkFrozen } from './harness.mjs';

checkFrozen({ includeFixtures: false, includeSkills: false });
const fixtures = JSON.parse(fs.readFileSync(path.join(here, 'fixtures.json'), 'utf8'));
for (const name of scenarios) {
  const fixture = fixtures[name];
  for (const stage of stages) {
    const target = path.join(root, name, stage);
    const files = {
      'subject.mjs': fixture[stage],
      'test.mjs': fixture.test,
      'requirements.txt': fixture.requirements + '\n',
      'before.mjs': stage === 'initial' ? '// 新規操作。変更前はこのmoduleを提供していない。\n' : fixture.initial,
    };
    fs.mkdirSync(target, { recursive: true });
    for (const [name, content] of Object.entries(files)) {
      const file = path.join(target, name);
      if (fs.existsSync(file)) {
        if (fs.readFileSync(file, 'utf8') !== content) throw Error(`Refusing to replace different existing fixture: ${file}`);
      } else fs.writeFileSync(file, content, { flag: 'wx' });
    }
  }
}
checkFrozen({ includeSkills: false });
console.log(JSON.stringify({ root, original_frozen_at_utc: '2026-11-03T03:26:30.908718+00:00', frozen_manifest_changed: false, fixture_hashes_match: true }));
