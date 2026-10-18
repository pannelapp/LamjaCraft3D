// Deterministic, dependency-free MFC model sections for the verified pre-PID layouts.
import assert from 'node:assert/strict';
export class PrePIDWriter{
  constructor({version=13,jpegThumbnail=false,groupPlacement=false,nestedPlacement=false,slotStart=40,drawingLayerAtEnd=false}={}){Object.assign(this,{version,jpegThumbnail,groupPlacement,nestedPlacement,drawingLayerAtEnd});this.slot=slotStart;}
  bytes=[];slot=40;classes=new Map();objects=new Map();
  byte(n){this.bytes.push(n&255);}
  word(n){this.byte(n);this.byte(n>>>8);}
  dword(n){for(let i=0;i<4;i++)this.byte(n/(2**(8*i)));}
  double(n){const b=Buffer.alloc(8);b.writeDoubleLE(n);this.raw(b);}
  raw(xs){for(const x of xs)this.byte(x);}
  str(s){this.raw([255,254,255]);const len=s.length;if(len<255)this.byte(len);else{this.byte(255);this.word(len);}
    for(const ch of s)this.word(ch.charCodeAt(0));}
  null(){this.word(0);}
  ref(name){const slot=this.objects.get(name);assert(slot,`missing ${name}`);if(slot<0x7fff)this.word(slot);else{this.word(0x7fff);this.dword(slot);}}
  obj(name,cls,schema,fn){
    let classSlot=this.classes.get(cls);
    if(classSlot===undefined){this.word(0xffff);this.word(schema);this.word(cls.length);this.raw(Buffer.from(cls,'ascii'));classSlot=this.slot++;this.classes.set(cls,classSlot);}
    else if(classSlot<0x7fff)this.word(0x8000|classSlot);
    else{this.word(0x7fff);this.dword(0x80000000+classSlot);}
    this.objects.set(name,this.slot++);fn();
  }
  pre(){this.null();} // SketchUp 7/13/15 have no persistent-ID mask
  draw(layer='layer'){if(this.drawingLayerAtEnd)this.null();else this.ref(layer);this.raw([0,1,1,0,0,0]);if(this.drawingLayerAtEnd)this.ref(layer);else this.null();}
  layer(name,label){this.obj(name,'CLayer',2,()=>{this.pre();this.str(label);this.byte(0);this.word(0);this.str('Layer_'+label);
    this.raw([0,1,200,180,160,255]);this.str('');this.dword(0);this.dword(0);this.double(0);this.byte(0);this.dword(0);});}
  vertex(k,point){this.obj(k,'CVertex',0,()=>{this.pre();for(const n of point)this.double(n);});}
  edge(k,a,b,coords,layer){this.obj(k,'CEdge',2,()=>{this.pre();this.draw(layer);
    for(const i of [a,b]){if(this.objects.has(`${layer}v${i}`))this.ref(`${layer}v${i}`);else this.vertex(`${layer}v${i}`,coords[i]);}
    this.null();});}
  face(k,ring,normal,edges,layer,texture=false){this.obj(k,'CFace',3,()=>{
    if(texture){this.obj(`${k}-attr`,'CAttributeContainer',0,()=>{this.pre();this.obj(`${k}-ftc`,'CFaceTextureCoords',4,()=>{
      this.pre();this.dword(0);for(let i=0;i<24;i++)this.double(i%4===0?1:0);this.dword(0);this.dword(0);this.dword(0);this.dword(0);
    });this.null();});}else this.pre();
    this.draw(layer);for(const n of [...normal,0])this.double(n);this.dword(1);
    this.obj(`${k}-loop`,'CLoop',1,()=>{this.pre();this.raw([1,1]);
      for(let i=0;i<ring.length;i++){const a=ring[i],b=ring[(i+1)%ring.length],idx=edges.findIndex(([x,y])=>(x===a&&y===b)||(x===b&&y===a));assert(idx>=0);
        this.obj(`${k}-use${i}`,'CEdgeUse',1,()=>{this.pre();this.ref(`${layer}edge${idx}`);this.byte(edges[idx][0]===a?0:1);this.ref(`${k}-loop`);});
      }this.null();});this.word(0);
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
    this.pre();this.draw();this.raw(new Uint8Array(10));this.dword(1);this.layer('deflayer','DefLayer');
    this.ref('deflayer');this.dword(0);this.dword(18);this.cube('def','deflayer');
    this.dword(0);this.null();this.raw(new Uint8Array(16));this.str('Box');this.str('');this.str('');
    this.raw(new Uint8Array(46));this.obj('thumb','CThumbnail',1,()=>{this.pre();this.camera('camera');
      if(this.jpegThumbnail)this.obj('preview','CDib',3,()=>{this.dword(1);this.dword(4);this.raw([255,216,255,217]);this.dword(70);});
      else this.null();
    });
  });}
  instance(name,x,mirrored=false,definition='def'){this.obj(name,this.groupPlacement?'CGroup':'CComponentInstance',this.groupPlacement?1:this.version===15?5:4,()=>{
    this.pre();this.draw();this.ref(definition);const m=[mirrored?-1:1,0,0,0,1,0,0,0,1,x,0,0,1];for(const a of m)this.double(a);
    this.str('Box');if(this.version===15)this.raw(Array.from({length:16},(_,i)=>i+1));
  });}
  assembly(){this.obj('assembly','CComponentDefinition',10,()=>{
    this.pre();this.draw();this.raw(new Uint8Array(10));this.dword(1);this.ref('deflayer');
    this.ref('deflayer');this.dword(0);this.dword(1);this.instance('nested',2);
    this.dword(0);this.null();this.raw(new Uint8Array(16));this.str('Assembly');this.str('');this.str('');
    this.raw(new Uint8Array(46));this.null();
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
  generate(withDefinitions,multiLayer,withDimension=false,mirrored=false){
    this.str('SketchUp Model');this.str(this.version===7?'{7.1.6860}':this.version===15?'{15.3.331}':'{13.0.4812}');this.raw(new Uint8Array(16));this.str('');this.dword(2);
    this.dword(multiLayer?2:1);this.layer('layer','Layer0');if(multiLayer)this.layer('extra','Layer1');this.ref(multiLayer?'extra':'layer');
    this.dword(withDefinitions?(this.nestedPlacement?2:1):0);if(withDefinitions){this.definition();if(this.nestedPlacement)this.assembly();}
    this.dword(withDefinitions?2:withDimension?19:18);if(withDefinitions){const definition=this.nestedPlacement?'assembly':'def';this.instance('instance0',0,false,definition);this.instance('instance1',3,mirrored,definition);}else{this.cube('root','layer');if(withDimension)this.dimension();}
    this.dword(0);this.null();
    return Uint8Array.from(this.bytes).buffer;
  }
}
