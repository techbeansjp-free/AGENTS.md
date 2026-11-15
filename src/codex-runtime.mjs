/** Resolve host-owned Codex package assets without executing package code. */
import fs from 'node:fs';import path from 'node:path';import {createRequire} from 'node:module';
export function codexRuntimeRoots(executable){
 const binary=fs.realpathSync(executable);
 // Standalone native executables need no inferred parent directory grant.
 if(!/\.m?js$/i.test(binary))return [binary];
 const root=fs.realpathSync(path.dirname(path.dirname(binary))),roots=[];
 const manifest=JSON.parse(fs.readFileSync(path.join(root,'package.json'),'utf8'));
 if(manifest.name!=='@openai/codex')throw Error('Expected @openai/codex package root');
 roots.push(root);
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

/** Shared system temporaries that Codex's macOS profile leaves writable despite ':root'='deny' (#1695, #1701: measured
 * for /tmp and /var/tmp). Linux needs none: Codex mounts private /tmp, /var/tmp and /dev/shm there (measured, #1701). */
export function sharedTemporaryRoots(platform=process.platform){return platform==='darwin'?['/tmp','/private/tmp','/var/tmp','/private/var/tmp']:[];}

/** Filesystem grants shared by Agent, verification and the native diagnostic. Callers add their own write roots.
 * Explicit denial of the shared temporaries keeps a Controller without TMPDIR (whose temporary files then live
 * under /tmp) out of reach; a more specific grant, such as the private tool directory, still applies. */
export function sandboxFilesystemBase({providerRoots,node,platform=process.platform}){
 return {':root':'deny',':minimal':'read',...Object.fromEntries(sharedTemporaryRoots(platform).map(p=>[p,'deny'])),
  ...Object.fromEntries(nodeRuntimeRoots(platform).map(p=>[p,'read'])),...Object.fromEntries(providerRoots.map(p=>[p,'read'])),[node]:'read'};
}
