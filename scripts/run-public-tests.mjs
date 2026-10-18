// Explicit public coverage. Private reproducer suites are not skipped inside
// tests: they are absent from this distribution and listed in its manifest.
import {readFileSync,writeFileSync,mkdirSync,existsSync} from 'node:fs';
import {resolve} from 'node:path';
import {spawnSync} from 'node:child_process';
const root=resolve(import.meta.dirname,'..');
const manifest=JSON.parse(readFileSync(resolve(root,'tests/public-suites.json'),'utf8'));
const scope=process.argv[2]||'quick';
if(!['quick','extended'].includes(scope))throw Error('Choose quick or extended public checks.');
const suites=manifest[scope];
if(!Array.isArray(suites)||!suites.length||new Set(suites).size!==suites.length)throw Error('Public test manifest must contain unique suites.');
for(const name of suites)if(!/^[a-z0-9-]+\.mjs$/.test(name)||!existsSync(resolve(root,'tests',name)))throw Error(`Unavailable public suite: ${name}`);
const results={applicationVersion:manifest.applicationVersion,scope,status:'running',suites:[]};
mkdirSync(resolve(root,'build'),{recursive:true});mkdirSync(resolve(root,'docs/verification'),{recursive:true});
const save=()=>writeFileSync(resolve(root,'build/public-test-results.json'),JSON.stringify(results,null,2)+'\n');
function execute(file){
 const child=spawnSync(process.execPath,[file],{cwd:root,stdio:'inherit'});
 if(child.error)throw child.error;
 return child.status??1;
}
let status=execute('scripts/build.mjs');
if(status){results.status='failed';results.failedStage='build';save();process.exit(status);}
for(const [index,name]of suites.entries()){
 console.log(`\n[${index+1}/${suites.length}] ${name}`);
 const start=performance.now();status=execute('tests/'+name);
 results.suites.push({file:name,status:status===0?'passed':'failed',durationMs:Math.round(performance.now()-start)});save();
 if(status){results.status='failed';save();process.exit(status);}
}
results.status='passed';save();
console.log(`\nPublic ${scope} checks passed: ${suites.length} complete suites. Private reproducer coverage is separate.`);
