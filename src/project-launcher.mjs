/** Copied into shared project assets: resolve the runtime locally, never download it. */
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
import {spawnSync} from 'node:child_process';
try {
 const location=fileURLToPath(import.meta.url);
 const pin=JSON.parse(fs.readFileSync(new URL('../runtime.json',import.meta.url),'utf8'));
 if(pin.schema!=='asc-runtime/v1'||typeof pin.version!=='string')throw Error('Invalid ASC runtime pin');
 let manifest,cli;
 if(process.env.ASC_CLI){
  if(!path.isAbsolute(process.env.ASC_CLI))throw Error('ASC_CLI must be an absolute local CLI path');
  cli=fs.realpathSync(process.env.ASC_CLI);
  manifest=path.resolve(path.dirname(cli),'../package.json');
 }else{
  try{
   const bundled=fileURLToPath(new URL('../managed-runtime/package.json',import.meta.url));
   manifest=fs.existsSync(bundled)?bundled:createRequire(location).resolve('agent-skill-chain/package.json');
  }
  catch{throw Error(`Install agent-skill-chain ${pin.version} project assets from the trusted distribution (project-assets --apply), or explicitly set ASC_CLI to that installed version's bin/asc-v05.mjs. No automatic download or fallback.`);}
  cli=path.join(path.dirname(manifest),'bin/asc-v05.mjs');
 }
 const pkg=JSON.parse(fs.readFileSync(manifest,'utf8'));
 if(pkg.name!=='agent-skill-chain'||pkg.version!==pin.version)throw Error(`ASC runtime version mismatch: required ${pin.version}, found ${pkg.version}`);
 if(fs.realpathSync(cli)!==fs.realpathSync(path.join(path.dirname(manifest),'bin/asc-v05.mjs')))throw Error('ASC_CLI must identify the installed package CLI');
 const result=spawnSync(process.execPath,[cli,...process.argv.slice(2)],{stdio:'inherit',env:process.env});
 if(result.error)throw result.error;
 process.exitCode=result.status ?? 1;
}catch(error){console.error(error.message);process.exitCode=1;}
