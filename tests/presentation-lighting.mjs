import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {resolve} from 'node:path';
import {createAppFixture} from './app-fixture.mjs';

const root=resolve(import.meta.dirname,'..'),{sandbox,get}=createAppFixture(root),run=s=>vm.runInContext(s,sandbox);
const dot=(a,b)=>a.reduce((sum,x,i)=>sum+x*b[i],0),unit=v=>{const length=Math.hypot(...v);return v.map(x=>x/length);};
// Independent studio reference retains the previous key/fill, with accents
// facing the left, rear, right and underside of the model.
const lights=[[[ -.5,-.7,1.4],1],[[.8,.3,.6],.3],[[-1,.25,.4],.65],[[.15,1,.35],.65],[[1,-.4,.3],.5],[[-.2,.35,-1],.35]].map(([d,w])=>[unit(d),w]);
function reference(normal,view,shininess,list=lights){
 const s=shininess/100,power=8+120*s*s;
 return .8*s*list.reduce((sum,[direction,strength])=>{const half=direction.map((x,i)=>x+view[i]),lengthSquared=dot(half,half);return lengthSquared<1e-6?sum:sum+strength*Math.max(0,dot(normal,unit(half)))**power*Math.max(0,dot(normal,direction));},0);
}
const cases=[];
for(const [i,normal] of [[2,[-1,0,0]],[3,[0,1,0]],[4,[1,0,0]],[5,[0,0,-1]]]){
 const light=lights[i][0],view=light.map((x,j)=>2*dot(normal,light)*normal[j]-x);
 const legacy=reference(normal,view,100,lights.slice(0,2)),enhanced=reference(normal,view,100);
 assert.ok(enhanced>legacy+.1,`No additional glint for normal ${normal}`);
 for(const shininess of [0,35,100])for(const offset of [0,.3]){
  const direction=unit(view.map((x,j)=>x+(j===0?offset:0)));
  sandbox.lightingCase={normal,view:direction,shininess};
  const expected=reference(normal,direction,shininess),actual=run('sceneSpecularHighlight(lightingCase.normal,lightingCase.view,lightingCase.shininess)');
  assert.ok(Math.abs(actual-expected)<1e-10,`${normal}, ${shininess}: ${actual} vs ${expected}`);
  cases.push({normal,view:direction,shininess,expected});
 }
}
// Opposite half vectors must remain finite; zero gloss never lights a matte
// surface. More lighting directions must not become a second model/history.
for(const [light] of lights){sandbox.lightingCase={normal:light,view:light.map(x=>-x),shininess:100};assert.ok(Number.isFinite(run('sceneSpecularHighlight(lightingCase.normal,lightingCase.view,lightingCase.shininess)')));}
run("clearSelection(false);undoStack=[];redoStack=[];const lightingBefore=snapshot(),lightingSolid=objects[0].solid,lightingMesh=sceneGeometry.mesh(objects[0]),lightingBvh=sceneGeometry.bvh(objects[0]);assignObjectShininess(objects[0],100);const lightingGlossState=snapshot();");
get('viewStyle').value='presentation';run('ensureScene();camera.yaw+=.3;cameraBasis();ensureScene()');
assert.equal(run('snapshot()'),run('lightingGlossState'));assert.equal(run('objects[0].solid===lightingSolid&&sceneGeometry.mesh(objects[0])===lightingMesh&&sceneGeometry.bvh(objects[0])===lightingBvh'),true);assert.equal(run('undoStack.length'),0);
for(const style of ['modeling','illustration']){
 sandbox.lightingStyle=style;
 assert.equal(run("JSON.stringify(sceneLitColor([.2,.3,.4],[1,0,0],lightingStyle,undefined,[1,0,0],0))"),run("JSON.stringify(sceneLitColor([.2,.3,.4],[1,0,0],lightingStyle,undefined,[1,0,0],100))"));
}
const folder=resolve(root,'docs/verification/v159');fs.mkdirSync(folder,{recursive:true});
fs.writeFileSync(resolve(folder,'lighting-cases.json'),JSON.stringify({cases,method:'Independent CPU angular cases for actual application fragment-shader driver; not browser latency.'},null,2)+'\n');
console.log(`R260 Presentation lighting passed: ${cases.length} independent angular/gloss cases, new side/rear/underside glints, finite opposite half vectors, matte/style isolation and unchanged canonical/history/cache state.`);
