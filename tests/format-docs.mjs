import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import {resolve} from 'node:path';
import {createAppFixture} from './app-fixture.mjs';
import {renderFormatReference} from '../scripts/format-docs.mjs';

const root=resolve(import.meta.dirname,'..'),read=path=>fs.readFileSync(resolve(root,path),'utf8');
const markdown=read('docs/NATIVE_FILE_FORMAT.md'),sampleText=read('src/assets/native-format-sample.json'),sample=JSON.parse(sampleText),html=read('dist/LamjaCraft-3D.html');
const about=/<dialog id="aboutDialog"[^>]*>([\s\S]*?)<\/dialog>/.exec(html)[1];
assert.equal(/<article id="aboutFileFormatReference" class="format-reference">([\s\S]*?)<\/article>/.exec(about)[1],renderFormatReference(markdown));
const markers=['class="about-credit"','id="aboutDescription"','id="aboutFileFormatTitle"','id="aboutSourceTitle"','id="aboutLicensesTitle"','id="aboutMitLicense"','id="aboutFontLicense"'];
const positions=markers.map(marker=>{const position=about.indexOf(marker);assert.ok(position>=0,marker);return position;});
assert.deepEqual(positions,[...positions].sort((a,b)=>a-b),'About must show credits, description, format, source and licenses in order');
assert.ok(!/\bAI\b|downloadFileFormat|aboutFileFormatAi|aboutFileFormatMarkdown/.test(about),'One neutral file specification without format downloads');
assert.ok(about.includes('id="downloadSourceProject"'),'Keep the matching source download');
assert.ok(renderFormatReference(markdown).includes('<ul><li><code>string</code>'));
assert.ok(renderFormatReference(markdown).includes('<code>array&lt;T&gt;</code>'));
const examples=[...markdown.matchAll(/```json\n([\s\S]*?)\n```/g)];
assert.equal(examples.length,1,'One small complete example at the end');
assert.deepEqual(JSON.parse(examples[0][1]),sample,'The displayed cube matches the canonical sample');
assert.ok(markdown.trim().endsWith('```'));
assert.ok(html.includes('<th scope="col">'));assert.ok(html.includes('<ol>'));
assert.ok(!renderFormatReference('## Example\n\n<script>alert(1)</script>\n\n```json\n</code><img src=x onerror=alert(1)>\n```').includes('<script>'));
assert.throws(()=>renderFormatReference('```json\n{}'),/Unclosed/);

const {sandbox,get,downloads}=createAppFixture(root),run=code=>vm.runInContext(code,sandbox);
sandbox.nativeSample=sample;
run('validateProjectReferenceCoordinates(validateProject(nativeSample))');
assert.equal(run('validateProject(nativeSample).objects.length'),1);
assert.equal(run('geometryApi.checkObject(validateProject(nativeSample).objects[0].solid).status'),'passed');
assert.equal(run('dimensionValue({id:"d",kind:"linear",a:{kind:"world",point:[0,0,0]},b:{kind:"world",point:[10,0,0]}})'),10);
assert.ok(run('V.len(V.sub(transformPoint([1,0,0],{position:[3,4,5],rotation:[0,0,90]}),[3,5,5]))<1e-12'),'Reference degrees/order/translation convention');
assert.ok(run('V.len(V.sub(transformPoint([1,2,3],{position:[3,4,5],rotation:[90,90,90]}),[6,6,4]))<1e-12'),'X then Y then Z about local origin');
run('loadProject(nativeSample);globalThis.roundTrip=projectData();validateProjectReferenceCoordinates(validateProject(roundTrip));');
assert.equal(run('roundTrip.version'),7);assert.equal(run('roundTrip.objects[0].solid.vertices.length'),8);assert.equal(run('roundTrip.objects[0].solid.faces.length'),6);
assert.deepEqual(JSON.parse(run('JSON.stringify(roundTrip.objects[0].transform)')),sample.objects[0].transform);

// Exercise the documented optional guide/group/dimension/plate fields through
// the real reader, retaining reference and format-8 round-trip coverage.
const rich=structuredClone(sample),second=structuredClone(sample.objects[0]);second.id='o2';second.solid.id='s_o2';second.transform.position=[20,0,0];rich.objects.push(second);
rich.version=8;rich.groups=[{id:'grp1',name:'Assembly',objectIds:['o1','o2']}];
rich.construction.guides=[
 {id:'g1',kind:'point',point:[0,0,0]},
 {id:'g2',kind:'line',point:[0,0,0],direction:[1,0,0],planeNormal:[0,0,1]},
 {id:'g3',kind:'circle',center:[0,0,0],normal:[0,0,1],radius:10},
 {id:'g4',kind:'plane',origin:[0,0,0],normal:[0,0,1],axis:[1,0,0]},
 {id:'g5',kind:'plane',origin:[0,0,0],normal:[0,0,1],axis:[1,0,0],surface:{width:20,height:20,columns:2,rows:2,heights:[0,0,0,5]}}
];
rich.annotations.dimensions=[{id:'d1',kind:'linear',label:'Width',a:{kind:'vertex',objectId:'o1',vertexId:'v1',fallback:[0,0,0]},b:{kind:'world',point:[10,0,0]}}];
rich.references={buildPlates:[{id:'bp1',name:'Printer bed',width:220,depth:220,x:0,y:0,color:'#6d93bd',opacity:.35,visible:true}]};
sandbox.rich=rich;
run('validateProjectReferenceCoordinates(validateProject(rich));loadProject(rich);globalThis.richRoundTrip=projectData();validateProjectReferenceCoordinates(validateProject(richRoundTrip));');
assert.equal(run('richRoundTrip.version'),8);
for(const key of ['groups','construction','annotations','references'])assert.deepEqual(JSON.parse(run(`JSON.stringify(richRoundTrip.${key})`)),rich[key]);
const wrongVersion=structuredClone(rich);wrongVersion.version=7;sandbox.wrongVersion=wrongVersion;assert.throws(()=>run('validateProject(wrongVersion)'),/format 8/);
// Match published implementation ceilings so a policy change requires docs review.
assert.equal(run('PROJECT_READ_POLICY.maximumFileBytes'),512*1024*1024);
assert.equal(run('PROJECT_READ_POLICY.maximumVerticesPerObject'),1000000);assert.equal(run('PROJECT_READ_POLICY.maximumFacesPerObject'),1000000);assert.equal(run('PROJECT_READ_POLICY.maximumBoundarySegmentsPerObject'),8000000);
assert.equal(run('PROJECT_CAPACITY_POLICY.maximumObjects'),1000);assert.equal(run('BUILD_PLATE_POLICY.maximumPlates'),128);

// Opening and closing the presentation-only About dialog cannot affect the model.
const before=run('snapshot()'),history=run('undoStack.length'),dirty=run('dirty'),tool=run('tool');
get('aboutBtn').onclick();assert.equal(get('aboutDialog').open,true);
assert.equal(downloads.length,0);assert.equal(run('snapshot()'),before);assert.equal(run('undoStack.length'),history);assert.equal(run('dirty'),dirty);assert.equal(run('tool'),tool);
get('aboutDialog').close();assert.equal(run('snapshot()'),before);
console.log('Native format documentation passed: requested About section order, one neutral typed reference without format-download UI, compact complete example, valid cube/reference round-trips, published budgets, safe formatted content and read-only About behavior.');
