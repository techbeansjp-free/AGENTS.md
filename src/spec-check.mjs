import fs from 'node:fs';
import path from 'node:path';

/**
 * Opt-in, read-only check of a user's spec tree against its own placement table (#1830, table from #1827).
 * 1. Every ID of a table kind referenced from the quality-warranty documents (the WAR canonical) must be defined in a
 *    canonical document of that ID kind: as the first cell of a table row or the first word of a heading.
 * 2. The same value written in two documents for the same ID (a table row naming the ID repeats a cell of another
 *    document's row naming that ID) is reported, unless every such document is a canonical document of the ID kind.
 * Prose, code blocks and cells that hold an ID, a link, a code span or a {placeholder} are not compared. A value is a
 * cell after the row's first (key) cell with a digit (versions, thresholds, periods) or of at least MIN_TEXT characters: the short labels the templates
 * offer as choices (分類・品質特性・状態, e.g. セキュリティ) repeat across documents without copying a value. Nothing is written; the user decides what to change.
 */
const MAX_FILES=2000,MAX_BYTES=1000000,MIN_DIGIT=2,MIN_TEXT=10;
const HEADER=['情報の種類','正本','ID','参照だけにする文書'];

function readText(file){
 const stat=fs.lstatSync(file);
 if(!stat.isFile())throw Error(`Not a regular file: ${file}`);
 if(stat.size>MAX_BYTES)throw Error(`Spec file exceeds ${MAX_BYTES} bytes: ${file}`);
 return fs.readFileSync(file,'utf8');
}

/** Split a Markdown table row into trimmed cells, keeping escaped pipes inside a cell. */
export function cells(line){
 const body=line.trim().replace(/^\|/,'').replace(/(?<!\\)\|$/,'');
 return body.split(/(?<!\\)\|/).map(cell=>cell.trim());
}

/** Lines outside fenced code, with 1-based line numbers. */
function structural(text){
 const out=[];let fence=null;
 text.split(/\r?\n/).forEach((line,index)=>{
  // An opening fence may carry an info string; a closing fence is the marker alone (CommonMark).
  const marker=(fence?/^\s*(`{3,}|~{3,})\s*$/:/^\s*(`{3,}|~{3,})/).exec(line)?.[1];
  if(marker&&(!fence||marker[0]===fence[0]&&marker.length>=fence.length)){fence=fence?null:marker;return;}
  if(!fence)out.push({line,number:index+1});
 });
 return out;
}

/** Table body rows (header and separator excluded) and headings of a Markdown text. */
function parse(text){
 const rows=[],headings=[];let block=[];
 const flush=()=>{
  if(block.length>=2&&/^\|?\s*:?-{3,}/.test(block[1].line.trim()))for(const row of block.slice(2))rows.push({cells:cells(row.line),number:row.number});
  block=[];
 };
 for(const entry of structural(text)){
  if(entry.line.trim().startsWith('|')){block.push(entry);continue;}
  flush();
  const heading=/^#{1,6}\s+(.*)$/.exec(entry.line);
  if(heading)headings.push({text:heading[1].trim(),number:entry.number});
 }
 flush();
 return {rows,headings};
}

/** Read the placement table ("## 置き場の表") of the user's guide. */
export function placementTable(text){
 const lines=text.split(/\r?\n/),start=lines.findIndex(line=>/^##\s+置き場の表\s*$/.test(line));
 if(start<0)throw Error('Placement table heading "## 置き場の表" not found');
 const after=lines.slice(start+1),first=after.findIndex(line=>line.trim().startsWith('|'));
 if(first<0)throw Error('Placement table not found under "## 置き場の表"');
 const table=[];for(const line of after.slice(first)){if(!line.trim().startsWith('|'))break;table.push(line);}
 if(table.length<3||JSON.stringify(cells(table[0]))!==JSON.stringify(HEADER))throw Error(`Placement table header must be: | ${HEADER.join(' | ')} |`);
 return table.slice(2).map(line=>{
  const [kind,canonicalCell,idCell]=cells(line),canonical=/`([^`]+)`/.exec(canonicalCell??'')?.[1];
  if(!kind||!canonical||idCell===undefined)throw Error(`Unreadable placement table row: ${line}`);
  const prefixes=idCell==='-'?[]:idCell.split('/').map(id=>id.trim());
  if(prefixes.some(id=>!/^[A-Z][A-Z0-9]*$/.test(id)))throw Error(`Unreadable ID prefix in placement table row: ${line}`);
  return {kind,canonical:path.posix.normalize(canonical.normalize('NFC')),prefixes};
 });
}

function listMarkdown(root){
 const files=[];
 const walk=relative=>{
  for(const entry of fs.readdirSync(path.join(root,relative),{withFileTypes:true}).sort((a,b)=>a.name.localeCompare(b.name))){
   if(entry.name.startsWith('.')||entry.isSymbolicLink())continue;
   const child=relative?`${relative}/${entry.name.normalize('NFC')}`:entry.name.normalize('NFC');
   if(entry.isDirectory())walk(child);
   else if(entry.isFile()&&entry.name.endsWith('.md')){files.push(child);if(files.length>MAX_FILES)throw Error(`More than ${MAX_FILES} Markdown files under ${root}`);}
  }
 };
 walk('');
 return files;
}

/** A canonical path matches itself; a "...テンプレート.md" canonical also matches its numbered copies (01_FN-001_名称.md). */
function matches(canonical,file){
 if(file===canonical)return true;
 const base=path.posix.basename(canonical),number=/^(\d+)_.*テンプレート\.md$/.exec(base)?.[1];
 return number!==undefined&&path.posix.dirname(file)===path.posix.dirname(canonical)&&path.posix.basename(file).startsWith(`${number}_`);
}

function idPattern(prefixes){
 const names=[...prefixes].sort((a,b)=>b.length-a.length).join('|');
 return new RegExp(`(?<![A-Za-z0-9_-])(?:${names})-[A-Za-z0-9]+(?:-[A-Za-z0-9]+)*(?![A-Za-z0-9_])`,'g');
}

function normalizeValue(cell){return cell.normalize('NFKC').replace(/\s+/g,' ').trim();}
function isValue(cell,pattern){
 const value=normalizeValue(cell);
 const length=[...value.replace(/\s/g,'')].length;
 if(length<(/\d/.test(value)?MIN_DIGIT:MIN_TEXT))return false;
 pattern.lastIndex=0;if(pattern.test(value))return false;
 return !/\{[^}]*\}|\[[^\]]*\]\([^)]*\)|`/.test(value);
}

/** Check a spec directory (holding the guide and details/); returns findings without changing any file. */
export function checkSpecs(specsDirectory,{table}={}){
 const specs=fs.realpathSync(specsDirectory),details=path.join(specs,'details');
 if(!fs.statSync(details,{throwIfNoEntry:false})?.isDirectory())throw Error(`details/ directory not found: ${details}`);
 const tableFile=table===undefined?path.join(specs,'00_利用案内.md'):path.resolve(table);
 const rows=placementTable(readText(tableFile));
 const prefixes=new Set(rows.flatMap(row=>row.prefixes));
 if(!prefixes.size)throw Error('Placement table names no ID prefix');
 const pattern=idPattern(prefixes),byLength=[...prefixes].sort((a,b)=>b.length-a.length);
 const idPrefix=id=>byLength.find(prefix=>id.startsWith(`${prefix}-`));
 const canonicalOf=prefix=>rows.filter(row=>row.prefixes.includes(prefix)).map(row=>row.canonical);
 const isCanonical=(prefix,file)=>canonicalOf(prefix).some(canonical=>matches(canonical,file));
 const shown=file=>`details/${file}`;
 const docs=listMarkdown(details).map(file=>({file,text:readText(path.join(details,file))}));
 const parsed=new Map(docs.map(doc=>[doc.file,parse(doc.text)]));
 const ids=text=>{pattern.lastIndex=0;return [...text.matchAll(pattern)].map(match=>match[0]);};

 // 1. Definitions: first cell of a table row, or first word of a heading, in a canonical document of the kind.
 const defined=new Set();
 for(const [file,{rows:tableRows,headings}] of parsed){
  const candidates=[...tableRows.map(row=>row.cells[0]??''),...headings.map(heading=>heading.text.split(/\s+/)[0])];
  for(const candidate of candidates){const id=ids(candidate);if(id.length===1&&id[0]===candidate&&isCanonical(idPrefix(candidate),file))defined.add(candidate);}
 }
 // The quality-warranty documents are the canonical documents of the WAR kind (#1828); none means nothing to check.
 const warranty=prefixes.has('WAR')?docs.filter(doc=>isCanonical('WAR',doc.file)):[];
 const brokenReferences=[];
 for(const doc of warranty){
  for(const {line,number} of structural(doc.text))for(const id of ids(line)){
   if(!defined.has(id))brokenReferences.push({file:shown(doc.file),line:number,id,canonical:canonicalOf(idPrefix(id)).map(shown)});
  }
 }

 // 2. The same value written in rows of two or more documents that name the same ID.
 const occurrences=new Map();
 for(const [file,{rows:tableRows}] of parsed)for(const row of tableRows){
  const rowIds=new Set(row.cells.flatMap(ids));
  // The first cell is the row's key (an ID, or a label such as 観点 that another table keys by the same words), not a value.
  for(const cell of row.cells.slice(1)){
   if(!isValue(cell,pattern))continue;
   for(const id of rowIds){
    const key=JSON.stringify([id,normalizeValue(cell)]);
    if(!occurrences.has(key))occurrences.set(key,[]);
    const places=occurrences.get(key);if(!places.some(place=>place.file===file&&place.line===row.number))places.push({file,line:row.number});
   }
  }
 }
 // One finding per value and set of places, listing every ID the rows share (a row naming REQ and AC is one finding).
 const findings=new Map();
 for(const [key,places] of occurrences){
  const [id,value]=JSON.parse(key),files=new Set(places.map(place=>place.file));
  if(files.size<2||[...files].every(file=>isCanonical(idPrefix(id),file)))continue;
  const locations=places.map(place=>({file:shown(place.file),line:place.line})),group=JSON.stringify([value,locations]);
  if(!findings.has(group))findings.set(group,{ids:[],value,locations,canonical:[]});
  const finding=findings.get(group);finding.ids.push(id);
  for(const canonical of canonicalOf(idPrefix(id)).map(shown))if(!finding.canonical.includes(canonical))finding.canonical.push(canonical);
 }
 const duplicates=[...findings.values()];
 return {schema:'asc-spec-check/v1',specs,table:tableFile,warranty:warranty.map(doc=>shown(doc.file)),passed:!brokenReferences.length&&!duplicates.length,brokenReferences,duplicates,writes:false};
}
