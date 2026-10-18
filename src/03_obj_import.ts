// OBJ syntax is decoded here; editable mesh reconstruction reuses the STL kernel adapter.
interface MeshImportRequest {type:'mesh-import';format:'stl'|'obj';name:string;buffer:ArrayBuffer;materials:{name:string;text:string}[];scale:number;repairOpenings:boolean;keepTouchingPartsSeparate?:boolean;ignoreIsolatedOpenSurfaces?:boolean;}
interface MeshImportItem {solid:Solid;name:string;color:string;triangleCount:number;kind?:'solid'|'surface';}
interface MeshImportResult {format:'stl'|'obj'|'skp';items:MeshImportItem[];triangleCount:number;warnings:string[];repairedOpenings:number;}
const MESH_IMPORT_POLICY=Object.freeze({maximumFileBytes:256*1024*1024,maximumBatchBytes:512*1024*1024,maximumVertices:STL_IMPORT_POLICY.maxEditableVerticesPerShell,maximumPolygonVertices:4096,maximumMaterials:1024,maximumObjects:1000});
interface TriangleImportPart {name:string;triangles:Vec3[][];materials:string[];sourceGroup?:string;}
function importScale(scale:number){if(!Number.isFinite(scale)||scale<=0)throw Error('Import scale must be a finite positive number.');return scale;}
function parseOBJ(text:string,scale:number,defaultName:string):{parts:TriangleImportPart[];libraries:Set<string>;warnings:string[]} {
  importScale(scale);const vertices:Vec3[]=[],parts:TriangleImportPart[]=[],libraries=new Set<string>(),warnings=new Set<string>();let part:TriangleImportPart={name:defaultName,triangles:[],materials:[]},material='',textureCount=0,normalCount=0,totalTriangles=0;
  const number=(value:string,line:number)=>{if(!value||!/^[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?$/.test(value)||!Number.isFinite(Number(value)))throw Error(`OBJ line ${line}: invalid finite number.`);return Number(value);};
  const index=(value:string,count:number,line:number)=>{if(!/^[-+]?\d+$/.test(value))throw Error(`OBJ line ${line}: invalid index.`);const raw=Number(value),resolved=raw>0?raw-1:count+raw;if(!Number.isSafeInteger(raw)||raw===0||resolved<0||resolved>=count)throw Error(`OBJ line ${line}: index ${value} is out of range.`);return resolved;};
  const finish=()=>{if(part.triangles.length){parts.push(part);if(parts.length>MESH_IMPORT_POLICY.maximumObjects)throw Error('OBJ has too many objects.');}};
  const lines=text.replace(/\\\r?\n/g,' ').split(/\r?\n/);
  const explicitObjects=lines.some(line=>/^\s*o(?:\s|$)/.test(line));
  for(let lineIndex=0;lineIndex<lines.length;lineIndex++){
    const line=lines[lineIndex].replace(/#.*/,'').trim();if(!line)continue;const fields=line.split(/\s+/),kind=fields.shift()!,lineNumber=lineIndex+1;
    if(kind==='v'){
      if(![3,4,6,7].includes(fields.length))throw Error(`OBJ line ${lineNumber}: a vertex requires XYZ coordinates.`);
      const values=fields.map(value=>number(value,lineNumber));if((values.length===4||values.length===7)&&values[3]!==1)throw Error(`OBJ line ${lineNumber}: non-unit rational vertex weights are not supported.`);
      const point=values.slice(0,3).map(value=>value*scale) as Vec3;if(point.some(value=>!Number.isFinite(value)))throw Error('Scaled OBJ coordinate is not finite.');vertices.push(point);if(vertices.length>MESH_IMPORT_POLICY.maximumVertices)throw Error('OBJ has too many vertices.');if(values.length>=6)warnings.add('Per-vertex colours are not imported; object diffuse colours come from MTL.');
    }else if(kind==='vt'||kind==='vn'){
      if(kind==='vn'?fields.length!==3:fields.length<1||fields.length>3)throw Error(`OBJ line ${lineNumber}: invalid ${kind} record.`);fields.forEach(value=>number(value,lineNumber));if(kind==='vt')textureCount++;else normalCount++;
    }else if(kind==='f'){
      if(fields.length<3||fields.length>MESH_IMPORT_POLICY.maximumPolygonVertices)throw Error(`OBJ line ${lineNumber}: invalid polygon size.`);
      const points=fields.map(value=>{const refs=value.split('/');if(refs.length>3||!refs[0]||refs.length===2&&!refs[1]||refs.length===3&&!refs[2])throw Error(`OBJ line ${lineNumber}: malformed face reference.`);const vertex=index(refs[0],vertices.length,lineNumber);if(refs[1])index(refs[1],textureCount,lineNumber);if(refs[2])index(refs[2],normalCount,lineNumber);return vertices[vertex];});
      if(points.length>3){
        const plane=planeFromPoints(points),basis=planeBasis(plane,points[0]),flat=points.map(point=>toPlane2(point,basis));if(polygonSelfIntersects(flat))throw Error(`OBJ line ${lineNumber}: polygon self-intersects in its projection.`);
        if(points.some(point=>Math.abs(V.dot(plane.normal,point)-plane.offset)>TOL.plane))warnings.add('Non-planar polygons were triangulated; their original polygon surface is not uniquely defined.');
        for(const triangle of triangulateSimple2(flat)){part.triangles.push(triangle.map(i=>points[i]));part.materials.push(material);totalTriangles++;}
      }else{part.triangles.push(points);part.materials.push(material);totalTriangles++;}
      if(totalTriangles>STL_IMPORT_POLICY.maxTriangles)throw Error('OBJ exceeds the editable triangle budget.');
    }else if(kind==='o'){finish();part={name:fields.join(' ')||defaultName,triangles:[],materials:[]};}
    else if(kind==='g'&&!explicitObjects){finish();const name=fields.join(' ')||defaultName;part={name,sourceGroup:name,triangles:[],materials:[]};}
    else if(kind==='g'){}
    else if(kind==='usemtl')material=fields.join(' ');
    else if(kind==='mtllib'){const joined=fields.join(' '),references=(joined.match(/\.mtl(?:["']|\s|$)/gi)||[]).length===1?[joined.replace(/^(["'])(.*)\1$/,'$2')]:fields;for(const name of references)libraries.add(name.replaceAll('\\','/').split('/').pop()!);}
    else if(kind==='s'){}
    else if(kind==='l'||kind==='p')warnings.add('Line and point elements are not imported.');
    else throw Error(`OBJ line ${lineNumber}: unsupported record “${kind}”. Export polygon meshes first.`);
  }
  finish();if(!parts.length)throw Error('OBJ contains no polygon faces.');
  if(textureCount)warnings.add('UV coordinates and image textures are not imported.');
  return {parts,libraries,warnings:[...warnings]};
}
function parseMTLDiffuse(files:readonly {name:string;text:string}[],libraries:Set<string>):{colours:Map<string,string>;warnings:string[]} {
  const colours=new Map<string,string>(),names=new Set<string>(),warnings=new Set<string>(),available=new Set(files.map(file=>file.name));
  for(const name of libraries)if(!available.has(name))warnings.add(`Material library “${name}” was not selected; unmatched materials use the default colour.`);
  for(const file of files){
    if(!libraries.has(file.name)){warnings.add(`Unreferenced material file “${file.name}” was ignored.`);continue;}let current='';
    for(const raw of file.text.split(/\r?\n/)){const fields=raw.replace(/#.*/,'').trim().split(/\s+/),kind=fields.shift();if(kind==='newmtl'){current=fields.join(' ');if(!current||names.has(current))throw Error(`MTL “${file.name}” has an empty or duplicate material name.`);names.add(current);if(names.size>MESH_IMPORT_POLICY.maximumMaterials)throw Error('Too many MTL materials.');}
      else if(kind==='Kd'){if(!current)throw Error('MTL diffuse colour appears before a material name.');const rgb=fields.map(Number);if(rgb.length!==3||rgb.some(value=>!Number.isFinite(value)||value<0||value>1))throw Error(`MTL material “${current}” needs three diffuse values between 0 and 1.`);colours.set(current,'#'+rgb.map(value=>Math.round(value*255).toString(16).padStart(2,'0')).join(''));}
      else if(kind?.startsWith('map_'))warnings.add('MTL image textures are not imported; diffuse object colours are used.');
    }
  }
  return {colours,warnings:[...warnings]};
}
function triangleImportColour(part:TriangleImportPart,colours:Map<string,string>,warnings:Set<string>,indices:readonly number[]):string {
  const areas=new Map<string,number>();
  for(const ti of indices){const name=part.materials[ti]||'',[a,b,c]=part.triangles[ti];areas.set(name,(areas.get(name)||0)+V.len(V.cross(V.sub(b,a),V.sub(c,a)))/2);}
  const material=[...areas].sort((a,b)=>b[1]-a[1])[0]?.[0]||'';
  if(areas.size>1)warnings.add(`“${part.name}” uses multiple face materials; its dominant surface material supplies the object colour.`);
  if(material&&!colours.has(material))warnings.add(`Material “${material}” has no imported diffuse colour; the default colour is used.`);
  return colours.get(material)||'#b7cec9';
}
// Closed shells retain the existing cavity/containment conversion. Classify
// sheets separately so zero enclosed volume never rejects valid open geometry.
function convertTriangleImportPart(part:TriangleImportPart,colours:Map<string,string>,warnings:Set<string>,repairOpenings:boolean,importLabel='OBJ',trace?:MeshImportDiagnostic,ignoreOpenSurfaces=false):{items:MeshImportItem[];repairedOpenings:number;surfaceSource?:TriangleImportPart} {
  const classified=stlClassifyIsolatedOpenSurfaces(part.triangles,false,trace,importLabel),items:MeshImportItem[]=[];
  const pendingSurfaces:TriangleImportPart[]=[];
  let repairedOpenings=0;
  for(const indices of classified.closedContacts){const converted=convertClosedTriangleImportPart({...part,triangles:indices.map(index=>part.triangles[index]),materials:indices.map(index=>part.materials[index])},colours,warnings,false,importLabel,trace);items.push(...converted.items);}
  if(classified.closedContacts.length)warnings.add(`“${part.name}”: preserved ${classified.closedContacts.length} independently closed parts at branching edge contacts, without adding or removing triangles.`);
  if(classified.triangles.length){
    const closed=convertClosedTriangleImportPart({...part,triangles:classified.triangles,materials:classified.triangleIndices.map(index=>part.materials[index])},colours,warnings,repairOpenings,importLabel,trace);
    items.push(...closed.items);repairedOpenings+=closed.repairedOpenings;
  }
  if(classified.sheetCount)warnings.add(ignoreOpenSurfaces?`${importLabel} open surfaces omitted by request: ${classified.sheetCount} detached open surface groups (${classified.triangleCount} triangles) in “${part.name}”.`:`${importLabel} detected ${classified.sheetCount} detached open surface group(s) (${classified.triangleCount} triangles) in “${part.name}”. Unrepaired surfaces are limited objects; solid modeling tools are disabled.`);
  if(!ignoreOpenSurfaces)for(let index=0;index<classified.surfaces.length;index++){
    const source:TriangleImportPart={name:part.name,triangles:classified.surfaces[index],materials:classified.surfaceTriangleIndices[index].map(ti=>part.materials[ti])};
    if(repairOpenings){
      // Explicit repair may fail for an otherwise valid sheet. Only this
      // optional conversion is caught; the surface still must validate below.
      try{const repaired=convertClosedTriangleImportPart(source,colours,warnings,true,importLabel,trace);items.push(...repaired.items);repairedOpenings+=repaired.repairedOpenings;continue;}
      catch(error){trace?.('open-surface-repair-unavailable',{name:part.name,surfaceIndex:index,message:errorMessage(error)});}
    }
    if(part.sourceGroup){pendingSurfaces.push(source);continue;}
    const surface=stlBuildLimitedSurface(source.triangles,index,trace,importLabel);
    items.push({solid:surface.solid,name:part.name,color:triangleImportColour(part,colours,warnings,classified.surfaceTriangleIndices[index]),triangleCount:surface.triangles,kind:'surface'});
  }
  let surfaceSource:TriangleImportPart|undefined;
  if(pendingSurfaces.length){surfaceSource={name:part.name,triangles:pendingSurfaces.flatMap(source=>source.triangles),materials:pendingSurfaces.flatMap(source=>source.materials)};const surface=stlBuildLimitedSurface(surfaceSource.triangles,0,trace,importLabel);items.push({solid:surface.solid,name:part.name,color:triangleImportColour(surfaceSource,colours,warnings,surfaceSource.triangles.map((_,index)=>index)),triangleCount:surface.triangles,kind:'surface'});}
  if(items.length>1)items.forEach((item,index)=>{item.name=part.name+` ${index+1}`;});
  return {items,repairedOpenings,surfaceSource};
}
// A repeated OBJ group is one organizational surface collection. Retain each
// checked sheet's own vertex identities: coincident sheets are never welded
// into a false solid or branching shared edge during collection assembly.
function collectOBJGroupSurface(name:string,items:MeshImportItem[],sources:TriangleImportPart[],colours:Map<string,string>,warnings:Set<string>):MeshImportItem {
  const project:ProjectSolid={schema:'poly-brep-1',id:'obj_group_surface',metadata:{name},vertices:[],faces:[]};let vertexIndex=0,faceIndex=0;
  for(const item of items){const source=serializeProjectSurface(item.solid),ids=new Map<VertexId,VertexId>();for(const v of source.vertices){const id='v'+(++vertexIndex);ids.set(v.id,id);project.vertices.push({...v,id});}for(const face of source.faces)project.faces.push({...face,id:'f'+(++faceIndex),outer:face.outer.map(id=>ids.get(id)!),holes:face.holes.map(ring=>ring.map(id=>ids.get(id)!))});}
  if(vertexIndex>STL_IMPORT_POLICY.maxEditableVerticesPerShell||faceIndex>STL_IMPORT_POLICY.maxEditableFacesPerShell)throw Error('OBJ group surface exceeds the editable geometry budget.');
  const source:TriangleImportPart={name,triangles:sources.flatMap(part=>part.triangles),materials:sources.flatMap(part=>part.materials)};
  return {solid:deserializeProjectSurface(project),name:name+' open surface',color:triangleImportColour(source,colours,warnings,source.triangles.map((_,index)=>index)),triangleCount:items.reduce((sum,item)=>sum+item.triangleCount,0),kind:'surface'};
}
function convertClosedTriangleImportPart(part:TriangleImportPart,colours:Map<string,string>,warnings:Set<string>,repairOpenings:boolean,importLabel='OBJ',trace?:MeshImportDiagnostic):{items:MeshImportItem[];repairedOpenings:number} {
  trace?.('obj-weld-start',{name:part.name,triangles:part.triangles.length});
  const welded=weldSTLTriangles(part.triangles);if(!welded.triangles.length)throw Error('Imported part has no non-collapsed triangles.');
  meshImportTopologyDiagnostic(trace,'obj-weld-complete',{vertices:welded.vertices,triangles:welded.triangles,edges:[],face:[]});
  const initial=stlEdgeTopology(welded.triangles,false);if(initial.boundaryCount&&!repairOpenings)throw Error(`“${part.name}” has ${initial.boundaryCount} open edges. Closed solids are required unless planar-opening repair is explicitly enabled.`);
  trace?.('obj-repair-orientation-start',{openEdges:initial.boundaryCount,repairOpenings});
  const repair=initial.boundaryCount?stlRepairPlanarBoundaries(welded.vertices,welded.triangles,initial):undefined,topology=stlEdgeTopology(welded.triangles),components=orientSTLShells(welded.vertices,welded.triangles,topology.adjacency);
  trace?.('obj-containment-start',{components:components.length,componentTriangles:components.map(component=>component.length)});
  const bounds=components.map(component=>{const points=component.flatMap(index=>welded.triangles[index].map(id=>welded.vertices[id]));return {min:[0,1,2].map(axis=>points.reduce((value,p)=>Math.min(value,p[axis]),Infinity)),max:[0,1,2].map(axis=>points.reduce((value,p)=>Math.max(value,p[axis]),-Infinity))};});
  const containers=components.map((component,index)=>components.map((parent,parentIndex)=>({parent,parentIndex})).filter(({parent,parentIndex})=>parentIndex!==index&&bounds[index].min.every((value,axis)=>value>=bounds[parentIndex].min[axis])&&bounds[index].max.every((value,axis)=>value<=bounds[parentIndex].max[axis])&&meshShellContainsPoint(welded.vertices,welded.triangles,parent,welded.vertices[welded.triangles[component[0]][0]])).map(value=>value.parentIndex));
  const depth=containers.map(list=>list.length),items:MeshImportItem[]=[];
  for(let shellIndex=0;shellIndex<components.length;shellIndex++){
    if(depth[shellIndex]%2)continue;const component=[...components[shellIndex]];
    for(let innerIndex=0;innerIndex<components.length;innerIndex++)if(depth[innerIndex]===depth[shellIndex]+1&&containers[innerIndex].includes(shellIndex)){for(const ti of components[innerIndex]){const t=welded.triangles[ti];[t[1],t[2]]=[t[2],t[1]];component.push(ti);}}
    const used=new Set(component.flatMap(index=>welded.triangles[index]));if(used.size>STL_IMPORT_POLICY.maxEditableVerticesPerShell)throw Error(importLabel+' solid exceeds the editable vertex budget.');
    trace?.('planar-groups-start',{shellIndex,triangles:component.length,vertices:used.size});
    const groups=stlPlanarGroups(welded.vertices,welded.triangles,component,topology.adjacency);if(new Set(groups.values()).size>STL_IMPORT_POLICY.maxEditableFacesPerShell)throw Error(importLabel+' solid exceeds the editable face budget.');
    const rebuilt=buildEditableSTLShell(welded.vertices,welded.triangles,component,groups,shellIndex,importLabel,trace);validateSolid(rebuilt.solid);
    const areas=new Map<string,number>();for(const ti of component){const name=part.materials[ti]||'',t=welded.triangles[ti],a=welded.vertices[t[0]],b=welded.vertices[t[1]],c=welded.vertices[t[2]];areas.set(name,(areas.get(name)||0)+V.len(V.cross(V.sub(b,a),V.sub(c,a)))/2);}
    const material=[...areas].sort((a,b)=>b[1]-a[1])[0]?.[0]||'',colour=colours.get(material)||'#b7cec9';if(areas.size>1)warnings.add(`“${part.name}” uses multiple face materials; its dominant surface material supplies the object colour.`);if(material&&!colours.has(material))warnings.add(`Material “${material}” has no imported diffuse colour; the default colour is used.`);
    items.push({solid:rebuilt.solid,name:part.name,color:colour,triangleCount:component.length});
  }
  if(items.length>1)items.forEach((item,index)=>{item.name+=` ${index+1}`;});return {items,repairedOpenings:repair?.cappedBoundaryLoops||0};
}
function prepareMeshImport(request:MeshImportRequest,report?:(update:ModelingProgressUpdate)=>void,onDiagnostic?:(event:ModelingDiagnosticEvent)=>void):MeshImportResult {
  const started=profilerClock(),trace:MeshImportDiagnostic|undefined=onDiagnostic?(event,data={})=>onDiagnostic({category:'import',event,elapsedMs:profilerClock()-started,data}):undefined;
  trace?.('request',{format:request.format,name:request.name,bytes:request.buffer.byteLength,scale:request.scale,repairOpenings:request.repairOpenings,keepTouchingPartsSeparate:request.keepTouchingPartsSeparate??false,ignoreIsolatedOpenSurfaces:request.ignoreIsolatedOpenSurfaces??false,geometryPolicy:STL_IMPORT_POLICY,importPolicy:MESH_IMPORT_POLICY,tolerances:TOL});
  if(request.format!=='obj'&&request.format!=='stl')throw Error('Unsupported mesh import format. Choose OBJ or STL.');
  if(request.ignoreIsolatedOpenSurfaces!==undefined&&typeof request.ignoreIsolatedOpenSurfaces!=='boolean')throw Error('Mesh open-surface filtering must be a boolean option.');
  importScale(request.scale);if(request.buffer.byteLength>MESH_IMPORT_POLICY.maximumFileBytes)throw Error(`Geometry file exceeds the ${MESH_IMPORT_POLICY.maximumFileBytes/(1024*1024)} MB import budget.`);report?.({progress:5,message:'Reading import geometry…'});
  if(request.format==='stl'){
    if(request.keepTouchingPartsSeparate!==undefined&&typeof request.keepTouchingPartsSeparate!=='boolean')throw Error('STL separation must be a boolean option.');
    trace?.('stl-parse-start');
    const format=detectSTLFormat(request.buffer),triangles=stlTrianglePoints(request.buffer,format).map(triangle=>triangle.map(point=>point.map(value=>value*request.scale) as Vec3));if(triangles.some(triangle=>triangle.some(point=>point.some(value=>!Number.isFinite(value)))))throw Error('Scaled STL coordinate is not finite.');
    trace?.('stl-parse-complete',{format,triangles:triangles.length});
    const openSurfaces=stlClassifyIsolatedOpenSurfaces(triangles,!!request.ignoreIsolatedOpenSurfaces,trace);
    report?.({progress:20,message:'Cleaning and validating STL geometry…'});
    const result=openSurfaces.triangles.length?convertSTLTriangles(openSurfaces.triangles,format,request.repairOpenings,!!request.keepTouchingPartsSeparate,trace):null;
    const warnings=['STL has no object names, colours or units. Separate shells become separate objects.'];
    const items:MeshImportItem[]=result?result.shells.map((shell,index)=>({solid:shell.solid,name:result.shells.length===1?request.name:`${request.name} ${index+1}`,color:'#b7cec9',triangleCount:shell.triangleCount})):[];
    // Planar-opening repair is an explicit request to create new geometry.
    // Try it for each detached open shell, but keep unrepairable ones as
    // limited surfaces rather than dropping their original triangles.
    let repairedOpenings=result?.repair?.cappedBoundaryLoops||0;
    for(let index=0;index<openSurfaces.surfaces.length;index++){
      const source=openSurfaces.surfaces[index];let repaired=false;
      if(request.repairOpenings){
        try{
          const fixed=convertSTLTriangles(source,format,true,false);
          if(fixed.shells.length){for(const shell of fixed.shells)items.push({solid:shell.solid,name:`${request.name} ${items.length+1}`,color:'#b7cec9',triangleCount:shell.triangleCount});repairedOpenings+=fixed.repair?.cappedBoundaryLoops||0;repaired=true;}
        }catch(error){trace?.('open-surface-repair-unavailable',{surfaceIndex:index,message:errorMessage(error)});}
      }
      if(!repaired){const surface=stlBuildLimitedSurface(source,index,trace);items.push({solid:surface.solid,name:`${request.name} open surface ${index+1}`,color:'#b7cec9',triangleCount:surface.triangles,kind:'surface'});}
    }
    if(openSurfaces.sheetCount){if(request.ignoreIsolatedOpenSurfaces)warnings.push(`STL open surfaces omitted by request: ${openSurfaces.sheetCount} detached open surface groups (${openSurfaces.triangleCount} triangles).`);else warnings.push(`STL detected ${openSurfaces.sheetCount} detached open surface group(s) (${openSurfaces.triangleCount} triangles). Unrepaired surfaces are limited objects; solid modeling tools are disabled.`);}
    if(result?.cleanup){const cleanup=result.cleanup;warnings.push(`STL cleanup: removed ${cleanup.removedDegenerateTriangles} zero-area/collapsed triangles and ${cleanup.removedDuplicateTriangles} duplicate triangles; added ${cleanup.addedSeamTriangles} triangles to match existing boundary seams. No holes were capped by cleanup.`);}
    if(result?.cleanup?.removedContactTriangles)warnings.push(`STL contact cleanup: removed ${result.cleanup.removedContactTriangles} triangles from internal contact surfaces. The closed geometry passed validation and export checks.`);
    if(result?.cleanup?.preservedSourceParts)warnings.push(`STL source-part separation: preserved ${result.cleanup.preservedSourceParts} independently closed source parts before shared-surface cleanup. Every part passed geometry/export checks and preserved its material volume.`);
    if(result?.cleanup?.separatedContactParts)warnings.push(`STL contact separation: preserved ${result.cleanup.separatedContactParts} closed parts as separate objects; contact faces were restored without changing material volume.`);
    const solidCount=items.filter(item=>item.kind!=='surface').length,surfaceCount=items.length-solidCount;
    trace?.('check-complete',{format:'stl',triangles:triangles.length,openSurfaceGroups:openSurfaces.sheetCount,openSurfaceTriangles:openSurfaces.triangleCount,weldedVertices:result?.weldedVertexCount||0,solids:solidCount,openSurfaces:surfaceCount,cleanup:result?.cleanup||null,repair:result?.repair||null});
    report?.({progress:100,message:'STL geometry check complete'});
    return {format:'stl',triangleCount:triangles.length,items,warnings,repairedOpenings};
  }
  trace?.('obj-parse-start');
  const parsed=parseOBJ(new TextDecoder('utf-8',{fatal:true}).decode(request.buffer),request.scale,request.name),materials=parseMTLDiffuse(request.materials,parsed.libraries),warnings=new Set([...parsed.warnings,...materials.warnings]),items:MeshImportItem[]=[],groupSurfaces=new Map<string,{items:MeshImportItem[];sources:TriangleImportPart[]}>();let repairedOpenings=0;
  trace?.('obj-parse-complete',{parts:parsed.parts.length,triangles:parsed.parts.reduce((sum,part)=>sum+part.triangles.length,0),warnings:[...warnings]});
  for(let index=0;index<parsed.parts.length;index++){
    const part=parsed.parts[index];trace?.('obj-part-start',{partIndex:index,name:part.name,triangles:part.triangles.length});report?.({progress:20+75*index/parsed.parts.length,message:`Validating OBJ object ${index+1} of ${parsed.parts.length}…`});
    const converted=convertTriangleImportPart(part,materials.colours,warnings,request.repairOpenings,'OBJ',trace,!!request.ignoreIsolatedOpenSurfaces);
    for(const item of converted.items){if(part.sourceGroup&&item.kind==='surface'){let group=groupSurfaces.get(part.sourceGroup);if(!group){group={items:[],sources:[]};groupSurfaces.set(part.sourceGroup,group);}group.items.push(item);if(converted.surfaceSource)group.sources.push(converted.surfaceSource);}else items.push(item);}
    repairedOpenings+=converted.repairedOpenings;if(items.length+groupSurfaces.size>MESH_IMPORT_POLICY.maximumObjects)throw Error('Import contains too many editable objects.');
  }
  for(const [name,group] of groupSurfaces){items.push(collectOBJGroupSurface(name,group.items,group.sources,materials.colours,warnings));trace?.('obj-group-surface',{name,sheets:group.items.length,faces:items[items.length-1].solid.faces.size,triangles:items[items.length-1].triangleCount});}
  if(!items.length)throw Error('No solid geometry remains after ignoring open surfaces.');
  trace?.('check-complete',{format:'obj',solids:items.filter(item=>item.kind!=='surface').length,openSurfaces:items.filter(item=>item.kind==='surface').length,repairedOpenings});
  report?.({progress:100,message:'OBJ geometry check complete'});return {format:'obj',items,triangleCount:parsed.parts.reduce((total,part)=>total+part.triangles.length,0),warnings:[...warnings],repairedOpenings};
}
