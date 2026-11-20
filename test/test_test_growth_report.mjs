import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';import {spawnSync} from 'node:child_process';import {fileURLToPath} from 'node:url';
import {tempDir} from './helpers/temp-dir.mjs';
import {DEFAULT_THRESHOLDS,buildReport,measure,parseJunit,readTestTree,renderAnnotations,renderSummary,run,scanSource} from '../scripts/test-growth-report.mjs';
// #1732: the report only informs. Thresholds, missing inputs and internal errors never change the exit code from 0.
const script=fileURLToPath(new URL('../scripts/test-growth-report.mjs',import.meta.url));
const files=entries=>new Map(Object.entries(entries));
const lines=n=>Array.from({length:n},(_,i)=>`// ${i}`).join('\n')+'\n';
const sink=()=>{const out={text:'',write(chunk){out.text+=chunk;}};return out;};

test('measure counts test calls, lines and files, and classifies process and Git use through imported helpers',()=>{
 const tree=files({
  'test/test_pure.mjs':"import test from 'node:test';\ntest('a',()=>{});\ntest.skip('b',()=>{});\nit('c',()=>{});\n/x/.test('y');obj.test('z');\n",
  'test/test_git.mjs':"import test from 'node:test';import {repo} from './helpers/repo.mjs';\ntest('d',()=>repo());\n",
  'test/test_spawn.mjs':"import {spawnSync} from 'node:child_process';import test from 'node:test';\ntest('e',()=>spawnSync('node'));\n",
  'test/helpers/repo.mjs':"import {execFileSync} from 'node:child_process';export const repo=()=>execFileSync('git',['init']);\n",
 });
 const {total,perFile}=measure(tree);
 assert.deepEqual(total,{files:4,tests:5,lines:10,processTests:2,gitTests:1});
 assert.equal(perFile.get('test/test_pure.mjs').tests,3);
 assert.deepEqual({process:perFile.get('test/test_git.mjs').process,git:perFile.get('test/test_git.mjs').git},{process:true,git:true});
 assert.deepEqual({process:perFile.get('test/test_spawn.mjs').process,git:perFile.get('test/test_spawn.mjs').git},{process:true,git:false});
});

test('samples inside strings, templates, comments and regular expressions are not counted as tests, imports or Git',()=>{
 const sample=[
  "import test from 'node:test';",
  "const text=\"test('a',()=>{});execFileSync('git',[]);import {x} from './helpers/repo.mjs';\";",
  "const tpl=`it('b',()=>{}) ${1} test('c')`;// test('d',()=>{})",
  "/* it('e',()=>{}) */const re=/'test\\(/;const quote=/[\"]/g;",
  "test('real',()=>{});",
 ].join('\n')+'\n';
 const {total,perFile}=measure(files({'test/test_sample.mjs':sample,'test/helpers/repo.mjs':"import {execFileSync} from 'node:child_process';execFileSync('git');\n"}));
 assert.equal(perFile.get('test/test_sample.mjs').tests,1);
 assert.deepEqual({process:perFile.get('test/test_sample.mjs').process,git:perFile.get('test/test_sample.mjs').git},{process:false,git:false});
 assert.equal(total.processTests,0);
 const scanned=scanSource("import a from './b.mjs';const t=`x${y}`;");
 assert.deepEqual(scanned.strings,['./b.mjs',null]);assert.match(scanned.code,/from "#0"/);
});

test('growth beyond the line and test thresholds yields warnings, and growth within them yields none',()=>{
 const base=files({'test/test_a.mjs':"test('a',()=>{});\n"});
 const small=buildReport({base,head:files({'test/test_a.mjs':"test('a',()=>{});\ntest('b',()=>{});\n"}),durations:null});
 assert.deepEqual(small.delta,{files:0,tests:1,lines:1,processTests:0,gitTests:0});assert.deepEqual(small.warnings,[]);
 const many=Array.from({length:DEFAULT_THRESHOLDS.netTests+1},(_,i)=>`test('n${i}',()=>{});`).join('\n')+'\n';
 const large=buildReport({base,head:files({'test/test_a.mjs':"test('a',()=>{});\n",'test/test_b.mjs':many+lines(DEFAULT_THRESHOLDS.netLines)}),durations:null});
 assert.equal(large.delta.lines,DEFAULT_THRESHOLDS.netLines+DEFAULT_THRESHOLDS.netTests+1);assert.equal(large.delta.tests,DEFAULT_THRESHOLDS.netTests+1);
 assert.deepEqual(large.warnings.map(w=>w.title),['テストの行数が増えています','テストの数が増えています']);
 const exact=buildReport({base:files({}),head:files({'test/test_c.mjs':lines(DEFAULT_THRESHOLDS.netLines)}),durations:null});
 assert.deepEqual(exact.warnings,[],'the threshold itself is not exceeded');
});

test('slow tests are ranked, and only a new test over the limit in a changed file is warned',()=>{
 const base=files({'test/test_old.mjs':"test('old slow',()=>{});\n",'test/test_edit.mjs':"test('kept',()=>{});\n"});
 const head=files({'test/test_old.mjs':"test('old slow',()=>{});\n",'test/test_edit.mjs':"test('kept',()=>{});\ntest('added slow',()=>{});\n",'test/test_new.mjs':"test('fresh fast',()=>{});\n"});
 const durations=[
  {file:'test/test_old.mjs',name:'old slow',seconds:30},
  {file:'test/test_edit.mjs',name:'kept',seconds:12},
  {file:'test/test_edit.mjs',name:'added slow',seconds:11},
  {file:'test/test_new.mjs',name:'fresh fast',seconds:0.2},
 ];
 const report=buildReport({base,head,durations,thresholds:{...DEFAULT_THRESHOLDS,topSlow:2}});
 assert.deepEqual(report.slowest.map(e=>e.name),['old slow','kept']);
 assert.deepEqual(report.slowNew.map(e=>e.name),['added slow']);
 assert.deepEqual(report.warnings.map(w=>[w.title,w.file]),[['時間のかかる新しいテスト','test/test_edit.mjs']]);
 const summary=renderSummary(report);
 assert.match(summary,/\| 30\.0 \| test\/test_old\.mjs \| old slow \|/);assert.match(summary,/10 秒を超えた新しいテスト/);
 assert.match(renderSummary(buildReport({base,head,durations:null})),/テストの時間の記録がないため/);
});

test('parseJunit keeps top-level tests only, takes a parent file from its subtests, keeps names with > and makes paths relative',()=>{
 const xml=`<?xml version="1.0" encoding="utf-8"?>
<testsuites>
\t<testcase name="a &quot;b&quot; &amp; c" time="1.500000" classname="test" file="/repo/test/test_a.mjs"/>
\t<testsuite name="parent &gt; &quot;q&quot; > x" time="4.000000" disabled="0" tests="1">
\t\t<testcase name="child > leaf" time="3.900000" classname="parent > x" file="/repo/test/test_b.mjs"/>
\t</testsuite>
\t<testcase name="skipped" time="0.000100" classname="test" file="/repo/test/test_a.mjs">
\t\t<skipped type="skipped" message="no"/>
\t</testcase>
</testsuites>`;
 assert.deepEqual(parseJunit(xml,'/repo'),[
  {name:'a "b" & c',file:'test/test_a.mjs',seconds:1.5},
  {name:'parent > "q" > x',file:'test/test_b.mjs',seconds:4},
  {name:'skipped',file:'test/test_a.mjs',seconds:0.0001},
 ]);
});

test('annotations are GitHub warning commands with escaped properties and data',()=>{
 assert.equal(renderAnnotations([{title:'a: b, c',file:'test/x,y.mjs',message:'50% done\nnext'}]),'::warning file=test/x%2Cy.mjs,title=a%3A b%2C c::50%25 done%0Anext\n');
 assert.equal(renderAnnotations([]),'');
});

test('run reads both trees, appends the summary and still returns 0 when thresholds are exceeded or inputs are missing',t=>{
 const root=tempDir('asc-test-growth-');t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const write=(file,text)=>{fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,text);};
 write(path.join(root,'base/test/test_a.mjs'),"test('a',()=>{});\n");
 write(path.join(root,'head/test/test_a.mjs'),"test('a',()=>{});\n"+lines(DEFAULT_THRESHOLDS.netLines+1));
 write(path.join(root,'head/test/fixtures/ignored.mjs'),lines(1000));
 write(path.join(root,'tests.xml'),`<testsuites><testcase name="a" time="2" file="${path.join(root,'head/test/test_a.mjs')}"/></testsuites>`);
 assert.deepEqual([...readTestTree(path.join(root,'head')).keys()],['test/test_a.mjs']);
 const summary=path.join(root,'summary.md');fs.writeFileSync(summary,'previous\n');
 const out=sink();
 assert.equal(run([`--base=${path.join(root,'base')}`,`--head=${path.join(root,'head')}`,`--junit=${path.join(root,'tests.xml')}`],{GITHUB_STEP_SUMMARY:summary},out),0);
 const written=fs.readFileSync(summary,'utf8');assert(written.startsWith('previous\n## テストの増え方'));assert.match(written,/\| 2\.0 \| test\/test_a\.mjs \| a \|/);
 assert.match(out.text,/^::warning title=テストの行数が増えています::/m);
 const missing=sink();
 assert.equal(run([`--base=${path.join(root,'absent')}`,`--head=${path.join(root,'head')}`,`--junit=${path.join(root,'absent.xml')}`],{},missing),0);
 assert.match(missing.text,/テストの時間の記録がないため/);assert.match(missing.text,/^::warning title=テストの増え方を比較できませんでした::/m);assert.doesNotMatch(missing.text,/テストの行数が増えています/);
 assert.equal(readTestTree(path.join(root,'absent')),null);
 const broken=sink();assert.equal(run(['--unknown'],{},broken),0);
 const noHead=sink();assert.equal(run([`--base=${path.join(root,'base')}`,`--head=${path.join(root,'absent')}`],{},noHead),0);assert.match(noHead.text,/head の test\/ を読めません/);assert.match(broken.text,/^::warning title=テストの増え方を報告できませんでした::/m);
});

test('a missing base is reported as not comparable, without growth or new-test warnings',()=>{
 const head=files({'test/test_a.mjs':lines(DEFAULT_THRESHOLDS.netLines*10)+"test('slow',()=>{});\n"});
 const report=buildReport({base:null,head,durations:[{file:'test/test_a.mjs',name:'slow',seconds:60}]});
 assert.equal(report.comparable,false);assert.equal(report.delta,null);assert.deepEqual(report.slowNew,[]);
 assert.deepEqual(report.warnings.map(w=>w.title),['テストの増え方を比較できませんでした']);
 const summary=renderSummary(report);assert.match(summary,/base の test\/ を読めなかったため/);assert.match(summary,/\| テストの行数 \| - \| 1201 \| - \|/);assert.match(summary,/\| 60\.0 \| test\/test_a\.mjs \| slow \|/);
});

test('the CLI process exits 0 even when it warns',t=>{
 const root=tempDir('asc-test-growth-cli-');t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 fs.mkdirSync(path.join(root,'head/test'),{recursive:true});fs.writeFileSync(path.join(root,'head/test/test_a.mjs'),lines(DEFAULT_THRESHOLDS.netLines+1));
 const result=spawnSync(process.execPath,[script,`--base=${path.join(root,'base')}`,`--head=${path.join(root,'head')}`,`--summary=${path.join(root,'summary.md')}`],{encoding:'utf8'});
 assert.equal(result.status,0,result.stderr);assert.match(result.stdout,/^::warning /m);
 const failed=spawnSync(process.execPath,[script],{encoding:'utf8'});
 assert.equal(failed.status,0,failed.stderr);assert.match(failed.stdout,/--base=<dir>/);
});
