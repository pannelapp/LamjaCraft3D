// Exchange encoding only: canonical topology is read through geometryApi / SceneGeometry.
type ExchangeFormat='stl'|'obj'|'step';
interface ExchangeControl { report:(progress:number,message:string)=>void; isCancelled:()=>boolean; }
const EXCHANGE_POLICY=Object.freeze({maximumBytes:750_000_000,textChunkLines:512,checkpointItems:1024,crcChunkBytes:262144});
class ExportCancelledError extends Error {constructor(){super('Export cancelled.');}}
function checkExchangeCancellation(control:ExchangeControl){if(control.isCancelled())throw new ExportCancelledError();}
async function yieldExchange(control:ExchangeControl){checkExchangeCancellation(control);await new Promise<void>(resolve=>setTimeout(resolve,0));checkExchangeCancellation(control);}
function exchangeNumber(value:number):string {if(!Number.isFinite(value))throw Error('Export contains a non-finite number.');return Object.is(value,-0)?'0':String(value);}
class ExchangeText {
  readonly chunks:Uint8Array<ArrayBuffer>[]=[];
  byteLength=0;
  private lines:string[]=[];
  line(value:string){this.lines.push(value+'\n');if(this.lines.length>=EXCHANGE_POLICY.textChunkLines)this.flush();}
  flush(){if(!this.lines.length)return;const bytes=new TextEncoder().encode(this.lines.join(''));this.byteLength+=bytes.byteLength;if(this.byteLength>EXCHANGE_POLICY.maximumBytes)throw Error('Export is too large for a reliable in-browser download. Export fewer objects.');this.chunks.push(bytes);this.lines=[];}
}
function exchangeObjectName(name:string,index:number):string{return `${name.replace(/[\u0000-\u0020#\\]/g,'_')||'Object'}_${index+1}`;}
async function objPackageAsync(list:readonly ModelObject[],control:ExchangeControl):Promise<Blob> {
  if(!list.length)throw Error('There are no objects to export.');
  const obj=new ExchangeText(),mtl=new ExchangeText();obj.line('# LamjaCraft 3D | coordinates in millimetres (mm)');obj.line('# Blender: use import Scale 0.001 for a metre-based scene.');obj.line('mtllib model.mtl');obj.line('s off');mtl.line('# LamjaCraft 3D | object colours');
  let vertexOffset=0,normalOffset=0;
  for(let i=0;i<list.length;i++){
    control.report(2+90*i/list.length,`Preparing OBJ · object ${i+1} of ${list.length}`);await yieldExchange(control);
    const object=list[i],mesh=sceneGeometry.exportMesh(object),stats=triangleMeshEdgeStats(mesh);
    if(!mesh.triangles.length||stats.boundary||stats.nonManifold)throw Error(`“${object.name}” is not a closed OBJ mesh (open edges: ${stats.boundary}, non-manifold edges: ${stats.nonManifold}).`);
    if(!/^#[\da-f]{6}$/i.test(object.color))throw Error(`“${object.name}” has an invalid colour.`);
    const material=`material_${i+1}`,colour=[1,3,5].map(start=>parseInt(object.color.slice(start,start+2),16)/255);
    mtl.line(`newmtl ${material}`);mtl.line(`Kd ${colour.map(exchangeNumber).join(' ')}`);mtl.line('Ka 0 0 0');mtl.line('Ks 0 0 0');mtl.line('d 1');mtl.line('illum 1');
    obj.line(`o ${exchangeObjectName(object.name,i)}`);obj.line(`usemtl ${material}`);
    for(let j=0;j<mesh.vertices.length;j++){obj.line('v '+mesh.vertices[j].map(exchangeNumber).join(' '));if(j%EXCHANGE_POLICY.checkpointItems===0)await yieldExchange(control);}
    for(let j=0;j<mesh.triangles.length;j++){
      const triangle=mesh.triangles[j],points=triangle.map(index=>{const p=mesh.vertices[index];if(!p)throw Error('OBJ contains an invalid triangle index.');return p;});
      const normal=V.unit(V.cross(V.sub(points[1],points[0]),V.sub(points[2],points[0])));
      obj.line('vn '+normal.map(exchangeNumber).join(' '));
      obj.line('f '+triangle.map(index=>`${vertexOffset+index+1}//${normalOffset+j+1}`).join(' '));
      if(j%EXCHANGE_POLICY.checkpointItems===0){control.report(2+90*(i+j/mesh.triangles.length)/list.length,'Writing OBJ faces…');await yieldExchange(control);}
    }
    vertexOffset+=mesh.vertices.length;normalOffset+=mesh.triangles.length;
  }
  obj.flush();mtl.flush();control.report(94,'Packaging OBJ and materials…');
  const blob=await storedExchangeZip([{name:'model.obj',text:obj},{name:'model.mtl',text:mtl}],control);
  control.report(100,'OBJ package ready');await yieldExchange(control);return blob;
}
async function storedExchangeZip(entries:readonly {name:string;text:ExchangeText}[],control:ExchangeControl):Promise<Blob> {
  // ZIP32, stored entries, UTF-8 names. One download keeps the OBJ and its MTL together.
  const parts:BlobPart[]=[],central:Uint8Array<ArrayBuffer>[]=[],encoder=new TextEncoder();let offset=0,centralBytes=0;
  const crcTable=new Uint32Array(256);for(let i=0;i<256;i++){let crc=i;for(let bit=0;bit<8;bit++)crc=(crc&1)?0xedb88320^(crc>>>1):crc>>>1;crcTable[i]=crc;}
  for(const entry of entries){
    const name=encoder.encode(entry.name),size=entry.text.byteLength;let crc=0xffffffff,sinceYield=0;
    for(const bytes of entry.text.chunks){for(const byte of bytes){crc=crcTable[(crc^byte)&255]^(crc>>>8);if(++sinceYield>=EXCHANGE_POLICY.crcChunkBytes){sinceYield=0;await yieldExchange(control);}}}
    crc=(crc^0xffffffff)>>>0;
    const header=new Uint8Array(30+name.length),h=new DataView(header.buffer);h.setUint32(0,0x04034b50,true);h.setUint16(4,20,true);h.setUint16(6,0x0800,true);h.setUint16(12,10273,true);h.setUint32(14,crc,true);h.setUint32(18,size,true);h.setUint32(22,size,true);h.setUint16(26,name.length,true);header.set(name,30);
    const directory=new Uint8Array(46+name.length),d=new DataView(directory.buffer);d.setUint32(0,0x02014b50,true);d.setUint16(4,20,true);d.setUint16(6,20,true);d.setUint16(8,0x0800,true);d.setUint16(14,10273,true);d.setUint32(16,crc,true);d.setUint32(20,size,true);d.setUint32(24,size,true);d.setUint16(28,name.length,true);d.setUint32(42,offset,true);directory.set(name,46);
    parts.push(header,...entry.text.chunks);central.push(directory);centralBytes+=directory.length;offset+=header.length+size;
    if(offset+centralBytes+22>EXCHANGE_POLICY.maximumBytes)throw Error('The OBJ package exceeds the in-browser export budget.');await yieldExchange(control);
  }
  const end=new Uint8Array(22),view=new DataView(end.buffer);view.setUint32(0,0x06054b50,true);view.setUint16(8,entries.length,true);view.setUint16(10,entries.length,true);view.setUint32(12,centralBytes,true);view.setUint32(16,offset,true);
  return new Blob([...parts,...central,end],{type:'application/zip'});
}
function stepString(value:string):string {
  // STEP Part 21 uses ASCII text with UTF-16 escape runs for other characters.
  let text="'",unicode='';const flush=()=>{if(unicode){text+='\\X2\\'+unicode+'\\X0\\';unicode='';}};
  for(let i=0;i<value.length;i++){const code=value.charCodeAt(i);if(code>=32&&code<=126){flush();const char=value[i];text+=char==="'"?"''":char==='\\'?'\\\\':char;}else unicode+=code.toString(16).toUpperCase().padStart(4,'0');}flush();return text+"'";
}
function stepReal(value:number):string {const text=exchangeNumber(value).toUpperCase(),parts=text.split('E');return (parts[0].includes('.')?parts[0]:parts[0]+'.')+(parts.length===2?'E'+parts[1]:'');}
async function stepFileAsync(list:readonly ModelObject[],fileName:string,control:ExchangeControl):Promise<Blob> {
  if(!list.length)throw Error('There are no objects to export.');
  const output=new ExchangeText();let entityCount=0;
  const entity=(value:string)=>{const id='#'+(++entityCount);output.line(`${id}=${value};`);return id;},refs=(ids:readonly string[])=>'('+ids.join(',')+')';
  output.line('ISO-10303-21;');output.line('HEADER;');output.line("FILE_DESCRIPTION(('LamjaCraft 3D polyhedral solids'),'2;1');");output.line(`FILE_NAME(${stepString(fileName)},${stepString(new Date().toISOString())},(''),(''),'LamjaCraft 3D','LamjaCraft 3D','');`);output.line("FILE_SCHEMA(('CONFIG_CONTROL_DESIGN'));");output.line('ENDSEC;');output.line('DATA;');
  const application=entity("APPLICATION_CONTEXT('configuration controlled 3d designs of mechanical parts and assemblies')");entity(`APPLICATION_PROTOCOL_DEFINITION('international standard','config_control_design',1994,${application})`);
  const productContext=entity(`PRODUCT_CONTEXT('',${application},'mechanical')`),definitionContext=entity(`PRODUCT_DEFINITION_CONTEXT('part definition',${application},'design')`);
  const mm=entity('(LENGTH_UNIT() NAMED_UNIT(*) SI_UNIT(.MILLI.,.METRE.))'),radian=entity('(NAMED_UNIT(*) PLANE_ANGLE_UNIT() SI_UNIT($,.RADIAN.))'),steradian=entity('(NAMED_UNIT(*) SI_UNIT($,.STERADIAN.) SOLID_ANGLE_UNIT())');
  const uncertainty=entity(`UNCERTAINTY_MEASURE_WITH_UNIT(LENGTH_MEASURE(${stepReal(TOL.plane)}),${mm},'distance_accuracy_value','Canonical planarity tolerance')`);
  const context=entity(`(GEOMETRIC_REPRESENTATION_CONTEXT(3) GLOBAL_UNCERTAINTY_ASSIGNED_CONTEXT((${uncertainty})) GLOBAL_UNIT_ASSIGNED_CONTEXT((${mm},${radian},${steradian})) REPRESENTATION_CONTEXT('','3D'))`);
  const direction=(p:Vec3)=>entity(`DIRECTION('',(${p.map(stepReal).join(',')}))`);
  for(let i=0;i<list.length;i++){
    control.report(2+95*i/list.length,`Preparing STEP · object ${i+1} of ${list.length}`);await yieldExchange(control);
    const object=list[i],shape=geometryApi.exportPolyhedron(object.solid),pointIds:string[]=[],vertexIds:string[]=[],faceIds:string[]=[],shellIds:string[]=[],edges=new Map<string,{id:string;start:number}>();
    if([...object.transform.position,...object.transform.rotation].some(value=>!Number.isFinite(value)))throw Error(`“${object.name}” has an invalid transform.`);
    for(let j=0;j<shape.vertices.length;j++){const p=transformPoint(shape.vertices[j],object.transform);pointIds.push(entity(`CARTESIAN_POINT('',(${p.map(stepReal).join(',')}))`));vertexIds.push(entity(`VERTEX_POINT('',${pointIds[j]})`));if(j%EXCHANGE_POLICY.checkpointItems===0)await yieldExchange(control);}
    const innerFaces=new Set(shape.shells.filter(shell=>shell.signedVolume<0).flatMap(shell=>shell.faces));
    for(let j=0;j<shape.faces.length;j++){
      const face=shape.faces[j],reverse=innerFaces.has(j),loops=[face.outer,...face.holes],bounds:string[]=[];
      for(let k=0;k<loops.length;k++){
        const indices=reverse?[...loops[k]].reverse():loops[k],orientedEdges:string[]=[];
        for(let edgeIndex=0;edgeIndex<indices.length;edgeIndex++){
          const start=indices[edgeIndex],end=indices[(edgeIndex+1)%indices.length],key=start<end?`${start}:${end}`:`${end}:${start}`;let edge=edges.get(key);
          if(!edge){const delta=transformDir(V.sub(shape.vertices[end],shape.vertices[start]),object.transform),unit=direction(V.unit(delta)),vector=entity(`VECTOR('',${unit},${stepReal(V.len(delta))})`),line=entity(`LINE('',${pointIds[start]},${vector})`);edge={id:entity(`EDGE_CURVE('',${vertexIds[start]},${vertexIds[end]},${line},.T.)`),start};edges.set(key,edge);}
          orientedEdges.push(entity(`ORIENTED_EDGE('',*,*,${edge.id},${edge.start===start?'.T.':'.F.'})`));
        }
        const loop=entity(`EDGE_LOOP('',${refs(orientedEdges)})`);bounds.push(entity(`${k===0?'FACE_OUTER_BOUND':'FACE_BOUND'}('',${loop},.T.)`));
      }
      const normal=transformDir(reverse?V.mul(face.normal,-1):face.normal,object.transform),basis=planeBasis({normal,offset:0},[0,0,0]),axis=entity(`AXIS2_PLACEMENT_3D('',${pointIds[face.outer[0]]},${direction(normal)},${direction(basis.u)})`),plane=entity(`PLANE('',${axis})`);
      faceIds.push(entity(`ADVANCED_FACE('',${refs(bounds)},${plane},.T.)`));
      if(j%EXCHANGE_POLICY.checkpointItems===0){control.report(2+95*(i+j/shape.faces.length)/list.length,'Writing STEP faces…');await yieldExchange(control);}
    }
    for(const shell of shape.shells)shellIds.push(entity(`CLOSED_SHELL('',${refs(shell.faces.map(index=>faceIds[index]))})`));
    const outers=shape.shells.map((shell,index)=>({shell,index})).filter(value=>value.shell.signedVolume>0),voids=shape.shells.map((shell,index)=>({shell,index})).filter(value=>value.shell.signedVolume<0);
    // Disconnected solids without cavities are unambiguous. Multiple outers plus voids need
    // an explicit containment classifier; reject rather than silently filling or misassigning a cavity.
    if(!outers.length||voids.length&&outers.length!==1)throw Error(`“${object.name}” has ambiguous disconnected shells. Export its connected solids separately.`);
    const solids=outers.map(({index})=>{
      if(!voids.length)return entity(`MANIFOLD_SOLID_BREP(${stepString(object.name)},${shellIds[index]})`);
      const oriented=voids.map(value=>entity(`ORIENTED_CLOSED_SHELL('',*,${shellIds[value.index]},.F.)`));
      return entity(`BREP_WITH_VOIDS(${stepString(object.name)},${shellIds[index]},${refs(oriented)})`);
    });
    const product=entity(`PRODUCT(${stepString(object.id)},${stepString(object.name)},'',(${productContext}))`),formation=entity(`PRODUCT_DEFINITION_FORMATION('','',${product})`),definition=entity(`PRODUCT_DEFINITION('design','',${formation},${definitionContext})`),definitionShape=entity(`PRODUCT_DEFINITION_SHAPE('','',${definition})`),representation=entity(`ADVANCED_BREP_SHAPE_REPRESENTATION(${stepString(object.name)},${refs(solids)},${context})`);
    entity(`SHAPE_DEFINITION_REPRESENTATION(${definitionShape},${representation})`);await yieldExchange(control);
  }
  output.line('ENDSEC;');output.line('END-ISO-10303-21;');output.flush();control.report(100,'STEP ready');await yieldExchange(control);return new Blob(output.chunks,{type:'model/step'});
}
