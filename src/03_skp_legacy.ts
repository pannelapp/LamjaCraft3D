// SketchUp 7, 8, 2013, 2015 and 2017 (.skp) legacy MFC CArchive readers.
// Independent implementation: no external packages, runtime converters or
// borrowed third-party parsing code. Each generation uses its own validated
// class-body layout; other versions are rejected rather than guessing offsets.
type LegacySKPNode={kind:string;slot:number;offset:number;schema?:number;name?:string;draw?:Uint8Array;
  attributes?:LegacySKPNode|null;entities?:LegacySKPNode[];definition?:LegacySKPNode|null;
  matrix?:number[];loops?:LegacySKPNode[];uses?:LegacySKPNode[];edge?:LegacySKPNode|null;
  endpoints?:[LegacySKPNode|null,LegacySKPNode|null];point?:Vec3;plane?:number[];direction?:number;
  children?:LegacySKPNode[];materials?:number;hidden?:boolean;};
// Archive nodes include vertices, edges, loops and edge uses, not just objects.
// Bound dense legacy models separately from visible placements/output solids.
const LEGACY_SKP_ARCHIVE_POLICY=Object.freeze({maxObjects:1000000,maxRootEntities:200000});
const LEGACY_SKP_LAYOUT=Object.freeze({prePIDDefinitionHeaderBytes:10,componentInstance2015Schema:5,group2015Schema:1});
class LegacySKPArchive{
  readonly view:DataView;readonly data:Uint8Array;position:number;nextSlot:number;readonly version:7|8|13|15|17;readonly initialSlot:number;
  readonly classes=new Map<number,{name:string;schema:number}>();
  readonly objects=new Map<number,LegacySKPNode>();
  private depth=0;
  constructor(buffer:ArrayBuffer,start:number,firstClassSlot:number,layerClassSlot:number,version:7|8|13|15|17=8){
    this.view=new DataView(buffer);this.data=new Uint8Array(buffer);this.position=start;this.nextSlot=firstClassSlot;
    this.initialSlot=firstClassSlot;this.version=version;
    // These document-level classes are declared before the model's layer list.
    // Their slots are verified by the real 7/2013/2015/2017 archives' MFC class order.
    for(const [slot,name] of [[3,'CDib'],[5,'CAttributeContainer'],[7,'CAttributeNamed'],[10,'CCamera'],[layerClassSlot,'CLayer']] as const)this.classes.set(slot,{name,schema:0});
  }
  private need(n:number):void{if(n<0||this.position+n>this.data.length)throw Error('Legacy SKP contains a truncated or out-of-range record.');}
  byte():number{this.need(1);return this.data[this.position++];}
  word():number{this.need(2);const result=this.view.getUint16(this.position,true);this.position+=2;return result;}
  dword():number{this.need(4);const result=this.view.getUint32(this.position,true);this.position+=4;return result;}
  double():number{this.need(8);const result=this.view.getFloat64(this.position,true);this.position+=8;if(!Number.isFinite(result))throw Error('Legacy SKP contains a non-finite coordinate.');return result;}
  skip(n:number):void{this.need(n);this.position+=n;}
  string():string{
    if(this.byte()!==255||this.byte()!==254||this.byte()!==255)throw Error(`Legacy SKP string record invalid at byte ${this.position}.`);
    let length=this.byte();if(length===255){length=this.word();if(length===65535)length=this.dword();}
    if(length>1000000)throw Error('Legacy SKP string length is unreasonable.');this.need(length*2);
    const value=new TextDecoder('utf-16le',{fatal:true}).decode(this.data.subarray(this.position,this.position+length*2));this.position+=length*2;return value;
  }
  pointer():LegacySKPNode|null{
    if(++this.depth>100)throw Error('Legacy SKP has an excessively nested object graph.');
    try{return this.readPointer();}finally{this.depth--;}
  }
  private readPointer():LegacySKPNode|null{
    const originalOffset=this.position;let tag=this.word();let wide=false,wideTag=0;
    if(tag===0)return null;
    if(tag===0x7fff){wide=true;wideTag=this.dword();if(!wideTag)return null;}
    let cls:{name:string;schema:number};
    if(!wide&&tag===0xffff){const schema=this.word(),length=this.word();if(length<1||length>128)throw Error('Legacy SKP class name length is invalid.');this.need(length);
      const name=new TextDecoder('ascii',{fatal:true}).decode(this.data.subarray(this.position,this.position+length));this.position+=length;
      cls={name,schema};this.classes.set(this.nextSlot++,cls);
    }else{
      const current=wide?wideTag:tag,mask=wide?0x80000000:0x8000;
      if((current&mask)===0){
        const object=this.objects.get(current);
        if(!object){
          // Opaque drawing/attribute metadata may reference the already-skipped
          // document preamble. Geometry consumers still require real typed nodes.
          if(current<this.initialSlot)return {kind:'ExternalReference',slot:current,offset:originalOffset};
          throw Error(`Legacy SKP contains unresolved object reference ${current} at byte ${originalOffset}.`);
        }
        return object;
      }
      const slot=wide?(current&0x7fffffff):(current&0x7fff);const known=this.classes.get(slot);
      if(!known)throw Error(`Legacy SKP class reference ${slot} is not defined at byte ${originalOffset}.`);cls=known;
    }
    if(this.nextSlot>LEGACY_SKP_ARCHIVE_POLICY.maxObjects)throw Error('Legacy SKP exceeds the safe object graph limit.');
    const node:LegacySKPNode={kind:cls.name,slot:this.nextSlot++,offset:this.position,schema:cls.schema};
    this.objects.set(node.slot,node);this.readBody(node);
    return node;
  }
  private pre(node:LegacySKPNode):void{
    node.attributes=this.pointer();
    if(this.version===17)this.pid();
  }
  private pid():void{const mask=this.byte();let count=0;for(let bits=mask;bits;bits&=bits-1)count++;this.skip(count);}
  private draw(node:LegacySKPNode):void{
    // Drawing metadata contains real MFC pointers, which expand from two to
    // six bytes above the short-reference limit. Do not assume a 10-byte body.
    const start=this.position;this.pointer();const flags=Array.from({length:6},()=>this.byte());
    node.hidden=!!flags[0];this.pointer();node.draw=this.data.slice(start,this.position);
  }
  private count(limit:number,context:string):number{
    const n=this.dword();if(n>limit)throw Error(`Legacy SKP ${context} count exceeds the safety limit.`);return n;
  }
  private dimensionAnchor():void{
    const kind=this.dword();if(kind>20)throw Error('Legacy SKP has an invalid dimension anchor kind.');
    this.skip(4+3*8);this.pointer();this.pointer();
    for(let j=0;j<2;j++){const n=this.count(1000,'dimension anchor path');for(let i=0;i<n;i++)this.pointer();}
  }
  private attributeValue(kind:number):void{
    switch(kind){case 0:return;case 4:case 5:case 9:this.skip(4);return;case 6:case 12:this.skip(8);return;case 7:this.skip(1);return;case 10:this.string();return;case 17:case 18:this.skip(24);return;
      case 11:{const count=this.dword();if(count>50000)throw Error('Legacy SKP attribute list too long.');for(let i=0;i<count;i++)this.attributeValue(this.byte());return;}
      default:throw Error(`Legacy SKP has unsupported attribute value type ${kind}.`);
    }
  }
  private readBody(node:LegacySKPNode):void{
    switch(node.kind){
      case 'CComponentDefinition':{
        if(this.version===17){
          this.pre(node);this.draw(node);this.skip(3);
          const materials=this.count(50000,'definition material');for(let i=0;i<materials;i++)this.pointer();
          this.pointer();this.skip(3);
          const layers=this.count(2000,'definition layer');for(let i=0;i<layers;i++)this.pointer();
          this.pointer();
          const nested=this.count(10000,'nested definition');for(let i=0;i<nested;i++)this.pointer();
          const entities=this.count(200000,'definition entity');node.entities=[];
          for(let i=0;i<entities;i++){const child=this.pointer();if(child)node.entities.push(child);}
          const relationships=this.count(10000,'definition relationship');for(let i=0;i<relationships;i++)this.pointer();
          this.pointer();this.skip(16);node.name=this.string();this.string();this.string();
          this.skip(4+43);const thumbnail=this.pointer();
          if(thumbnail&&thumbnail.kind!=='CThumbnail')throw Error('SketchUp 2017 definition has an invalid thumbnail.');
          return;
        }
        this.pre(node);this.draw(node);this.skip(LEGACY_SKP_LAYOUT.prePIDDefinitionHeaderBytes);const count=this.dword();if(count>100)throw Error('Legacy SKP definition has too many layers.');
        for(let i=0;i<count;i++)this.pointer();
        const activeLayer=this.pointer(),unused=this.dword(),entities=this.dword();
        if((activeLayer&&activeLayer.kind!=='CLayer'&&activeLayer.kind!=='ExternalReference')||unused!==0||entities>100000)throw Error('Legacy SKP definition header is invalid.');
        node.entities=[];for(let i=0;i<entities;i++){const child=this.pointer();if(child)node.entities.push(child);}
        const relationships=this.dword();if(relationships>100)throw Error('Legacy SKP relationship count is invalid.');this.pointer();
        this.skip(16);node.name=this.string();this.string();this.string();this.skip(46);this.pointer();return;
      }
      case 'CLayer':{
        this.pre(node);node.name=this.string();
        if(this.version===17){this.skip(1+2);this.pid();this.string();this.skip(2+4);this.string();this.skip(4+4+8+1+4);}
        else{this.skip(3);this.string();this.skip(6);this.string();this.skip(4+4+8+1+4);}
        return;
      }
      case 'CThumbnail':this.pre(node);this.pointer();this.pointer();return;
      case 'CCamera':this.skip(137+2);this.string();this.skip(33);return;
      // JPEG previews in verified 7/2017 archives include a trailing quality DWORD.
      case 'CDib':{const subtype=this.dword(),size=this.dword();if(size>64*1024*1024)throw Error('Legacy SKP preview exceeds safe size.');this.skip(size);if((this.version===7||this.version===17)&&subtype===1)this.skip(4);return;}
      case 'CAttributeContainer':{
        this.pre(node);node.children=[];
        for(let i=0;i<10000;i++){const child=this.pointer();if(!child)return;node.children.push(child);}
        throw Error('Legacy SKP attribute container has no terminator.');
      }
      case 'CAttributeNamed':{
        this.pre(node);this.skip(4);node.name=this.string();
        for(let i=0;i<10000;i++){const key=this.string();if(!key){this.skip(4);return;}this.attributeValue(this.byte());}
        throw Error('Legacy SKP attribute dictionary has no terminator.');
      }
      case 'CFace':{
        this.pre(node);this.draw(node);node.plane=Array.from({length:4},()=>this.double());const count=this.dword();
        if(count<1||count>1000)throw Error('Legacy SKP face loop count is invalid.');node.loops=[];
        for(let i=0;i<count;i++){const loop=this.pointer();if(!loop||loop.kind!=='CLoop')throw Error('Legacy SKP face loop is missing.');node.loops.push(loop);}
        if(this.version===17)this.pointer();else node.materials=this.word();return;
      }
      case 'CLoop':{
        this.pre(node);this.skip(2);node.uses=[];
        for(let i=0;i<10000;i++){const use=this.pointer();if(!use)return;node.uses.push(use);}
        throw Error('Legacy SKP loop has no terminator.');
      }
      case 'CEdgeUse':this.pre(node);node.edge=this.pointer();node.direction=this.byte();this.pointer();return;
      case 'CEdge':this.pre(node);this.draw(node);node.endpoints=[this.pointer(),this.pointer()];this.pointer();return;
      case 'CVertex':this.pre(node);node.point=[this.double(),this.double(),this.double()];return;
      case 'CArcCurve':this.pre(node);this.skip(5+14*8);return;
      case 'CCurve':this.pre(node);this.skip(5);return;
      case 'CFaceTextureCoords':{
        this.pre(node);this.skip(4+24*8);
        for(let j=0;j<2;j++){const pins=this.dword();if(pins>10000)throw Error('Legacy SKP contains too many texture pins.');this.skip(32*pins);}
        this.skip(8);return;
      }
      case 'CComponentInstance':case 'CGroup':{
        if(this.version===15){
          const expected=node.kind==='CGroup'?LEGACY_SKP_LAYOUT.group2015Schema:LEGACY_SKP_LAYOUT.componentInstance2015Schema;
          if(node.schema!==expected)throw Error(`SketchUp 2015 has an unsupported ${node.kind} schema ${node.schema}.`);
        }
        this.pre(node);this.draw(node);node.definition=this.pointer();node.matrix=Array.from({length:13},()=>this.double());
        if(Math.abs(node.matrix[12]-1)>1e-8)throw Error('Legacy SKP has a non-affine component placement.');
        node.name=this.string();if(this.version===15||this.version===17)this.skip(16);return;
      }
      case 'CSkFont':this.pre(node);this.string();this.skip(15);return;
      case 'CDimensionLinear':{
        this.pre(node);this.draw(node);this.string();this.pointer();this.skip(1+4);
        this.dimensionAnchor();this.dimensionAnchor();this.skip(6*8+4+8+8+4);return;
      }
      case 'CConstructionPoint':this.pre(node);this.draw(node);this.skip(6*8+1);return;
      case 'CConstructionLine':this.pre(node);this.draw(node);this.skip(8*8+4);return;
      case 'CSectionPlane':this.pre(node);this.draw(node);this.skip(4*8);return;
      case 'CImage':{
        if(this.version!==17)throw Error('SketchUp 7/8/2013/2015 image entity layout is not supported.');
        this.pre(node);this.draw(node);node.definition=this.pointer();node.matrix=Array.from({length:13},()=>this.double());
        if(Math.abs(node.matrix[12]-1)>1e-8)throw Error('Legacy SKP image has a non-affine transform.');
        node.name=this.string();this.skip(16);return;
      }
      case 'CRelationship':this.pre(node);this.pointer();this.pointer();if(this.version!==17)this.pointer();return;
      default:throw Error(`Legacy SKP includes unsupported class ${node.kind} at byte ${node.offset}.`);
    }
  }
}
function legacySKPCheckHeader(buffer:ArrayBuffer):{version:number;archiveStart:number}|null{
  const bytes=new Uint8Array(buffer);
  if(bytes.length<80||bytes[0]!==255||bytes[1]!==254||bytes[2]!==255||bytes[3]!==14)return null;
  if(new TextDecoder('utf-16le').decode(bytes.subarray(4,32))!=='SketchUp Model')return null;
  if(bytes[32]!==255||bytes[33]!==254||bytes[34]!==255)return null;
  const len=bytes[35];if(len===255||len>96||36+len*2+20>bytes.length)return null;
  const raw=new TextDecoder('utf-16le').decode(bytes.subarray(36,36+len*2));
  const match=/^\{(\d+)(?:\.[\d.]+)?\}$/.exec(raw);if(!match)return null;
  return {version:Number(match[1]),archiveStart:36+len*2+16+4};
}
// Find the 7/2013/2015/2017 model's first layer by its structural MFC class declaration.
// We deliberately do not scan for geometry bytes or infer a definition-list
// offset from a specific model. This also handles root-only geometry and models
// with several layers. The layer's self-contained fixed layout calibrates the
// shared store-map slot without parsing thumbnail/style managers.
function legacySKPFindLayers(buffer:ArrayBuffer,version:7|13|15|17):{start:number;classSlot:number;layerCount:number}{
  const bytes=new Uint8Array(buffer),view=new DataView(buffer),name='CLayer';
  const parseString=(at:number):number=>{
    if(at+4>bytes.length||bytes[at]!==255||bytes[at+1]!==254||bytes[at+2]!==255)throw Error('Invalid UTF-16 record.');
    let len=bytes[at+3];at+=4;
    if(len===255){if(at+2>bytes.length)throw Error('Invalid UTF-16 length.');len=view.getUint16(at,true);at+=2;
      if(len===65535){if(at+4>bytes.length)throw Error('Invalid UTF-16 length.');len=view.getUint32(at,true);at+=4;}}
    if(len>100000||at+len*2>bytes.length)throw Error('Invalid UTF-16 string.');return at+len*2;
  };
  const pid=(at:number):number=>{if(at>=bytes.length)throw Error('Invalid persistent id.');let bits=bytes[at++];while(bits){at++;bits&=bits-1;}if(at>bytes.length)throw Error('Invalid persistent id.');return at;};
  const firstLayerEnd=(at:number):number=>{
    if(at+2>bytes.length)throw Error('Missing layer preamble.');
    const attr=view.getUint16(at,true);if(attr&0x8000)throw Error('Layer preamble has an inline attribute.');
    const attributeBytes=attr===0x7fff?6:2;
    if(at+attributeBytes>bytes.length||(attributeBytes===6&&(view.getUint32(at+2,true)&0x80000000)))throw Error('Layer preamble has an invalid attribute reference.');
    // SketchUp 7/13/15 share the pre-PID class bodies with SketchUp 8,
    // but use a counted layer/definition pool like SketchUp 2017.
    at+=attributeBytes;if(version===17)at=pid(at);
    at=parseString(at);at+=3;if(version===17)at=pid(at);
    at=parseString(at);at+=6;at=parseString(at);at+=21;
    if(at>bytes.length)throw Error('Truncated layer.');return at;
  };
  for(let start=80;start+16<bytes.length;start++){
    if(view.getUint16(start,true)!==0xffff||view.getUint16(start+2,true)!==2||view.getUint16(start+4,true)!==name.length)continue;
    if(![...name].every((c,i)=>bytes[start+6+i]===c.charCodeAt(0)))continue;
    if(start<4)continue;const count=view.getUint32(start-4,true);if(count<1||count>2000)continue;
    try{
      const afterFirst=firstLayerEnd(start+6+name.length);if(afterFirst+2>bytes.length)continue;
      const tag=view.getUint16(afterFirst,true),wide=tag===0x7fff;
      if(wide&&afterFirst+6>bytes.length)continue;
      const reference=wide?view.getUint32(afterFirst+2,true):tag,classMask=wide?0x80000000:0x8000;
      let classSlot:number;
      if(count===1){ // the only layer is necessarily the active layer
        if(reference<3||(reference&classMask))continue;classSlot=reference-1;
      }else{ // the second layer is an instance of the just-declared CLayer class
        if(!(reference&classMask)||(!wide&&tag===0xffff))continue;classSlot=reference&~classMask;
      }
      if(classSlot<2||classSlot>LEGACY_SKP_ARCHIVE_POLICY.maxObjects-2)continue;
      return {start,classSlot,layerCount:count};
    }catch{continue;}
  }
  throw Error(`SketchUp ${version} layer-list structure could not be located safely.`);
}
function legacySKPFindFirstDefinition(buffer:ArrayBuffer):{start:number;classSlot:number;layerSlot:number}{
  const v=new DataView(buffer);const bytes=new Uint8Array(buffer),name=new TextEncoder().encode('CComponentDefinition');
  for(let start=64;start+6+name.length+31<bytes.length;start++){
    if(v.getUint16(start,true)!==0xffff||v.getUint16(start+2,true)!==10||v.getUint16(start+4,true)!==name.length)continue;
    if(!name.every((char,i)=>bytes[start+6+i]===char))continue;
    const body=start+6+name.length,layerCount=v.getUint32(body+22,true),layerRef=v.getUint16(body+26,true);
    if(layerCount!==1||!(layerRef&0x8000))throw Error('Legacy SKP uses a layer preamble not yet supported by the SketchUp 8 reader.');
    const layerSlot=layerRef&0x7fff;
    return {start,classSlot:layerSlot+2,layerSlot};
  }
  throw Error('Legacy SKP has no supported SketchUp 8 component-definition section.');
}
function legacySKPRing(loop:LegacySKPNode,vertices:Map<number,Vec3>):number[]{
  const uses=loop.uses||[];if(uses.length<3||uses.length>10000)throw Error('Legacy SKP contains a face ring with an invalid edge count.');
  const edges=uses.map(use=>{
    const e=use.edge;if(!e||e.kind!=='CEdge'||!e.endpoints||!e.endpoints[0]?.point||!e.endpoints[1]?.point)throw Error('Legacy SKP face references an invalid edge.');
    const a=e.endpoints[0].slot,b=e.endpoints[1].slot;
    vertices.set(a,e.endpoints[0].point);vertices.set(b,e.endpoints[1].point);return [a,b] as [number,number];
  });
  const adjacent=new Map<number,number[]>();
  edges.forEach(([a,b],i)=>{if(a===b)throw Error('Legacy SKP contains a zero-length topological edge.');adjacent.set(a,[...(adjacent.get(a)||[]),i]);adjacent.set(b,[...(adjacent.get(b)||[]),i]);});
  if([...adjacent.values()].some(list=>list.length!==2)||adjacent.size!==edges.length)throw Error('Legacy SKP face boundary is not a simple closed ring.');
  const ring=[edges[0][0],edges[0][1]],used=new Set([0]);
  while(used.size<edges.length){const available=(adjacent.get(ring[ring.length-1])||[]).filter(index=>!used.has(index));
    if(available.length!==1)throw Error('Legacy SKP face boundary could not be ordered.');
    const index=available[0],[a,b]=edges[index];used.add(index);ring.push(a===ring[ring.length-1]?b:a);
  }
  if(ring.pop()!==ring[0])throw Error('Legacy SKP face boundary is open.');return ring;
}
// A SketchUp loop can contain two planar contours meeting at one vertex.
// That is not one simple B-rep ring; split its ordered directed edge uses into
// individual simple rings rather than discarding the complete input model.
function legacySKPSplitPinchedRing(loop:LegacySKPNode,vertices:Map<number,Vec3>):number[][]{
  const uses=loop.uses||[],rings:number[][]=[];let current:number[]=[];
  if(uses.length<6||uses.length>10000)throw Error('Invalid pinched SketchUp loop length.');
  for(const use of uses){
    const edge=use.edge,ends=edge?.endpoints;
    if(edge?.kind!=='CEdge'||!ends?.[0]?.point||!ends[1]?.point||(use.direction!==0&&use.direction!==1))
      throw Error('Invalid directed SketchUp edge use.');
    const from=ends[use.direction]!.slot,to=ends[1-use.direction]!.slot;
    vertices.set(ends[0]!.slot,ends[0]!.point);vertices.set(ends[1]!.slot,ends[1]!.point);
    if(!current.length)current.push(from);
    if(current[current.length-1]!==from)throw Error('Pinched SketchUp loop is not ordered consistently.');
    current.push(to);
    if(to===current[0]){
      current.pop();
      if(current.length<3||new Set(current).size!==current.length)throw Error('Pinched SketchUp loop contains a degenerate contour.');
      rings.push(current);current=[];
    }
  }
  if(current.length||rings.length<2)throw Error('Pinched SketchUp loop cannot be separated into simple contours.');
  return rings;
}
function legacySKPBody(definition:LegacySKPNode,stats?:{splitPinchedFaces:number;extraContours:number}):SKPBody{
  const vertices=new Map<number,Vec3>(),faces:SKPFaceRings[]=[],instances:SKPPlacement[]=[];
  for(const entity of definition.entities||[]){
    if(entity.kind==='CFace'&&!entity.hidden){
      let rings:number[][];
      try{rings=(entity.loops||[]).map(loop=>legacySKPRing(loop,vertices));}
      catch(error){
        // Only a self-touching outer loop with no holes can be decomposed
        // without guessing at hole ownership or changing the original planes.
        const source=entity.loops||[];
        if(source.length!==1||!(error instanceof Error)||!error.message.includes('not a simple closed ring'))throw error;
        const separate=legacySKPSplitPinchedRing(source[0],vertices);
        const normal=entity.plane||[0,0,1,0];
        for(const ring of separate){
          let nx=0,ny=0,nz=0;
          for(let j=0;j<ring.length;j++){const a=vertices.get(ring[j])!,b=vertices.get(ring[(j+1)%ring.length])!;
            nx+=(a[1]-b[1])*(a[2]+b[2]);ny+=(a[2]-b[2])*(a[0]+b[0]);nz+=(a[0]-b[0])*(a[1]+b[1]);}
          if(nx*normal[0]+ny*normal[1]+nz*normal[2]<0)ring.reverse();
          faces.push({outer:ring,holes:[]});
        }
        if(stats){stats.splitPinchedFaces++;stats.extraContours+=separate.length-1;}
        continue;
      }
      if(!rings.length)continue;
      for(let i=0;i<rings.length;i++){
        const ring=rings[i],normal=entity.plane||[0,0,1,0];let nx=0,ny=0,nz=0;
        for(let j=0;j<ring.length;j++){
          const a=vertices.get(ring[j])!,b=vertices.get(ring[(j+1)%ring.length])!;
          nx+=(a[1]-b[1])*(a[2]+b[2]);ny+=(a[2]-b[2])*(a[0]+b[0]);nz+=(a[0]-b[0])*(a[1]+b[1]);
        }
        const dot=nx*normal[0]+ny*normal[1]+nz*normal[2];if((i===0&&dot<0)||(i>0&&dot>0))ring.reverse();
      }
      faces.push({outer:rings[0],holes:rings.slice(1)});
    }else if((entity.kind==='CGroup'||entity.kind==='CComponentInstance'||entity.kind==='CImage')&&!entity.hidden){
      if(!entity.definition||entity.definition.kind!=='CComponentDefinition'||!entity.matrix)throw Error('Legacy SKP component has a missing definition or transform.');
      instances.push({definition:entity.definition.slot,name:entity.name||entity.definition.name||'Component',transform:entity.matrix,hidden:false,group:entity.kind==='CGroup'});
    }
  }
  return {id:definition.slot,vertices,edges:new Map(),faces,instances};
}
function prepareLegacySKPImport(buffer:ArrayBuffer,fileName:string,report?:(progress:number,message:string)=>void,scale=1):MeshImportResult{
  if(buffer.byteLength>SKP_IMPORT_POLICY.maxArchiveBytes)throw Error('Legacy SKP exceeds the safe file-size limit.');
  const header=legacySKPCheckHeader(buffer);if(!header)throw Error('This file does not have a valid SketchUp SKP header.');
  if(header.version!==7&&header.version!==8&&header.version!==13&&header.version!==15&&header.version!==17)throw Error(`SketchUp ${header.version} has an unverified legacy archive layout. Supported legacy releases are 7, 8, 2013, 2015 and 2017.`);
  report?.(4,`Reading SketchUp ${header.version} object archive…`);
  let parser:LegacySKPArchive;
  const definitions=new Map<number,LegacySKPNode>();
  if(header.version===7||header.version===13||header.version===15||header.version===17){
    const model=legacySKPFindLayers(buffer,header.version);
    parser=new LegacySKPArchive(buffer,model.start,model.classSlot,model.classSlot,header.version);
    for(let i=0;i<model.layerCount;i++){
      const layer=parser.pointer();if(!layer||layer.kind!=='CLayer')throw Error(`SketchUp ${header.version} has a malformed layer list.`);
    }
    parser.pointer(); // active layer, which can be any layer in the list
    const count=parser.dword();if(count>10000)throw Error(`SketchUp ${header.version} has too many component definitions.`);
    for(let i=0;i<count;i++){
      const node=parser.pointer();if(node){if(node.kind!=='CComponentDefinition')throw Error(`SketchUp ${header.version} has an invalid definition list.`);definitions.set(node.slot,node);}
    }
  }else{
    const first=legacySKPFindFirstDefinition(buffer);
    parser=new LegacySKPArchive(buffer,first.start,first.classSlot,first.layerSlot);
    // The SketchUp 8 definition pool precedes the root entity list.
    for(let i=0;i<10000;i++){
      if(parser.position+2>buffer.byteLength)throw Error('Legacy SKP has no root entity list.');
      const marker=parser.view.getUint16(parser.position,true);
      if(marker!==(i===0?0xffff:(0x8000|first.classSlot)))break;
      if(marker===0xffff&&parser.position!==first.start)break;
      const node=parser.pointer();if(!node||node.kind!=='CComponentDefinition')throw Error('Legacy SKP definition pool is malformed.');
      definitions.set(node.slot,node);
    }
  }
  report?.(30,'Resolving legacy component hierarchy…');
  const count=parser.dword();if(count>LEGACY_SKP_ARCHIVE_POLICY.maxRootEntities)throw Error(`Legacy SKP has ${count} top-level entity records, above the ${LEGACY_SKP_ARCHIVE_POLICY.maxRootEntities} archive limit. Entity records include edges and faces, not just placed components.`);
  const root:LegacySKPNode[]=[];
  for(let i=0;i<count;i++){const node=parser.pointer();if(node)root.push(node);}
  if(!root.length)throw Error('Legacy SKP contains no root entities.');
  const geometryStats={splitPinchedFaces:0,extraContours:0};
  const bodies=new Map<number,SKPBody>();
  const bodyFor=(id:number):SKPBody=>{let body=bodies.get(id);if(!body){const def=parser.objects.get(id);if(!def||def.kind!=='CComponentDefinition')throw Error('Legacy SKP component definition could not be resolved.');body=legacySKPBody(def,geometryStats);bodies.set(id,body);}return body;};
  const warnings=new Set<string>(),items:MeshImportItem[]=[],definitionPlacements=new Map<number,number>();let placements=0,candidates=0,depthMax=0;
  const rootBody=legacySKPBody({kind:'Root',slot:0,offset:0,entities:root},geometryStats);
  function countTree(body:SKPBody,stack:Set<number>,depth:number):void{
    if(depth>SKP_IMPORT_POLICY.maxDepth)throw Error('Legacy SKP nesting is too deep.');depthMax=Math.max(depthMax,depth);candidates+=skpCandidateShells(body);
    for(const placement of body.instances){if(placement.hidden)continue;placements++;
      if(placements>SKP_IMPORT_POLICY.maxInstances)throw Error('Legacy SKP exceeds the safe component-placement limit.');
      const id=placement.definition!;if(stack.has(id))throw Error('Legacy SKP has recursive component definitions.');
      definitionPlacements.set(id,(definitionPlacements.get(id)||0)+1);
      const nested=new Set(stack);nested.add(id);countTree(bodyFor(id),nested,depth+1);
    }
  }
  countTree(rootBody,new Set(),0);
  if(candidates>SKP_IMPORT_POLICY.maxOutputSolids)throw Error(`Legacy SKP has approximately ${candidates} candidate closed solids, above the ${SKP_IMPORT_POLICY.maxOutputSolids} object import limit.`);
  report?.(45,`Checking ${candidates} legacy SKP solids…`);
  function visit(body:SKPBody,transform:number[],label:string,stack:Set<number>):void{
    items.push(...skpSplitClosedSolids(body,transform,label,warnings,scale));
    if(items.length>SKP_IMPORT_POLICY.maxOutputSolids)throw Error('Legacy SKP import exceeds the object limit.');
    for(const placement of body.instances){if(placement.hidden)continue;const id=placement.definition!;
      if(stack.has(id))throw Error('Legacy SKP has a cyclic group hierarchy.');
      const next=new Set(stack);next.add(id);
      visit(bodyFor(id),skpCombineTransform(transform,placement.transform),(placement.name||label).slice(0,72),next);
    }
  }
  visit(rootBody,skpIdentity(),fileName.replace(/\.skp$/i,'').slice(0,72),new Set());
  if(!items.length)throw Error('Legacy SKP did not contain any supported closed solids or drawable open surfaces.');
  const usedNames=new Set<string>(),occurrences=new Map<string,number>();
  for(const item of items){const base=item.name;let n=occurrences.get(base)||0,name:string;
    do{n++;const suffix=n===1?'':` (copy ${n})`;name=base.slice(0,Math.max(1,72-suffix.length))+suffix;}while(usedNames.has(name));
    occurrences.set(base,n);usedNames.add(name);item.name=name;
  }
  const reused=[...definitionPlacements.values()].reduce((sum,count)=>sum+Math.max(0,count-1),0);
  warnings.add(`Legacy SketchUp ${header.version} scan: ${count} root entities, ${placements} visible placements (${reused} reused), ${candidates} candidate closed shells, ${items.filter(item=>item.kind!=='surface').length} valid solids and ${items.filter(item=>item.kind==='surface').length} limited open surface objects, maximum nesting depth ${depthMax}.`);
  warnings.add(scale===1?`SketchUp ${header.version} inch coordinates were converted to millimetres.`:`SketchUp ${header.version} inches were converted to millimetres with additional ${scale}× scale.`);
  if(geometryStats.splitPinchedFaces)warnings.add(`Separated ${geometryStats.splitPinchedFaces} SketchUp pinched face boundary/boundaries into ${geometryStats.splitPinchedFaces+geometryStats.extraContours} editable polygon faces.`);
  warnings.add('Legacy import preserves closed solids and open polygon surfaces with component placements. Open surfaces are limited objects; material textures and annotations are not imported.');
  report?.(100,'Legacy SKP import check complete');
  return {format:'skp',items,triangleCount:items.reduce((n,item)=>n+item.solid.faces.size,0),warnings:[...warnings],repairedOpenings:0};
}
