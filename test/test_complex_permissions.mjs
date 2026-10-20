import {test} from 'node:test';
import assert from 'node:assert/strict';
import {extendFixturePermissions} from '../scripts/complex-permissions.mjs';
const filesystem='permissions.fixture.filesystem={ ":root"="deny", ":minimal"="read" }';
test('fixture access preserves base and network policy; reviewer gets no writes',()=>{
  const options=['-c',filesystem,'-c','permissions.fixture.network.enabled=false'];
  extendFixturePermissions(options,['/synthetic origin','/log'],[]);
  assert.equal(options[1],'permissions.fixture.filesystem={ ":root"="deny", ":minimal"="read", "/synthetic origin"="read", "/log"="read" }');
  assert.equal(options[3],'permissions.fixture.network.enabled=false');
});
test('assigned implementation path is writable and quoted safely',()=>{
  const options=[filesystem];extendFixturePermissions(options,['/origin'],['/origin/a"b']);
  assert.ok(options[0].includes(JSON.stringify('/origin/a"b')+'="write"'));
  assert.ok(options[0].includes('":root"="deny"'));
});
test('missing or ambiguous filesystem policy is rejected without mutation',()=>{
  for(const options of [[],['permissions.fixture.network.enabled=false'],[filesystem,filesystem]]){
    const before=[...options];assert.throws(()=>extendFixturePermissions(options,['/origin'],[]),/exactly one/);assert.deepEqual(options,before);
  }
});
test('changed table format is rejected instead of silently omitting access',()=>{
  const options=[filesystem.trimEnd().slice(0,-2)+'}'];const before=[...options];
  assert.throws(()=>extendFixturePermissions(options,['/origin'],[]),/Unsupported/);assert.deepEqual(options,before);
});
