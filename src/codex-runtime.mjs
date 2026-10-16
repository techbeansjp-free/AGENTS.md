/** Resolve host-owned Codex package assets without executing package code. */
import fs from 'node:fs';import path from 'node:path';import {createRequire} from 'node:module';
export function codexRuntimeRoots(executable){
 const binary=fs.realpathSync(executable),root=fs.realpathSync(path.dirname(path.dirname(binary))),roots=[root];
 // The official npm launcher resolves these optional native packages itself.
 // Include only the current platform package, never the whole node_modules tree.
 if(['linux','darwin','win32'].includes(process.platform)&&['x64','arm64'].includes(process.arch)){
  const name=`@openai/codex-${process.platform}-${process.arch}`;
  try{const manifest=createRequire(binary).resolve(name+'/package.json');roots.push(fs.realpathSync(path.dirname(manifest)));}
  catch(error){if(error.code!=='MODULE_NOT_FOUND')throw error;}
 }
 return [...new Set(roots)];
}

/** Node's system OpenSSL configuration is runtime data, never user configuration. */
export function nodeRuntimeRoots(platform=process.platform){return platform==='darwin'?['/System/Library/OpenSSL']:[];}
