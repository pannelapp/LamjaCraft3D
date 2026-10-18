// Self-contained, dependency-free reader for modern (ZIP/VFF) SketchUp geometry.
// SKP is not STL: original vertices, polygon boundaries, holes and instances are
// reconstructed directly into LamjaCraft's canonical poly-brep-1 solids.
// Scope: ZIP-based 2021+ SKP and separate SketchUp 7 / 8 / 2013 / 2015 / 2017 MFC readers.
// Closed shells become editable solids; drawable open polygon groups become
// limited surfaces. Textures, layers and non-geometric entities are not converted.
interface SKPRecord {tag:number;start:number;end:number;}
interface SKPEdge {a:number;b:number;}
interface SKPFaceRings {outer:number[];holes:number[][];}
interface SKPDefinition {id:number;name:string;entity:SKPRecord;}
interface SKPPlacement {definition:number|undefined;inlineEntity?:SKPRecord;name:string;transform:number[];hidden:boolean;group:boolean;}
interface SKPBody {id:number;vertices:Map<number,Vec3>;edges:Map<number,SKPEdge>;faces:SKPFaceRings[];instances:SKPPlacement[];}
const SKP_IMPORT_POLICY=Object.freeze({maxArchiveBytes:256*1024*1024,maxModelBytes:128*1024*1024,maxEntries:50000,maxRecords:2000000,maxFaces:200000,maxInstances:5000,maxDepth:32,maxOutputSolids:1000});
function skpRecords(view:DataView,start:number,end:number):SKPRecord[]{
  const result:SKPRecord[]=[];let p=start;
  while(p<end){if(end-p<6)throw Error('SKP record header is truncated.');const tag=view.getUint16(p,true),length=view.getUint32(p+2,true);p+=6;if(length>end-p)throw Error('SKP record length exceeds its enclosing record.');result.push({tag,start:p,end:p+length});p+=length;if(result.length>SKP_IMPORT_POLICY.maxRecords)throw Error('SKP has too many records.');}
  return result;
}
function skpChildren(view:DataView,parent:SKPRecord,tag?:number):SKPRecord[]{const items=skpRecords(view,parent.start,parent.end);return tag===undefined?items:items.filter(item=>item.tag===tag);}
function skpChild(view:DataView,parent:SKPRecord,tag:number):SKPRecord|undefined{return skpChildren(view,parent,tag)[0];}
function skpNested(view:DataView,parent:SKPRecord,tags:number[]):SKPRecord|undefined{let cur:SKPRecord|undefined=parent;for(const tag of tags){if(!cur)return;cur=skpChild(view,cur,tag);}return cur;}
function skpId(view:DataView,record:SKPRecord|undefined):number{
  if(!record)throw Error('SKP entity has a missing reference.');const size=record.end-record.start;if(size<1||size>6)throw Error('SKP has an unsupported identifier width.');let value=0;for(let i=size-1;i>=0;i--)value=value*256+view.getUint8(record.start+i);if(!Number.isSafeInteger(value))throw Error('SKP has an invalid identifier.');return value;
}
function skpUtf8(view:DataView,record:SKPRecord|undefined):string{return record?new TextDecoder('utf-8',{fatal:true}).decode(new Uint8Array(view.buffer,view.byteOffset+record.start,record.end-record.start)):'';}
function skpNumberArray(view:DataView,record:SKPRecord|undefined,count:number):number[]{if(!record||record.end-record.start!==8*count)throw Error('SKP contains an invalid floating-point array.');const v=Array.from({length:count},(_,i)=>view.getFloat64(record.start+8*i,true));if(v.some(x=>!Number.isFinite(x)))throw Error('SKP contains non-finite coordinates.');return v;}
function skpEntityId(view:DataView,record:SKPRecord):number{return skpId(view,skpNested(view,record,[0x05dc,0x05de]));}
function skpDrawingId(view:DataView,record:SKPRecord):number{return skpId(view,skpNested(view,record,[0x07d0,0x05dc,0x05de]));}
// SketchUp may omit the persistent ID of the model's root entity collection.
// Keep that collection separate from numbered component definitions in the cache.
function skpBodyId(view:DataView,entity:SKPRecord):number{const ref=skpNested(view,entity,[0x07d0,0x05dc,0x05de]);return ref?skpId(view,ref):0;}
function skpIsHidden(view:DataView,record:SKPRecord):boolean{const f=skpNested(view,record,[0x07d0,0x07d3]);return !!(f&&f.start<f.end&&(view.getUint8(f.start)&1));}
function skpIdentity():number[]{return [1,0,0,0,1,0,0,0,1,0,0,0,1];}
function skpCombineTransform(a:number[],b:number[]):number[]{const c=new Array<number>(13).fill(0);for(let r=0;r<3;r++)for(let col=0;col<3;col++)for(let k=0;k<3;k++)c[r*3+col]+=a[r*3+k]*b[k*3+col];for(let r=0;r<3;r++)c[9+r]=a[9+r]+a[r*3]*b[9]+a[r*3+1]*b[10]+a[r*3+2]*b[11];c[12]=1;return c;}
function skpPoint(matrix:number[],point:Vec3,scale:number):Vec3{
  const factor=25.4*scale; // SKP stores inches; scale is an optional user-requested rescale in LamjaCraft mm.
  return [factor*(matrix[0]*point[0]+matrix[1]*point[1]+matrix[2]*point[2]+matrix[9]),factor*(matrix[3]*point[0]+matrix[4]*point[1]+matrix[5]*point[2]+matrix[10]),factor*(matrix[6]*point[0]+matrix[7]*point[1]+matrix[8]*point[2]+matrix[11])];
}
function skpMirrored(t:number[]):boolean{return t[0]*(t[4]*t[8]-t[5]*t[7])-t[1]*(t[3]*t[8]-t[5]*t[6])+t[2]*(t[3]*t[7]-t[4]*t[6])<0;}
function skpPlacement(view:DataView,item:SKPRecord):SKPPlacement{
  const transform=skpNumberArray(view,skpChild(view,item,0x1966),13);
  if(Math.abs(transform[12]-1)>1e-8)throw Error('SKP has an unsupported non-affine component transform.');
  const ref=skpChild(view,item,0x1967);
  return {definition:ref?skpId(view,ref):undefined,name:skpUtf8(view,skpChild(view,item,0x1965)),transform,hidden:skpIsHidden(view,item),group:false};
}
function skpReadBody(view:DataView,entity:SKPRecord):SKPBody{
  const id=skpBodyId(view,entity),vertices=new Map<number,Vec3>(),edges=new Map<number,SKPEdge>(),faces:SKPFaceRings[]=[],instances:SKPPlacement[]=[];
  for(const vp of skpChildren(view,entity,0x1389))for(const v of skpChildren(view,vp,0x09c4)){const ident=skpEntityId(view,v),point=skpNumberArray(view,skpChild(view,v,0x09c5),3) as Vec3;if(vertices.has(ident))throw Error('SKP has duplicate vertex identifiers.');vertices.set(ident,point);}
  for(const ep of skpChildren(view,entity,0x138a))for(const edge of skpChildren(view,ep,0x0bb8)){const ident=skpDrawingId(view,edge),a=skpId(view,skpChild(view,edge,0x0bb9)),b=skpId(view,skpChild(view,edge,0x0bba));if(edges.has(ident))throw Error('SKP has duplicate edge identifiers.');edges.set(ident,{a,b});}
  for(const fp of skpChildren(view,entity,0x138b))for(const face of skpChildren(view,fp,0x0dac)){
    if(skpIsHidden(view,face))continue;
    const list=skpChild(view,face,0x0dae);if(!list)throw Error('SKP face has no loops.');const loops: number[][]=[];
    for(const loop of skpChildren(view,list,0x1194)){
      const edgeList=skpChild(view,loop,0x1195);if(!edgeList)throw Error('SKP loop has no edges.');const ring:number[]=[];
      for(const use of skpChildren(view,edgeList,0x0fa0)){
        const edge=edges.get(skpId(view,skpChild(view,use,0x0fa1)));
        if(!edge)throw Error('SKP face references an undefined edge.');const forward=skpChild(view,use,0x0fa2);if(!forward||forward.end-forward.start!==1)throw Error('SKP has an invalid edge direction.');
        ring.push(view.getUint8(forward.start)?edge.a:edge.b);
      }
      if(ring.length<3||new Set(ring).size<3)throw Error('SKP contains a degenerate face loop.');
      for(let i=0;i<ring.length;i++)if(!vertices.has(ring[i])||ring[i]===ring[(i+1)%ring.length])throw Error('SKP face has a broken vertex reference.');
      loops.push(ring);
    }
    if(!loops.length)throw Error('SKP face has no usable loops.');faces.push({outer:loops[0],holes:loops.slice(1)});
    if(faces.length>SKP_IMPORT_POLICY.maxFaces)throw Error('SKP has too many faces.');
  }
  // Instances can live in components OR group wrappers. A group wrapper may
  // carry its own entity collection rather than referencing a globally listed
  // component definition. Walk that collection for each placement, independently.
  for(const pool of skpChildren(view,entity,0x138c))for(const item of skpChildren(view,pool,0x1964)){
    instances.push(skpPlacement(view,item));
  }
  for(const pool of skpChildren(view,entity,0x138d))for(const group of skpChildren(view,pool,0x1d4c)){
    // Both a direct group entity and an entity inside a group placement occur
    // in VFF variants. Direct collections must take precedence over a shared
    // definition, because copied groups can own distinct nested descendants.
    const directEntity=skpChild(view,group,0x1388);
    const placements=skpChildren(view,group,0x1964);
    if(!placements.length){
      if(!directEntity)throw Error('SKP group has neither a placement nor an entity collection.');
      const matrix=skpChild(view,group,0x1966);
      const transform=matrix?skpNumberArray(view,matrix,13):skpIdentity();
      if(Math.abs(transform[12]-1)>1e-8)throw Error('SKP has an unsupported group transform.');
      instances.push({definition:undefined,inlineEntity:directEntity,name:skpUtf8(view,skpChild(view,group,0x1965)),transform,hidden:skpIsHidden(view,group),group:true});
      continue;
    }
    for(const placement of placements){
      const parsed=skpPlacement(view,placement);
      parsed.inlineEntity=skpChild(view,placement,0x1388)||directEntity;
      parsed.hidden=parsed.hidden||skpIsHidden(view,group);
      parsed.group=true;
      instances.push(parsed);
    }
  }
  return {id,vertices,edges,faces,instances};
}
interface SKPZipEntry {offset:number;compressed:number;uncompressed:number;method:number;}
function skpZipDirectory(buffer:ArrayBuffer):Map<string,SKPZipEntry>{
  const view=new DataView(buffer),data=new Uint8Array(buffer);let eocd=-1;
  for(let pos=buffer.byteLength-22;pos>=Math.max(0,buffer.byteLength-65557);pos--)if(view.getUint32(pos,true)===0x06054b50&&pos+22+view.getUint16(pos+20,true)===buffer.byteLength){eocd=pos;break;}
  if(eocd<0)throw Error('SKP has no valid ZIP archive (possibly legacy SKP 2020 or older).');
  const count=view.getUint16(eocd+10,true),centralSize=view.getUint32(eocd+12,true),centralOffset=view.getUint32(eocd+16,true);
  if(count===0xffff||centralOffset===0xffffffff||centralSize===0xffffffff||count>SKP_IMPORT_POLICY.maxEntries)throw Error('SKP ZIP64/oversized archive is not supported.');
  const base=eocd-centralSize-centralOffset,zipOffset=base+centralOffset;if(base<0||zipOffset<0||zipOffset+centralSize>eocd)throw Error('SKP ZIP directory offsets are invalid.');
  if(base<36||data[0]!==0xff||data[1]!==0xfe||data[2]!==0xff||data[3]!==0x0e||
     new TextDecoder('utf-16le').decode(data.subarray(4,32))!=='SketchUp Model')throw Error('This is not a supported SketchUp SKP header.');
  const entries=new Map<string,SKPZipEntry>();let offset=zipOffset;
  for(let i=0;i<count;i++){
    if(offset+46>eocd||view.getUint32(offset,true)!==0x02014b50)throw Error('SKP ZIP central directory is corrupted.');
    const method=view.getUint16(offset+10,true),compressed=view.getUint32(offset+20,true),uncompressed=view.getUint32(offset+24,true),nameLength=view.getUint16(offset+28,true),extra=view.getUint16(offset+30,true),comment=view.getUint16(offset+32,true),localOffset=view.getUint32(offset+42,true);
    if(offset+46+nameLength+extra+comment>eocd||localOffset===0xffffffff)throw Error('SKP ZIP entry is invalid.');
    const name=new TextDecoder('utf-8',{fatal:true}).decode(data.subarray(offset+46,offset+46+nameLength));
    if(entries.has(name))throw Error('SKP ZIP contains duplicate entry names.');entries.set(name,{offset:base+localOffset,compressed,uncompressed,method});offset+=46+nameLength+extra+comment;
  }
  return entries;
}
async function skpZipFile(buffer:ArrayBuffer,entry:SKPZipEntry):Promise<ArrayBuffer>{
  const view=new DataView(buffer),offset=entry.offset;if(offset<0||offset+30>buffer.byteLength||view.getUint32(offset,true)!==0x04034b50)throw Error('SKP ZIP local entry is invalid.');
  const name=view.getUint16(offset+26,true),extra=view.getUint16(offset+28,true),start=offset+30+name+extra;
  if(entry.uncompressed>SKP_IMPORT_POLICY.maxModelBytes||start+entry.compressed>buffer.byteLength)throw Error('SKP model.dat exceeds safe size limits.');
  if(view.getUint16(offset+8,true)!==entry.method||(view.getUint16(offset+6,true)&1))throw Error('SKP ZIP entry uses unsupported encryption or inconsistent compression.');
  const bytes=new Uint8Array(buffer,start,entry.compressed);let result:ArrayBuffer;
  if(entry.method===0){result=bytes.slice().buffer;}
  else if(entry.method===8){
    if(typeof DecompressionStream==='undefined')throw Error('Your browser cannot decompress SKP ZIP data.');
    try{const stream=new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw')),reader=stream.getReader(),parts:Uint8Array<ArrayBuffer>[]= [];let total=0;
      for(;;){const chunk=await reader.read();if(chunk.done)break;total+=chunk.value.byteLength;if(total>entry.uncompressed||total>SKP_IMPORT_POLICY.maxModelBytes){await reader.cancel();throw Error('SKP ZIP decompression exceeds the declared size.');}parts.push(new Uint8Array(chunk.value));}
      const output=new Uint8Array(total);let p=0;for(const part of parts){output.set(part,p);p+=part.byteLength;}result=output.buffer;}
    catch(error){throw Error('Could not decompress SKP model.dat: '+(error instanceof Error?error.message:String(error)));}
  }else throw Error(`SKP uses unsupported ZIP compression method ${entry.method}.`);
  if(result.byteLength!==entry.uncompressed)throw Error('SKP ZIP model.dat uncompressed size mismatch.');return result;
}
// SketchUp occasionally writes slightly warped n-gons. For closed solids,
// splitting must remain all-or-nothing: no solid face can be silently omitted.
// For limited open surfaces, a damaged polygon may be excluded individually
// without losing the independent valid polygons in its original surface group.
// Never move a source vertex or replace its boundary with guessed geometry.
interface SKPWarpedSurfaceResult {project:ProjectSolid;split:number;skipped:{id:string;reason:string}[];retainedHoleRims:number;}
function skpTriangulateNonPlanarFaces(project:ProjectSolid,limitedOpenSurface=false):SKPWarpedSurfaceResult{
  const byId=new Map(project.vertices.map(vertex=>[vertex.id,vertex.position] as const));
  const fixed:ProjectSolid['faces']=[];const skipped:{id:string;reason:string}[]=[];let split=0,retainedHoleRims=0;
  for(const face of project.faces){
    try{
      const points=face.outer.map(id=>byId.get(id)!);
      if(points.length<=3){fixed.push(face);continue;}
      const plane=planeFromPoints(points);
      const outerDistance=Math.max(...points.map(point=>Math.abs(V.dot(plane.normal,point)-plane.offset)));
      const holeDistance=Math.max(0,...face.holes.flatMap(ring=>ring.map(id=>Math.abs(V.dot(plane.normal,byId.get(id)!)-plane.offset))));
      if(outerDistance<=TOL.plane && holeDistance<=TOL.plane){fixed.push(face);continue;}
      // An otherwise planar open sheet can have a hole rim a few dozen
      // micrometres outside its support plane, due to SketchUp's own numeric
      // coordinates. Its true corner positions can still be retained: the
      // limited surface renderer triangulates the planar domain and lifts the
      // rim back onto its original 3D vertices. Solid import stays strict.
      if(limitedOpenSurface&&face.holes.length&&outerDistance<=TOL.plane&&holeDistance<=TOL.plane*100){
        fixed.push(face);retainedHoleRims++;continue;
      }
      if(face.holes.length)throw Error(`Non-planar SKP face ${face.id} with holes cannot be safely split.`);
      if(points.length>256)throw Error(`Non-planar SKP face ${face.id} has too many boundary vertices.`);
      const basis=planeBasis(plane,points[0]),flat=points.map(point=>toPlane2(point,basis));
      // Ear clipping can choose a nearly collinear first ear even when the
      // polygon admits a completely sound triangulation. Try other cyclic
      // start positions rather than dropping corners or moving vertices.
      // The same strict original-boundary edge checks apply to every trial.
      const originalCount=points.length;
      let triangles:number[][]|null=null,bestArea=-1;
      const candidates=Math.min(originalCount,64);
      for(let attempt=0;attempt<candidates;attempt++){
        const offset=Math.floor(attempt*originalCount/candidates);
        const order=points.map((_,i)=>(i+offset)%originalCount);
        let proposal:[number,number,number][];
        try{proposal=triangulateSimple2(order.map(i=>flat[i]),1e-12);}catch{continue;}
        if(proposal.length!==originalCount-2)continue;
        const candidateTriangles=proposal.map(t=>t.map(i=>order[i]));
        const edgeCounts=new Map<string,number>();let minArea=Infinity,valid=true;
        for(const triangle of candidateTriangles){
          const a=points[triangle[0]],b=points[triangle[1]],c=points[triangle[2]];
          const area=V.len(V.cross(V.sub(b,a),V.sub(c,a)));
          minArea=Math.min(minArea,area);
          if(area<=TOL.minimumFaceArea*2||V.len(V.sub(a,b))<TOL.minimumEdge||
             V.len(V.sub(b,c))<TOL.minimumEdge||V.len(V.sub(c,a))<TOL.minimumEdge){valid=false;break;}
          for(let k=0;k<3;k++){
            const x=triangle[k],y=triangle[(k+1)%3],key=x<y?`${x}/${y}`:`${y}/${x}`;
            edgeCounts.set(key,(edgeCounts.get(key)||0)+1);
          }
        }
        if(!valid)continue;
        for(let i=0;i<originalCount;i++){
          const a=i,b=(i+1)%originalCount,key=a<b?`${a}/${b}`:`${b}/${a}`;
          if(edgeCounts.get(key)!==1){valid=false;break;}
        }
        if(!valid)continue;
        for(const [key,count] of edgeCounts){
          const [a,b]=key.split('/').map(Number);
          if(b===(a+1)%originalCount||a===(b+1)%originalCount)continue;
          if(count!==2){valid=false;break;}
        }
        if(valid&&minArea>bestArea){triangles=candidateTriangles;bestArea=minArea;}
        // Avoid extra triangulation work when the original ordering is sound;
        // alternative trials exist only to recover genuinely rejected faces.
        if(valid&&attempt===0)break;
      }
      if(!triangles)throw Error(`Non-planar SKP face ${face.id} cannot be triangulated without degenerate triangles or changing its boundary.`);
      const reverse=v2.area(flat)<0;
      for(let i=0;i<triangles.length;i++){
        const ids=triangles[i].map(index=>face.outer[index]);
        fixed.push({...face,id:`${face.id}_tri${i+1}`,outer:reverse?ids.reverse():ids,holes:[]});
      }
      split++;
    }catch(error){
      if(!limitedOpenSurface)throw error;
      skipped.push({id:face.id,reason:errorMessage(error)});
    }
  }
  const used=new Set<string>();for(const face of fixed)for(const ring of [face.outer,...face.holes])for(const id of ring)used.add(id);
  const repaired=split||skipped.length?{...project,vertices:project.vertices.filter(v=>used.has(v.id)),faces:fixed}:project;
  return {project:repaired,split,skipped,retainedHoleRims};
}
// SketchUp permits faces to have independent front/back orientation. A closed
// orientable shell does not necessarily arrive with consistently wound faces.
// Reconcile face directions through their shared edges before constructing the
// strict LamjaCraft half-edge representation; then choose outward winding by
// signed volume. Preserve all source polygon boundaries and hole loops.
function skpSplitClosedSolids(body:SKPBody,transform:number[],name:string,warnings:Set<string>,scale:number):MeshImportItem[]{
  if(!body.faces.length)return [];
  type Use={face:number;forward:boolean};
  const edgeUses=new Map<string,Use[]>();
  for(let i=0;i<body.faces.length;i++)for(const ring of [body.faces[i].outer,...body.faces[i].holes])for(let j=0;j<ring.length;j++){
    const a=ring[j],b=ring[(j+1)%ring.length],forward=a<b,key=forward?`${a}/${b}`:`${b}/${a}`,uses=edgeUses.get(key)||[];
    uses.push({face:i,forward});edgeUses.set(key,uses);
  }
  const adjacency=body.faces.map(()=>[] as {face:number;xorFlip:boolean}[]);
  for(const uses of edgeUses.values())if(uses.length===2&&uses[0].face!==uses[1].face){
    // Equal edge directions require exactly one of these faces to be reversed.
    const xorFlip=uses[0].forward===uses[1].forward;
    adjacency[uses[0].face].push({face:uses[1].face,xorFlip});
    adjacency[uses[1].face].push({face:uses[0].face,xorFlip});
  }
  const visited=new Set<number>(),items:MeshImportItem[]=[];let skipped=0,rewound=0,outwardReversed=0;
  for(let seed=0;seed<body.faces.length;seed++){
    if(visited.has(seed))continue;
    const queue=[seed],flip=new Map<number,boolean>([[seed,false]]);visited.add(seed);let orientable=true;
    for(let k=0;k<queue.length;k++)for(const next of adjacency[queue[k]]){
      const required=!!(flip.get(queue[k])!==next.xorFlip);
      if(!visited.has(next.face)){visited.add(next.face);flip.set(next.face,required);queue.push(next.face);}
      else if(flip.get(next.face)!==required)orientable=false;
    }
    const usedFaces=new Set(queue),usedVertices=new Set<number>();let closed=orientable;
    for(const index of queue)for(const ring of [body.faces[index].outer,...body.faces[index].holes])for(let j=0;j<ring.length;j++){
      const a=ring[j],b=ring[(j+1)%ring.length],key=a<b?`${a}/${b}`:`${b}/${a}`,uses=edgeUses.get(key)||[];
      if(uses.length!==2||uses[0].face===uses[1].face||!uses.every(use=>usedFaces.has(use.face)))closed=false;
      usedVertices.add(a);
    }
    if(!closed){
      const usedVertices=new Set<number>();
      for(const index of queue)for(const ring of [body.faces[index].outer,...body.faces[index].holes])for(const id of ring)usedVertices.add(id);
      const mirror=skpMirrored(transform);
      const project:ProjectSolid={schema:'poly-brep-1',id:'skp-surface',metadata:{name},
        vertices:[...usedVertices].map(id=>({id:'v'+id,position:skpPoint(transform,body.vertices.get(id)!,scale)})),
        faces:queue.map((index,i)=>({id:'f'+(i+1),outer:(mirror?[...body.faces[index].outer].reverse():body.faces[index].outer).map(id=>'v'+id),
          holes:body.faces[index].holes.map(ring=>(mirror?[...ring].reverse():ring).map(id=>'v'+id)),provenance:{kind:'import',label:'SKP open surface'}}))};
      try{
        const fixed=skpTriangulateNonPlanarFaces(project,true);
        if(!fixed.project.faces.length)throw Error('SKP surface has no valid drawable faces.');
        const solid=deserializeProjectSurface(fixed.project);
        items.push({solid,name,color:'#b7cec9',triangleCount:0,kind:'surface'});
        if(fixed.split)warnings.add(`Triangulated ${fixed.split} warped open SKP polygon(s), retaining their boundary positions.`);
        if(fixed.retainedHoleRims)warnings.add(`Preserved ${fixed.retainedHoleRims} open SKP face(s) with near-planar hole rims, without shifting their vertices.`);
        if(fixed.skipped.length)warnings.add(`Recovered ${fixed.project.faces.length} faces from an open SKP group; omitted ${fixed.skipped.length} unsafe polygon(s): ${fixed.skipped.map(f=>f.reason).join(' | ')}`);
      }catch(error){warnings.add(`An SKP surface was not imported: ${errorMessage(error)}`);skipped++;}
      if(items.length>SKP_IMPORT_POLICY.maxOutputSolids)throw Error('SKP has too many solids and surface objects.');
      continue;
    }
    const first=usedVertices.values().next().value as number,center=body.vertices.get(first)!;
    // Fan triangulation about an arbitrary polygon vertex gives its signed
    // contribution, including concave outlines and negatively wound holes.
    // Subtract a shared reference position to avoid catastrophic cancellation
    // for SketchUp geometry far from the model origin.
    let signedSixVolume=0;
    for(const index of queue){
      const source=body.faces[index],sign=flip.get(index)?-1:1;
      for(const ring of [source.outer,...source.holes]){
        const p0=body.vertices.get(ring[0])!,ax=p0[0]-center[0],ay=p0[1]-center[1],az=p0[2]-center[2];
        for(let j=1;j<ring.length-1;j++){
          const p1=body.vertices.get(ring[j])!,p2=body.vertices.get(ring[j+1])!;
          const bx=p1[0]-center[0],by=p1[1]-center[1],bz=p1[2]-center[2],cx=p2[0]-center[0],cy=p2[1]-center[1],cz=p2[2]-center[2];
          signedSixVolume+=sign*(ax*(by*cz-bz*cy)+ay*(bz*cx-bx*cz)+az*(bx*cy-by*cx));
        }
      }
    }
    const outwardFlip=signedSixVolume<0,mirrorFlip=skpMirrored(transform);
    const vertices=[...usedVertices].map(id=>({id:'v'+id,position:skpPoint(transform,body.vertices.get(id)!,scale)}));
    const faces=queue.map((index,i)=>{
      const source=body.faces[index],reverse=(flip.get(index)!==outwardFlip)!==mirrorFlip;
      const orient=(ring:number[])=>{const ids=ring.map(id=>'v'+id);return reverse?ids.reverse():ids;};
      return {id:'f'+(i+1),outer:orient(source.outer),holes:source.holes.map(orient),provenance:{kind:'import' as const,label:'SKP'}};
    });
    const project:ProjectSolid={schema:'poly-brep-1',id:'skp-solid',metadata:{name},vertices,faces};
    try{
      const fixed=skpTriangulateNonPlanarFaces(project);
      const solid=deserializeProjectSolid(fixed.project);items.push({solid,name,color:'#b7cec9',triangleCount:0});
      if(fixed.split)warnings.add(`Triangulated ${fixed.split} slightly non-planar SKP face(s) without moving vertices.`);
      if([...flip.values()].some(value=>value))rewound++;
      if(outwardFlip)outwardReversed++;
    }catch(error){warnings.add(`An SKP shell was not imported: ${errorMessage(error)}`);skipped++;}
    if(items.length>SKP_IMPORT_POLICY.maxOutputSolids)throw Error('SKP has too many separate solids.');
  }
  if(rewound)warnings.add(`Corrected inconsistent face directions in ${rewound} SKP shell(s).`);
  if(outwardReversed)warnings.add(`Reoriented ${outwardReversed} inward-facing SKP shell(s) to outward-facing solids.`);
  if(skipped)warnings.add(`${skipped} invalid SKP surface group${skipped===1?'':'s'} could not be imported.`);
  return items;
}
// Count closed topological shells before constructing expensive LamjaCraft B-reps.
// This is a candidate count, not a guarantee that all shells will pass validation.
// Repeated SketchUp component placements each contribute their own object(s).
function skpCandidateShells(body:SKPBody):number{
  if(!body.faces.length)return 0;
  const owners=new Map<string,number[]>();
  for(let i=0;i<body.faces.length;i++)for(const ring of [body.faces[i].outer,...body.faces[i].holes])for(let j=0;j<ring.length;j++){
    const a=ring[j],b=ring[(j+1)%ring.length],key=a<b?`${a}/${b}`:`${b}/${a}`;
    const found=owners.get(key);if(found)found.push(i);else owners.set(key,[i]);
  }
  const neighbours=body.faces.map(()=>[] as number[]);
  const openFace=new Uint8Array(body.faces.length);
  for(const connected of owners.values()){
    if(connected.length!==2){for(const index of connected)openFace[index]=1;continue;}
    neighbours[connected[0]].push(connected[1]);neighbours[connected[1]].push(connected[0]);
  }
  const seen=new Uint8Array(body.faces.length);let count=0;
  for(let i=0;i<body.faces.length;i++){
    if(seen[i])continue;
    const queue=[i];seen[i]=1;let closed=true;
    for(let pos=0;pos<queue.length;pos++){
      const face=queue[pos];if(openFace[face])closed=false;
      for(const next of neighbours[face])if(!seen[next]){seen[next]=1;queue.push(next);}
    }
    if(closed)count++;
  }
  return count;
}
async function prepareSKPImport(buffer:ArrayBuffer,fileName:string,report?:(progress:number,message:string)=>void,scale=1):Promise<MeshImportResult>{
  if(!Number.isFinite(scale)||scale<=0||scale>100)throw Error('SKP import scale is invalid.');
  if(buffer.byteLength>SKP_IMPORT_POLICY.maxArchiveBytes)throw Error('SKP exceeds the 256 MB import limit.');
  const header=legacySKPCheckHeader(buffer);
  if(header&&header.version<21)return prepareLegacySKPImport(buffer,fileName,report,scale);
  report?.(3,'Opening SKP container…');const archive=skpZipDirectory(buffer),entry=archive.get('model.dat');if(!entry)throw Error('No model.dat found: this is not a supported modern SKP file. SketchUp 2021 or later is required.');
  const model=await skpZipFile(buffer,entry),view=new DataView(model);report?.(17,'Reading SKP geometry…');
  const roots=skpRecords(view,0,view.byteLength);if(roots.length!==1||roots[0].tag!==0x01f4)throw Error('SKP model.dat does not contain a known modern model record.');
  const root=roots[0],own=skpNested(view,root,[0x01f6,0x1388]);if(!own)throw Error('SKP model has no root entity collection.');
  const definitions=new Map<number,SKPDefinition>();
  // Definition pools can themselves be repeated. Never use only the first
  // definition list, since nested/copy-heavy models may split them across pools.
  for(const group of skpChildren(view,root,0x01f9))for(const collection of skpChildren(view,group,0x1770))for(const list of skpChildren(view,collection,0x1771))for(const record of skpChildren(view,list,0x157c)){
    const entity=skpChild(view,record,0x1388);if(!entity)continue;const id=skpDrawingId(view,entity);
    if(definitions.has(id))throw Error('SKP contains duplicate component definitions.');
    definitions.set(id,{id,name:skpUtf8(view,skpChild(view,record,0x157e)),entity});
  }
  const bodyCache=new Map<number,SKPBody>(),bodyFor=(entity:SKPRecord)=>{let body=bodyCache.get(entity.start);if(!body){body=skpReadBody(view,entity);bodyCache.set(entity.start,body);}return body;};
  const warnings=new Set<string>(),items:MeshImportItem[]=[],baseName=fileName.replace(/\.skp$/i,'').slice(0,72)||'Imported SKP';let visitedInstances=0,looseEdges=false;
  // Preflight enumerates every visible component placement and caches shell counts
  // for repeated definitions. The count remains available even if capacity fails.
  const candidateCache=new Map<number,number>(),definitionPlacements=new Map<number,number>();let candidateSolids=0,candidateInstances=0,nestedGroupPlacements=0,inlineGroupPlacements=0,maxNestingDepth=0;
  function resolvePlacement(placement:SKPPlacement):{entity:SKPRecord;name:string;key:number|undefined}{
    if(placement.inlineEntity)return {entity:placement.inlineEntity,name:placement.name||'Group',key:undefined};
    const def=placement.definition===undefined?undefined:definitions.get(placement.definition);
    if(!def)throw Error(`SKP references a missing component/group definition (${placement.definition??'none'}).`);
    return {entity:def.entity,name:placement.name||def.name||'Component',key:def.id};
  }
  function countCandidates(entity:SKPRecord,stack:Set<number>,depth:number):void{
    if(depth>SKP_IMPORT_POLICY.maxDepth)throw Error('SKP nested components exceed the safe depth limit.');
    maxNestingDepth=Math.max(maxNestingDepth,depth);
    const body=bodyFor(entity);let shells=candidateCache.get(entity.start);
    if(shells===undefined){shells=skpCandidateShells(body);candidateCache.set(entity.start,shells);}
    candidateSolids+=shells;
    if(!Number.isSafeInteger(candidateSolids))throw Error('SKP object count exceeds the supported integer range.');
    for(const instance of body.instances){
      if(instance.hidden)continue;
      if(++candidateInstances>SKP_IMPORT_POLICY.maxInstances)throw Error(`SKP has more than ${SKP_IMPORT_POLICY.maxInstances} visible component instances.`);
      const child=resolvePlacement(instance);
      if(child.key!==undefined&&stack.has(child.key))throw Error('SKP contains a cyclic component hierarchy.');
      if(instance.group)nestedGroupPlacements++;
      if(instance.inlineEntity)inlineGroupPlacements++;
      if(child.key!==undefined)definitionPlacements.set(child.key,(definitionPlacements.get(child.key)||0)+1);
      const childStack=new Set(stack);if(child.key!==undefined)childStack.add(child.key);
      countCandidates(child.entity,childStack,depth+1);
    }
  }
  report?.(27,'Counting SKP components and closed shells…');countCandidates(own,new Set(),0);
  if(candidateSolids>SKP_IMPORT_POLICY.maxOutputSolids)throw Error(`SKP contains approximately ${candidateSolids.toLocaleString('en-US')} closed geometry shells in ${candidateInstances.toLocaleString('en-US')} visible component placements (before validation). The SKP import limit is ${SKP_IMPORT_POLICY.maxOutputSolids.toLocaleString('en-US')} solids per import. Split the SketchUp model into smaller files or remove unneeded components.`);
  report?.(38,`Checking ${candidateSolids.toLocaleString('en-US')} potential SKP solids…`);
  function visit(entity:SKPRecord,transform:number[],label:string,stack:Set<number>,depth:number):void{
    if(depth>SKP_IMPORT_POLICY.maxDepth)throw Error('SKP nested components exceed the safe depth limit.');
    const body=bodyFor(entity);if(body.edges.size>0&&!body.faces.length)looseEdges=true;
    const solids=skpSplitClosedSolids(body,transform,label,warnings,scale);
    items.push(...solids);if(items.length>SKP_IMPORT_POLICY.maxOutputSolids)throw Error(`SKP produced more than ${SKP_IMPORT_POLICY.maxOutputSolids} valid solids (the project supports ${PROJECT_CAPACITY_POLICY.maximumObjects} objects in total).`);
    for(const instance of body.instances){
      if(instance.hidden)continue;
      if(++visitedInstances>SKP_IMPORT_POLICY.maxInstances)throw Error('SKP has too many component instances.');
      const child=resolvePlacement(instance);
      if(child.key!==undefined&&stack.has(child.key))throw Error('SKP contains a cyclic component hierarchy.');
      const childLabel=(child.name||label).slice(0,72),childStack=new Set(stack);
      if(child.key!==undefined)childStack.add(child.key);
      visit(child.entity,skpCombineTransform(transform,instance.transform),childLabel,childStack,depth+1);
    }
  }
  visit(own,skpIdentity(),baseName,new Set(),0);report?.(88,'Validating LamjaCraft solids…');
  if(!items.length)throw Error('SKP contained no valid solid or drawable polygon surfaces.');
  // LamjaCraft objects are independent: no links back to their source SketchUp
  // definition, and every object has its own cloned solid on commit. Distinct
  // names help users identify repeated placements in the Objects panel.
  const usedNames=new Set<string>(),baseNameCounters=new Map<string,number>();
  for(const item of items){
    const original=item.name;let sequence=baseNameCounters.get(original)||0,unique='';
    do{sequence++;const suffix=sequence===1?'':` (copy ${sequence})`;unique=original.slice(0,Math.max(1,72-suffix.length))+suffix;}while(usedNames.has(unique));
    baseNameCounters.set(original,sequence);usedNames.add(unique);item.name=unique;
  }
  const repeatedInstances=[...definitionPlacements.values()].reduce((total,n)=>total+Math.max(0,n-1),0);
  warnings.add(`SKP scan: ${candidateSolids.toLocaleString('en-US')} candidate closed shell(s), ${candidateInstances.toLocaleString('en-US')} visible component placement(s), including ${repeatedInstances.toLocaleString('en-US')} reused definition placement(s) and ${nestedGroupPlacements.toLocaleString('en-US')} group placement(s) (${inlineGroupPlacements.toLocaleString('en-US')} inline); maximum nesting depth ${maxNestingDepth}; ${items.filter(item=>item.kind!=='surface').length.toLocaleString('en-US')} solids and ${items.filter(item=>item.kind==='surface').length.toLocaleString('en-US')} open surface objects.`);
  if(looseEdges)warnings.add('Loose SketchUp edges without faces are not imported.');
  warnings.add(scale===1?'SKP coordinates in inches were converted to millimetres at their true physical size.':'SKP geometry was rescaled by '+scale+' after inches-to-millimetres conversion; this deliberately changes the physical model size to match unitless STL coordinates.');
  warnings.add('Open SKP polygon surfaces are imported as limited, non-solid objects; SketchUp textures, layers, per-face materials and annotations are not imported.');
  report?.(100,'SKP geometry check complete');
  return {format:'skp',items,triangleCount:items.reduce((n,item)=>n+item.solid.faces.size,0),warnings:[...warnings],repairedOpenings:0};
}
