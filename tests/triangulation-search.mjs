import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import {resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {createAppFixture} from './app-fixture.mjs';
const root=resolve(import.meta.dirname,'..'),{sandbox}=createAppFixture(root,undefined,{Map,Set,Math}),run=code=>vm.runInContext(code,sandbox),hash=v=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
run(fs.readFileSync(resolve(root,'tests/fixtures/triangulation-bridged-reference.js'),'utf8'));
run(`function legacyTriangulation(outer,holes,cross=1e-12){try{return legacyTriangulateBridgedPolygonWithHoles2(outer,holes,cross);}catch(error){if(!holes.length||!errorMessage(error).startsWith('Could not triangulate the face'))throw error;return triangulatePlanarMaterial2(outer,holes,cross);}}`);
let cases=0;
function compare(outer,holes,label,cross=1e-12){sandbox.trInput={outer,holes,cross};let old,current,oldError,currentError;
 try{old=run('legacyTriangulation(trInput.outer,trInput.holes,trInput.cross)');}catch(e){oldError=e.message;}
 try{current=run('triangulatePolygonWithHoles2(trInput.outer,trInput.holes,trInput.cross)');}catch(e){currentError=e.message;}
 assert.equal(currentError,oldError,label+' error semantics');if(!oldError)assert.equal(hash(current),hash(old),label+' exact points/triangle order');cases++;
}
const circle=(x,y,r,n,reverse=false)=>Array.from({length:n},(_,i)=>{const t=(reverse?-1:1)*i*2*Math.PI/n;return [x+r*Math.cos(t),y+r*Math.sin(t)];});
for(const n of [3,4,31,63,127,128,129,256])for(const reversed of [false,true])compare(circle(0,0,10,n,reversed),[],'simple '+n+'/'+reversed);
const outer=[[-20,-20],[20,-20],[20,20],[-20,20]],holes=Array.from({length:64},(_,i)=>circle(-14+(i%8)*4,-14+Math.floor(i/8)*4,.8,8,true));
for(const scale of [1e-4,1,100])for(const offset of [0,1e8,-1e8])for(const reverse of [false,true]){
 const transform=ring=>ring.map(([x,y])=>[x*scale+offset,y*scale-offset]);
 compare(transform(reverse?[...outer].reverse():outer),holes.slice(0,scale===1?64:17).map(h=>transform(reverse?[...h].reverse():h)),`holes scale=${scale} offset=${offset} reverse=${reverse}`);
}
for(const cross of [1e-12,1e-5]){
 compare(outer,holes,'dense holes '+cross,cross);
 compare([[-20,-20],[20,-20],[20,20],[0,20],[0,5],[-20,5]],holes.filter(h=>h.every(p=>p[0]>0||p[1]<4)),'concave '+cross,cross);
 compare(outer,holes.map((h,i)=>h.map(([x,y])=>[x+(i%3)*1e-8,y-(i%5)*1e-8])),'perturbed holes '+cross,cross);
}
compare([[0,0],[1,0],[2,0],[2,2],[0,2]],[],'collinear');compare([[0,0],[0,0],[2,0],[2,2],[0,2]],[],'duplicate');
compare(outer,[[[30,30],[31,30],[31,31],[30,31]]],'invalid remote hole');
// Deterministic varied concavity, winding, rotation, scale and translation.
let seed=2471;const random=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;};
for(let i=0;i<40;i++){
 const n=129+i,angle=random()*Math.PI*2,scale=10**(-3+4*random()),tx=(random()-.5)*1e4,ty=(random()-.5)*1e4;
 const transform=([x,y])=>[tx+scale*(x*Math.cos(angle)-y*Math.sin(angle)),ty+scale*(x*Math.sin(angle)+y*Math.cos(angle))];
 const ring=Array.from({length:n},(_,j)=>{const r=j%2?18:20,t=j*2*Math.PI/n;return transform([r*Math.cos(t),r*Math.sin(t)]);});
 const inner=Array.from({length:i%9},(_,j)=>circle(8*Math.cos(j*2*Math.PI/8),8*Math.sin(j*2*Math.PI/8),.5,8+(i%8),true).map(transform));
 compare(i%2?[...ring].reverse():ring,inner,'seeded concave '+i,i%3?1e-12:1e-5);
}
// Prove conservative point queries against the original fuzzy half-plane test.
run(`let trSeed=107;function trRandom(){trSeed=(Math.imul(trSeed,1664525)+1013904223)>>>0;return trSeed/4294967296;}
let trComparisons=0,trIndexed=0,trLinear=0;
for(const magnitude of [1e-4,1,1e8,1e155]){
 const points=Array.from({length:500},()=>[(trRandom()-.5)*magnitude,(trRandom()-.5)*magnitude]);
 for(let i=0;i<60;i++){
  const a=points[i],b=points[(i+17)%points.length],c=points[(i+53)%points.length];if(v2.cross(a,b,c)<0){const x=b[0],y=b[1];b[0]=c[0];b[1]=c[1];c[0]=x;c[1]=y;}
  const extra=[...points,[Math.min(a[0],b[0],c[0])-1e-12,Math.min(a[1],b[1],c[1])]],nodes=extra.map((point,index)=>({index,point,active:true})),query=createTriangulationPointQuery(nodes),subset=query?.(a,b,c);
  if(subset)trIndexed++;else trLinear++;
  for(const node of nodes){trComparisons++;const q=node.point,inside=v2.cross(a,b,q)>=-1e-12&&v2.cross(b,c,q)>=-1e-12&&v2.cross(c,a,q)>=-1e-12;if(inside&&subset&&!subset.includes(node))throw Error('Conservative triangle point query omitted an accepted point');}
 }
}`);
run(`for(const height of [1,1e-10,2e-12]){const a=[0,0],b=[1,0],c=[0,height],points=[a,b,c,[-.5e-12,.5*height],[.5,-.5e-12],[1.1,-.1*height],...Array.from({length:150},(_,i)=>[i/150,.25*height])],nodes=points.map((point,index)=>({point,index,active:true})),query=createTriangulationPointQuery(nodes),subset=query?.(a,b,c);for(const node of nodes){const q=node.point,accepted=v2.cross(a,b,q)>=-1e-12&&v2.cross(b,c,q)>=-1e-12&&v2.cross(c,a,q)>=-1e-12;if(accepted&&subset&&!subset.includes(node))throw Error('Fuzzy boundary fringe omitted');}}`);
assert.ok(run('trIndexed')>0);assert.ok(run('trLinear')>0);assert.ok(run('trComparisons')>100000);
// Deterministic operation-count reduction, independent of wall-clock timing.
sandbox.trInput={outer,holes,cross:1e-12};run('const trSavedCross=v2.cross;let trCrosses=0;v2.cross=(...args)=>{trCrosses++;return trSavedCross(...args)};legacyTriangulation(trInput.outer,trInput.holes);const trOldCrosses=trCrosses;trCrosses=0;triangulatePolygonWithHoles2(trInput.outer,trInput.holes);const trNewCrosses=trCrosses;v2.cross=trSavedCross');assert.ok(run('trNewCrosses<trOldCrosses/2'));
// A genuine holed solid stays editable through the application command/history boundary.
sandbox.trOuter=outer;sandbox.trHoles=holes;
run(`function trPrism(){const loops=[trOuter,...trHoles],vertices=[],faces=[],ids=loops.map((loop,r)=>loop.map((p,i)=>r+'_'+i));for(let z=0;z<2;z++)for(let r=0;r<loops.length;r++)for(let i=0;i<loops[r].length;i++)vertices.push({id:ids[r][i]+'_'+z,position:[...loops[r][i],z*10]});const ring=(r,z)=>ids[r].map(id=>id+'_'+z);faces.push({id:'top',outer:ring(0,1),holes:trHoles.map((_,i)=>ring(i+1,1))},{id:'bottom',outer:ring(0,0).reverse(),holes:trHoles.map((_,i)=>ring(i+1,0).reverse())});for(let r=0;r<loops.length;r++)for(let i=0;i<loops[r].length;i++){const j=(i+1)%loops[r].length;faces.push({id:'side_'+r+'_'+i,outer:[ids[r][i]+'_0',ids[r][j]+'_0',ids[r][j]+'_1',ids[r][i]+'_1'],holes:[]});}return deserializeProjectSolid({schema:'poly-brep-1',id:'triangulation-edit',vertices,faces,metadata:{}});}
cancelGesture();replaceGroups([]);replaceObjects([]);clearSelection(false);const trObject=makeObject();trObject.solid=trPrism();replaceObjects([trObject]);setSelection({kind:'face',objectId:trObject.id,faceId:'top'},false);undoStack=[];redoStack=[];const trBefore=JSON.stringify(captureDocumentState()),trArea=Math.abs(v2.area(trOuter))-trHoles.reduce((n,h)=>n+Math.abs(v2.area(h)),0);applyFaceMove(trObject,'top',.75);const trAfter=JSON.stringify(captureDocumentState()),trCheck=geometryApi.validate(trObject.solid,false);if(!trCheck.ok||Math.abs(trCheck.volume-trArea*10.75)>1e-6)throw Error('Indexed triangulation changed edited material volume');undo();if(JSON.stringify(captureDocumentState())!==trBefore)throw Error('Triangulation edit Undo mismatch');redo();if(JSON.stringify(captureDocumentState())!==trAfter)throw Error('Triangulation edit Redo mismatch');`);
console.log(`R258 triangulation search passed: ${cases} exact reference cases, ${run('trComparisons')} conservative point comparisons, indexed/uncertain paths, reduced exact orientation work, and a 64-hole edited solid with independent volume and exact Undo/Redo.`);
