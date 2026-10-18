import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import {resolve,join} from 'node:path';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {createAppFixture} from './app-fixture.mjs';
import {createSourceZip,buildSourcePackage} from '../scripts/source-package.mjs';

const root=resolve(import.meta.dirname,'..'),packageInfo=JSON.parse(fs.readFileSync(join(root,'package.json'),'utf8')),html=fs.readFileSync(join(root,'dist/LamjaCraft-3D.html'),'utf8');
const match=/<script id="embeddedSourceProject" type="application\/octet-stream" data-filename="([^"]+)" data-byte-length="(\d+)" data-sha256="([a-f0-9]{64})">([A-Za-z0-9+/=]+)<\/script>/.exec(html);
assert.ok(match,'A complete inert source archive must be embedded in standalone HTML');
const [,fileName,byteCount,hash,base64]=match,zip=Buffer.from(base64,'base64');
assert.equal(fileName,`LamjaCraft-3D-v${packageInfo.version}-source.zip`);
assert.equal(zip.length,Number(byteCount));assert.equal(createHash('sha256').update(zip).digest('hex'),hash);
assert.deepEqual(zip,fs.readFileSync(join(root,'dist',fileName)));
assert.equal(html,fs.readFileSync(join(root,'dist/index.html'),'utf8'));
assert.ok(!/__LAMJACRAFT_[A-Z_]+__/.test(html),'No unresolved marker can reach the user');
const unescape=s=>s.replaceAll('&quot;','"').replaceAll('&gt;','>').replaceAll('&lt;','<').replaceAll('&amp;','&');
for(const [id,path] of [['aboutMitLicense','LICENSE'],['aboutFontLicense','src/assets/DejaVuSans-LICENSE.txt']]){
 const rendered=new RegExp(`<pre id="${id}" class="about-license-text">([\\s\\S]*?)<\\/pre>`).exec(html);
 assert.ok(rendered,id);assert.equal(unescape(rendered[1]),fs.readFileSync(join(root,path),'utf8'),id+' must preserve the full notice');
}
assert.equal(packageInfo.license,'MIT');assert.ok(html.includes('Copyright © 2026 Arvid Mortensen'));
assert.ok(html.includes('id="downloadSourceProject"'));assert.ok(html.includes('Tests and example models are excluded.'));

// The actual click decodes only on request, returns the exact bytes and leaves
// the model, unsaved state, history, tool and existing About dialog untouched.
let decodes=0,clickedFile=null;
const {sandbox,get,downloads}=createAppFixture(root,undefined,{atob(value){decodes++;return Buffer.from(value,'base64').toString('binary');}}),run=code=>vm.runInContext(code,sandbox);
assert.equal(decodes,0,'Source must not be inflated/decoded during application startup');
get('embeddedSourceProject').textContent=base64;get('embeddedSourceProject').setAttribute('data-filename',fileName);get('embeddedSourceProject').setAttribute('data-byte-length',byteCount);
const originalCreate=sandbox.document.createElement;sandbox.document.createElement=()=>{const element=originalCreate();element.click=()=>{clickedFile=element.download;};return element;};
get('aboutBtn').onclick();assert.equal(get('aboutDialog').open,true);
const before=run('snapshot()'),history=run('undoStack.length'),dirty=run('dirty'),tool=run('tool');
get('downloadSourceProject').onclick();assert.equal(decodes,1);assert.equal(downloads.length,1);assert.equal(downloads[0].type,'application/zip');assert.equal(clickedFile,fileName);
assert.deepEqual(Buffer.from(await downloads[0].arrayBuffer()),zip);assert.equal(run('snapshot()'),before);assert.equal(run('undoStack.length'),history);assert.equal(run('dirty'),dirty);assert.equal(run('tool'),tool);assert.equal(get('aboutDialog').open,true);
get('embeddedSourceProject').textContent='';get('downloadSourceProject').onclick();assert.equal(downloads.length,1);assert.equal(run('snapshot()'),before);assert.match(get('toast').textContent,/metadata is invalid/);
get('embeddedSourceProject').textContent=base64;get('embeddedSourceProject').setAttribute('data-byte-length',String(zip.length+1));get('downloadSourceProject').onclick();assert.equal(downloads.length,1);assert.match(get('toast').textContent,/incomplete/);

// Independent ZIP reader checks CRCs, UTF-8 names, omissions and required build
// inputs, then extracts the archive into a fresh directory with no outputs.
// Keep extracted build checks inside the writable project workspace.
const temporary=fs.mkdtempSync(join(root,'build/lamjacraft-source-check-'));
try{
 const zipPath=join(temporary,'source.zip');fs.writeFileSync(zipPath,zip);
 const inspection=JSON.parse(execFileSync('python3',['-c',`
import json,zipfile,sys
from pathlib import Path
z=zipfile.ZipFile(sys.argv[1]);assert z.testzip() is None
names=z.namelist();prefix=names[0].split('/')[0]+'/'
assert len(names)==len(set(names))
for name in names:
 rel=name[len(prefix):];parts=Path(rel).parts
 assert not any(x in ('tests','fixtures','examples','verification','node_modules','dist','build') for x in parts),name
 assert rel!='src/assets/lamjacraft-logo-original.png'
 assert '..' not in parts
pkg=json.loads(z.read(prefix+'package.json'))
assert set(pkg['scripts'])=={'build','typecheck'}
assert pkg['license']=='MIT'
lock=json.loads(z.read(prefix+'package-lock.json'))
assert lock['version']==pkg['version']==lock['packages']['']['version']
for config in ['tsconfig.json','tsconfig.edge-feature-worker.json','tsconfig.native-open-worker.json']:
 for f in json.loads(z.read(prefix+config))['files']:assert prefix+f in names,f
for f in ['AGENTS.md','LICENSE','THIRD_PARTY_NOTICES.md','RULES.md','README.md','SOURCE-README.md','scripts/build.mjs','scripts/source-package.mjs','scripts/format-docs.mjs','docs/NATIVE_FILE_FORMAT.md','docs/PERFORMANCE.md','src/assets/native-format-sample.json','src/template.html','src/assets/lamjacraft-logo.png','src/assets/DejaVuSans-LICENSE.txt','public/sitemap.xml']:assert prefix+f in names,f
for f in ['AGENTS.md','RULES.md','docs/PERFORMANCE.md']:
 assert z.read(prefix+f)==Path(f).read_bytes(),f+' must match current maintenance instructions'
assert b'Copyright (c) 2026 Arvid Mortensen' in z.read(prefix+'LICENSE')
z.extractall(sys.argv[2])
print(json.dumps({'directory':str(Path(sys.argv[2])/prefix),'files':len(names)}))
`,zipPath,temporary],{encoding:'utf8'}));
 // Reuse the already installed locked compiler through PATH; the source ZIP
 // itself contains no dependencies and needs no network during this check.
 execFileSync(process.execPath,['scripts/build.mjs'],{cwd:inspection.directory,env:{...process.env,PATH:join(root,'node_modules/.bin')+':'+process.env.PATH},encoding:'utf8',maxBuffer:1024*1024});
 assert.deepEqual(fs.readFileSync(join(inspection.directory,'dist/LamjaCraft-3D.html')),Buffer.from(html),'The downloaded source must rebuild the exact shipped HTML');
 assert.deepEqual(fs.readFileSync(join(inspection.directory,'dist',fileName)),zip,'Rebuilding must not embed previous output or change the source ZIP');
 // Version drift must stop the build before producing replacement HTML.
 const lockPath=join(inspection.directory,'package-lock.json'),originalLock=fs.readFileSync(lockPath,'utf8'),badLock=JSON.parse(originalLock);badLock.version='0.0.0';fs.writeFileSync(lockPath,JSON.stringify(badLock));
 assert.throws(()=>execFileSync(process.execPath,['scripts/build.mjs'],{cwd:inspection.directory,env:{...process.env,PATH:join(root,'node_modules/.bin')+':'+process.env.PATH},stdio:'pipe'}),/versions must match/);
 assert.deepEqual(fs.readFileSync(join(inspection.directory,'dist/LamjaCraft-3D.html')),Buffer.from(html),'A rejected build must preserve the last valid HTML');
 fs.writeFileSync(lockPath,originalLock);
 const rebuilt=await buildSourcePackage(root,packageInfo);assert.deepEqual(rebuilt.bytes,zip,'Repeated source packaging is deterministic');
 // A changed source byte must change the archive; stale ZIPs cannot satisfy
 // the source contract even when release version and file layout are equal.
 const small=createSourceZip([{name:'source/file.txt',bytes:Buffer.from('current')}]),changed=createSourceZip([{name:'source/file.txt',bytes:Buffer.from('changed')}]);assert.notDeepEqual(small,changed);
 assert.throws(()=>createSourceZip([{name:'../bad',bytes:Buffer.from('bad')}]),/unsafe/);
 assert.throws(()=>createSourceZip([{name:'same',bytes:Buffer.from('a')},{name:'same',bytes:Buffer.from('b')}]),/duplicate/);
 console.log(`Embedded source passed: v${packageInfo.version}, ${inspection.files} files/${zip.length} ZIP bytes, exact About Blob download, full MIT/font notices, read-only history, exclusions, independent CRC validation and byte-identical clean source rebuild.`);
}finally{fs.rmSync(temporary,{recursive:true,force:true});}
