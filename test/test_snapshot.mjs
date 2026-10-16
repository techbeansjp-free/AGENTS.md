import {test} from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import {execFileSync} from 'node:child_process';import {readSnapshotFile} from '../src/snapshot.mjs';
test('snapshot export rejects symlink parents, hardlinks, FIFO and overflow',{skip:process.platform!=='linux'},t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'asc-snapshot-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 fs.mkdirSync(path.join(root,'source'));fs.writeFileSync(path.join(root,'source','data'),'ok');
 assert.equal(readSnapshotFile(root,'source/data',2).toString(),'ok');
 assert.throws(()=>readSnapshotFile(root,'source/data',1));
 fs.symlinkSync('source',path.join(root,'alias'));assert.throws(()=>readSnapshotFile(root,'alias/data'));
 fs.linkSync(path.join(root,'source/data'),path.join(root,'linked'));assert.throws(()=>readSnapshotFile(root,'linked'));
 execFileSync('mkfifo',[path.join(root,'pipe')]);assert.throws(()=>readSnapshotFile(root,'pipe'));
 assert.throws(()=>readSnapshotFile(root,'../outside'));assert.throws(()=>readSnapshotFile(root,'source/data',Infinity));
});
