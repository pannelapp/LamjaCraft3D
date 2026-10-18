// Self-contained MFC CArchive records for the 2017 layout. The real-file
// opt-in regression is separate so private user models are not redistributed.
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {resolve} from 'node:path';
import {createAppFixture} from './app-fixture.mjs';
const root=resolve(import.meta.dirname,'..');
class Writer{
  bytes=[];slot=40;classes=new Map();objects=new Map();
  byte(n){this.bytes.push(n&255);}
  word(n){this.byte(n);this.byte(n>>>8);}
  dword(n){for(let i=0;i<4;i++)this.byte(n/(2**(8*i)));}
  double(n){const b=Buffer.alloc(8);b.writeDoubleLE(n);this.raw(b);}
  raw(xs){for(const x of xs)this.byte(x);}
  str(s){this.raw([255,254,255]);const len=s.length;if(len<255)this.byte(len);else{this.byte(255);this.word(len);}
    for(const ch of s)this.word(ch.charCodeAt(0));}
  null(){this.word(0);}
  ref(name){const slot=this.objects.get(name);assert(slot,`missing ${name}`);this.word(slot);}
  obj(name,cls,schema,fn){
    let classSlot=this.classes.get(cls);
    if(classSlot===undefined){this.word(0xffff);this.word(schema);this.word(cls.length);this.raw(Buffer.from(cls,'ascii'));classSlot=this.slot++;this.classes.set(cls,classSlot);}
    else this.word(0x8000|classSlot);
    this.objects.set(name,this.slot++);fn();
  }
  pre(){this.null();this.byte(0);} // attributes and zero persistent-ID mask
  draw(layer='layer'){this.null();this.raw([0,1,1,0,0,0]);this.ref(layer);}
  layer(name,label){this.obj(name,'CLayer',2,()=>{this.pre();this.str(label);this.byte(0);this.word(0);this.byte(0);this.str('Layer_'+label);
    this.raw([0,1,200,180,160,255]);this.str('');this.dword(0);this.dword(0);this.double(0);this.byte(0);this.dword(0);});}
  vertex(k,point){this.obj(k,'CVertex',0,()=>{this.pre();for(const n of point)this.double(n);});}
  edge(k,a,b,coords,layer){this.obj(k,'CEdge',2,()=>{this.pre();this.draw(layer);
    for(const i of [a,b]){if(this.objects.has(`${layer}v${i}`))this.ref(`${layer}v${i}`);else this.vertex(`${layer}v${i}`,coords[i]);}
    this.null();});}
  face(k,ring,normal,edges,layer,texture=false){this.obj(k,'CFace',3,()=>{
    if(texture){this.obj(`${k}-attr`,'CAttributeContainer',0,()=>{this.pre();this.obj(`${k}-ftc`,'CFaceTextureCoords',4,()=>{
      this.pre();this.dword(0);for(let i=0;i<24;i++)this.double(i%4===0?1:0);this.dword(0);this.dword(0);this.dword(0);this.dword(0);
    });this.null();});this.byte(0);}else this.pre();
    this.draw(layer);for(const n of [...normal,0])this.double(n);this.dword(1);
    this.obj(`${k}-loop`,'CLoop',1,()=>{this.pre();this.raw([1,1]);
      for(let i=0;i<ring.length;i++){const a=ring[i],b=ring[(i+1)%ring.length],idx=edges.findIndex(([x,y])=>(x===a&&y===b)||(x===b&&y===a));assert(idx>=0);
        this.obj(`${k}-use${i}`,'CEdgeUse',1,()=>{this.pre();this.ref(`${layer}edge${idx}`);this.byte(edges[idx][0]===a?0:1);this.ref(`${k}-loop`);});
      }this.null();});this.null();
  });}
  cube(prefix,layer){
    const v=[[0,0,0],[1,0,0],[1,1,0],[0,1,0],[0,0,1],[1,0,1],[1,1,1],[0,1,1]];
    const edges=[[0,1],[1,2],[2,3],[3,0],[4,5],[5,6],[6,7],[7,4],[0,4],[1,5],[2,6],[3,7]];
    for(let i=0;i<edges.length;i++)this.edge(`${layer}edge${i}`,...edges[i],v,layer);
    const faces=[[[3,2,1,0],[0,0,-1]],[[4,5,6,7],[0,0,1]],[[0,1,5,4],[0,-1,0]],[[2,3,7,6],[0,1,0]],[[3,0,4,7],[-1,0,0]],[[1,2,6,5],[1,0,0]]];
    for(let i=0;i<faces.length;i++)this.face(`${prefix}face${i}`,...faces[i],edges,layer,i===0);
  }
  camera(k){this.obj(k,'CCamera',5,()=>{this.raw(new Uint8Array(137));this.word(1);this.str('');this.raw(new Uint8Array(33));});}
  definition(){this.obj('def','CComponentDefinition',10,()=>{
    this.pre();this.draw();this.raw([0,0,0]);this.dword(0);this.null();this.raw([0,0,0]);
    this.dword(1);this.layer('deflayer','DefLayer');this.ref('deflayer');this.dword(0);
    this.dword(18);this.cube('def','deflayer');this.dword(0);this.null();this.raw(new Uint8Array(16));
    this.str('Box');this.str('');this.str('');this.dword(0);this.raw(new Uint8Array(43));
    this.obj('thumb','CThumbnail',1,()=>{this.pre();this.camera('camera');this.null();});
  });}
  instance(name,x){this.obj(name,'CComponentInstance',5,()=>{
    this.pre();this.draw();this.ref('def');const m=[1,0,0,0,1,0,0,0,1,x,0,0,1];for(const a of m)this.double(a);
    this.str('Box');this.raw(new Uint8Array(16));
  });}
  dimension(){this.obj('dimension','CDimensionLinear',6,()=>{
    this.pre();this.draw();this.str('');
    this.obj('font','CSkFont',1,()=>{this.pre();this.str('Tahoma');this.byte(0);this.byte(0);this.dword(12);this.byte(0);this.double(10);});
    this.byte(0);this.dword(1);
    for(const index of [0,1]){
      this.dword(2);this.dword(4);this.double(0);this.double(0);this.double(0);
      this.ref(`layerv${index}`);this.null();this.dword(index===0?1:0);
      if(index===0)this.ref('layer');this.dword(0);
    }
    for(const n of [0,0,1,1,0,0])this.double(n);
    this.dword(1);this.double(1);this.double(0);this.dword(0);
  });}
  generate(withDefinitions,multiLayer,withDimension=false){
    this.str('SketchUp Model');this.str('{17.3.116}');this.raw(new Uint8Array(16));this.str('');this.dword(2);
    this.dword(multiLayer?2:1);this.layer('layer','Layer0');if(multiLayer)this.layer('extra','Layer1');this.ref(multiLayer?'extra':'layer');
    this.dword(withDefinitions?1:0);if(withDefinitions)this.definition();
    this.dword(withDefinitions?2:withDimension?19:18);if(withDefinitions){this.instance('instance0',0);this.instance('instance1',3);}else{this.cube('root','layer');if(withDimension)this.dimension();}
    this.dword(0);this.null();
    return Uint8Array.from(this.bytes).buffer;
  }
}
const {sandbox}=createAppFixture(root,undefined,{DecompressionStream,Response});
for(const [variant,defs,layers,dimension,expected] of [['root-only',false,false,false,1],['root-dimension',false,false,true,1],['components-and-layers',true,true,false,2]]){
  sandbox.legacy17=new Writer().generate(defs,layers,dimension);
  const result=await vm.runInContext(`prepareSKPImport(legacy17,'${variant}.skp')`,sandbox);
  assert.equal(result.items.length,expected,`${variant}: number of editable solids`);
  assert.equal(result.items.reduce((sum,item)=>sum+item.solid.faces.size,0),6*expected);
  assert.equal(vm.runInContext('objects.length',sandbox)>=0,true);
  sandbox.current17=result;
  const serialized=vm.runInContext('current17.items.map(x=>serializeProjectSolid(x.solid))',sandbox);
  const points=serialized.flatMap(s=>s.vertices.map(v=>v.position));
  const mins=points.reduce((m,p)=>m.map((x,i)=>Math.min(x,p[i])),[Infinity,Infinity,Infinity]);
  const maxs=points.reduce((m,p)=>m.map((x,i)=>Math.max(x,p[i])),[-Infinity,-Infinity,-Infinity]);
  assert.deepEqual(mins,[0,0,0]);assert.deepEqual(maxs,[defs?101.6:25.4,25.4,25.4]);
  assert.equal(vm.runInContext('current17.items.every(x=>validateSolid(x.solid,false).ok)',sandbox),true);
  const count=vm.runInContext('objects.length',sandbox);
  assert.equal(vm.runInContext('addImportedMeshItems(current17).length',sandbox),expected);
  assert.equal(vm.runInContext('objects.length',sandbox),count+expected);
  vm.runInContext('undo()',sandbox);assert.equal(vm.runInContext('objects.length',sandbox),count);
  console.log(`2017 ${variant}: ${expected} canonical editable box(es), placements/scale/Undo verified.`);
}
// A pinched face consists of two true polygons sharing exactly one vertex.
// Directed edges follow SketchUp's ordered edge uses; preserve both polygons
// rather than treating the compound boundary as one non-manifold face.
const split=vm.runInContext(`(()=>{
 const coords=[[0,0,0],[1,0,0],[1,1,0],[0,1,0],[2,0,0],[2,1,0]];
 const ring=[0,1,2,3,0,4,5,0],uses=[];
 for(let i=0;i<ring.length-1;i++){
  const a=ring[i],b=ring[i+1];uses.push({direction:0,edge:{kind:'CEdge',endpoints:[{slot:a+1,point:coords[a]},{slot:b+1,point:coords[b]}]}});
 }
 const v=new Map(),out=legacySKPSplitPinchedRing({uses},v);
 return {sizes:out.map(x=>x.length),allVertices:v.size};
})()`,sandbox);
assert.deepEqual(Array.from(split.sizes),[4,3]);assert.equal(split.allVertices,6);
// A 2017 schema must not be misread by the SketchUp 8 decoder.
const w=new Writer();w.str('SketchUp Model');w.str('{16.0.0}');w.raw(new Uint8Array(64));
sandbox.unsupported=w.bytes.length?Uint8Array.from(w.bytes).buffer:null;
await assert.rejects(vm.runInContext("prepareSKPImport(unsupported,'2016.skp')",sandbox),/unverified legacy archive layout/);
console.log('2017 legacy generation regression passed.');
