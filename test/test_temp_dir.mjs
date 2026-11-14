import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import {fileURLToPath} from 'node:url';
import {tempDir} from './helpers/temp-dir.mjs';
const testRoot=path.dirname(fileURLToPath(import.meta.url)),helper=path.join(testRoot,'helpers','temp-dir.mjs');
// Oracle programs under fixtures/ are copied into fixture projects and cannot import test helpers.
const skipped=new Set([helper,path.join(testRoot,'fixtures')]);
function sources(dir){return fs.readdirSync(dir,{withFileTypes:true}).flatMap(e=>{const p=path.join(dir,e.name);if(skipped.has(p))return [];return e.isDirectory()?sources(p):/\.m?js$/.test(e.name)?[p]:[];});}
test('tempDir returns a new directory by its real path',t=>{
 const dir=tempDir('asc-temp-dir-');t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 assert.equal(fs.realpathSync(dir),dir);assert.ok(fs.statSync(dir).isDirectory());assert.ok(path.basename(dir).startsWith('asc-temp-dir-'));
 assert.equal(path.dirname(dir),fs.realpathSync(os.tmpdir()));
});
test('tests create temporary directories only through tempDir',()=>{
 const direct=sources(testRoot).filter(file=>/\bmkdtempSync\s*\(/.test(fs.readFileSync(file,'utf8'))).map(file=>path.relative(testRoot,file));
 assert.deepEqual(direct,[],'use tempDir from test/helpers/temp-dir.mjs');
});
