interface STLOpenSurfaceClassification {triangles:Vec3[][];triangleIndices:number[];surfaces:Vec3[][][];surfaceTriangleIndices:number[][];closedContacts:number[][];sheetCount:number;triangleCount:number;}
// Split independent edge-connected parts before solid welding. A part with
// boundary edges belongs to the limited surface representation, not to solid
// repair. Unproven branching parts remain on the strict rejection path; OBJ
// can recover edge contacts only after proving every resulting part is closed.
function stlClassifyIsolatedOpenSurfaces(source:Vec3[][],ignore:boolean,trace?:MeshImportDiagnostic,importLabel='STL'):STLOpenSurfaceClassification {
  trace?.('open-surfaces-start',{triangles:source.length,ignore});
  const {indexOf}=stlSourceVertexIndex(),parents=source.map((_,index)=>index),owners=new Map<string,number>();
  const root=(index:number):number=>{while(parents[index]!==index){parents[index]=parents[parents[index]];index=parents[index];}return index;};
  const ids=source.map((triangle,index)=>{
    if(triangle.length!==3||triangle.some(p=>p.length!==3||p.some(value=>!Number.isFinite(value))))throw Error(importLabel+' has invalid triangle coordinates.');
    const indices=triangle.map(indexOf);
    for(let j=0;j<3;j++){const a=indices[j],b=indices[(j+1)%3];if(a===b)continue;const key=a<b?`${a}|${b}`:`${b}|${a}`,owner=owners.get(key);if(owner===undefined)owners.set(key,index);else parents[root(index)]=root(owner);}
    return indices;
  });
  const components=new Map<number,number[]>();
  for(let index=0;index<source.length;index++){const key=root(index);let part=components.get(key);if(!part)components.set(key,part=[]);part.push(index);}
  const selected=new Set<number>(),surfaces:Vec3[][][]=[],surfaceTriangleIndices:number[][]=[],closedContacts:number[][]=[],samples:Record<string,unknown>[]=[];let sheetCount=0,openTriangleCount=0;
  for(const part of components.values()){
    const edges=new Map<string,number>();
    for(const ti of part)for(let j=0;j<3;j++){
      const a=ids[ti][j],b=ids[ti][(j+1)%3];if(a===b)continue;
      const key=a<b?`${a}|${b}`:`${b}|${a}`;edges.set(key,(edges.get(key)||0)+1);
    }
    const boundary=[...edges.values()].filter(count=>count===1).length;
    if([...edges.values()].some(count=>count>2)){
      // OBJ parts can contain complete solids touching only along an edge.
      // Cut adjacency only at the branching edges, then require each resulting
      // part to prove its own two-incidence closure. No face is added or lost.
      if(importLabel==='OBJ'){
        const localParents=new Map(part.map(index=>[index,index])),edgeOwners=new Map<string,number>();
        const localRoot=(index:number):number=>{let root=index;while(localParents.get(root)!==root)root=localParents.get(root)!;while(index!==root){const next=localParents.get(index)!;localParents.set(index,root);index=next;}return root;};
        for(const ti of part)for(let j=0;j<3;j++){const a=ids[ti][j],b=ids[ti][(j+1)%3],key=a<b?`${a}|${b}`:`${b}|${a}`;if(edges.get(key)!==2)continue;const owner=edgeOwners.get(key);if(owner===undefined)edgeOwners.set(key,ti);else localParents.set(localRoot(ti),localRoot(owner));}
        const candidates=new Map<number,number[]>();for(const ti of part){const key=localRoot(ti),list=candidates.get(key)||[];list.push(ti);candidates.set(key,list);}
        const closed=[...candidates.values()].every(candidate=>{const counts=new Map<string,number>();for(const ti of candidate)for(let j=0;j<3;j++){const a=ids[ti][j],b=ids[ti][(j+1)%3],key=a<b?`${a}|${b}`:`${b}|${a}`;counts.set(key,(counts.get(key)||0)+1);}return [...counts.values()].every(count=>count===2);});
        if(candidates.size>1&&closed){for(const candidate of candidates.values()){closedContacts.push(candidate);for(const ti of candidate)selected.add(ti);}trace?.('obj-edge-contact-parts',{parts:candidates.size,triangles:part.length,branchEdges:[...edges.values()].filter(count=>count>2).length});}
      }
      continue;
    }
    if(!boundary)continue;
    const triangles=part.map(ti=>source[ti]);surfaces.push(triangles);surfaceTriangleIndices.push(part);sheetCount++;openTriangleCount+=part.length;
    for(const ti of part)selected.add(ti);
    if(samples.length<MESH_IMPORT_DIAGNOSTIC_POLICY.sampleLimit){const points=triangles.flat();samples.push({firstTriangle:part[0],triangles:part.length,openEdges:boundary,min:[0,1,2].map(axis=>points.reduce((v,p)=>Math.min(v,p[axis]),Infinity)),max:[0,1,2].map(axis=>points.reduce((v,p)=>Math.max(v,p[axis]),-Infinity))});}
  }
  trace?.('open-surfaces-classified',{components:components.size,sheets:sheetCount,triangles:openTriangleCount,ignored:ignore&&sheetCount>0,samples});
  const triangleIndices=source.map((_,index)=>index).filter(index=>!selected.has(index)),triangles=selected.size?triangleIndices.map(index=>source[index]):source;
  if(ignore&&!triangles.length)throw Error('No solid geometry remains after ignoring open surfaces.');
  trace?.('open-surfaces-complete',{retainedTriangles:triangles.length,openSurfaces:ignore?0:sheetCount,openTriangles:ignore?0:openTriangleCount,ignoredSurfaces:ignore?sheetCount:0});
  return {triangles,triangleIndices,surfaces:ignore?[]:surfaces,surfaceTriangleIndices:ignore?[]:surfaceTriangleIndices,closedContacts,sheetCount,triangleCount:openTriangleCount};
}
// STL stores triangles, not editable polygons. Reconstruct safe coplanar regions
// from indexed source edges; if a region cannot be merged, retain its original
// triangles. Neither path fills a boundary or alters a source vertex position.
function stlBuildLimitedSurface(source:Vec3[][],shellIndex:number,trace?:MeshImportDiagnostic,importLabel='STL'):{solid:Solid;triangles:number;faces:number} {
  const welded=weldSTLTriangles(source,true);
  if(!welded.triangles.length)throw Error(`An ${importLabel} open surface has no usable surface triangles.`);
  if(welded.vertices.length>STL_IMPORT_POLICY.maxEditableVerticesPerShell)throw Error(importLabel+' open surface exceeds the editable vertex budget.');
  const topology=stlEdgeTopology(welded.triangles,false);
  if(topology.nonManifoldCount)throw Error(`An ${importLabel} open surface has non-manifold edges.`);
  // Orientation is local to the sheet. An open surface has no signed enclosed
  // volume, so unlike a solid we never flip it according to a volume test.
  const visited=new Array<boolean|undefined>(welded.triangles.length),parts:number[][]=[];
  for(let seed=0;seed<welded.triangles.length;seed++){
    if(visited[seed]!==undefined)continue;visited[seed]=false;const queue=[seed];
    for(let i=0;i<queue.length;i++)for(const link of topology.adjacency[queue[i]]){
      const expected=link.sameDirection?!visited[queue[i]]:visited[queue[i]];
      if(visited[link.triangle]===undefined){visited[link.triangle]=expected;queue.push(link.triangle);}
      else if(visited[link.triangle]!==expected)throw Error(`An ${importLabel} open surface is non-orientable.`);
    }
    parts.push(queue);
  }
  for(let i=0;i<welded.triangles.length;i++)if(visited[i]){const t=welded.triangles[i];[t[1],t[2]]=[t[2],t[1]];}
  const orientedTopology=stlEdgeTopology(welded.triangles,false),edges=orientedTopology.edges;
  const groups=new Map<number,number>();let nextGroup=0;
  for(const part of parts){const assigned=stlPlanarGroups(welded.vertices,welded.triangles,part,orientedTopology.adjacency);for(const [ti,g] of assigned)groups.set(ti,nextGroup+g);nextGroup+=new Set(assigned.values()).size;}
  const byGroup=new Map<number,number[]>();for(const [ti,g] of groups){const list=byGroup.get(g)||[];list.push(ti);byGroup.set(g,list);}
  const provenance:FaceProvenance={kind:'import',label:importLabel+' open surface'};
  const faces:ProjectSolid['faces']=[];let merged=0;
  for(const [group,indices] of byGroup){
    const region=stlIndexedPlanarRegion(welded.vertices,welded.triangles,indices,group,groups,edges,shellIndex,provenance);
    if(region.face){faces.push(region.face);merged+=indices.length-1;}
    else for(const ti of indices)faces.push({id:`f${ti+1}`,outer:welded.triangles[ti].map(id=>`v${id+1}`),holes:[],provenance,boundaryGroup:`stl:${shellIndex}:triangle:${ti}`});
  }
  if(faces.length>STL_IMPORT_POLICY.maxEditableFacesPerShell)throw Error(importLabel+' open surface exceeds the editable face budget.');
  const project:ProjectSolid={schema:'poly-brep-1',id:`${importLabel.toLowerCase()}_surface_${shellIndex+1}`,metadata:{name:`${importLabel} open surface ${shellIndex+1}`},vertices:welded.vertices.map((position,i)=>({id:`v${i+1}`,position})),faces};
  let solid:Solid;
  try{solid=deserializeProjectSurface(project);}
  catch(error){
    // Geometrically valid but non-simple coplanar grouping is not a reason to
    // discard the source sheet: fall back to the exact indexed triangles.
    trace?.('open-surface-merge-fallback',{surfaceIndex:shellIndex,message:errorMessage(error)});
    if(welded.triangles.length>STL_IMPORT_POLICY.maxEditableFacesPerShell)throw Error(importLabel+' open surface exceeds the editable face budget.');
    project.faces=welded.triangles.map((t,i)=>({id:`f${i+1}`,outer:t.map(id=>`v${id+1}`),holes:[],provenance}));
    solid=deserializeProjectSurface(project);merged=0;
  }
  trace?.('open-surface-rebuilt',{surfaceIndex:shellIndex,triangles:welded.triangles.length,faces:solid.faces.size,mergedTriangles:merged});
  return {solid,triangles:welded.triangles.length,faces:solid.faces.size};
}
