/** Source-only prepack guard: npm's implicit files also need explicit approval. */
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';

function paths(values,label){
 if(!Array.isArray(values)||values.some(name=>typeof name!=='string'||path.isAbsolute(name)||/[\\?*]/.test(name)||name.split('/').some(part=>!part||part==='.'||part==='..'))||new Set(values).size!==values.length)throw Error(`Invalid ${label} file inventory`);
 return new Set(values);
}
function equal(actual,expected,label){
 const unexpected=[...actual].filter(name=>!expected.has(name)),missing=[...expected].filter(name=>!actual.has(name));
 if(unexpected.length||missing.length)throw Error(`${label} file inventory mismatch; unexpected: ${unexpected.join(', ')||'(none)'}; missing: ${missing.join(', ')||'(none)'}`);
}
export function checkPackageInventory(directory){
 const root=fs.realpathSync(directory),inventory=paths(JSON.parse(fs.readFileSync(path.join(root,'src/runtime-files.json'))),'runtime');
 const manifest=JSON.parse(fs.readFileSync(path.join(root,'package.json')));
 equal(paths(manifest.files,'package declarations'),inventory,'Package declarations');
 const npm=process.env.npm_execpath||path.resolve(path.dirname(process.execPath),process.platform==='win32'?'node_modules/npm/bin/npm-cli.js':'../lib/node_modules/npm/bin/npm-cli.js');
 // --ignore-scripts is essential here: ordinary npm pack invokes this guard.
 const listings=JSON.parse(execFileSync(process.execPath,[npm,'pack','--dry-run','--ignore-scripts','--json'],{cwd:root,encoding:'utf8',timeout:120000,maxBuffer:8e6,stdio:['ignore','pipe','pipe']}));
 if(!Array.isArray(listings)||listings.length!==1||!Array.isArray(listings[0].files))throw Error('Invalid npm package listing');
 const listing=listings[0];equal(paths(listing.files.map(entry=>entry.path),'npm pack'),inventory,'npm pack');
 return listing;
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))checkPackageInventory(process.cwd());
