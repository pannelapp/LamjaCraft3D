// Import observations never change geometry policy or document state. Samples
// identify troublesome welded edges without copying the complete source mesh.
type MeshImportDiagnostic=(event:string,data?:Record<string,unknown>)=>void;
const MESH_IMPORT_DIAGNOSTIC_POLICY=Object.freeze({sampleLimit:8});
function meshImportEdgeDiagnostic(vertices:Vec3[],counts:Map<string,number>):Record<string,unknown> {
  let openEdges=0,nonManifoldEdges=0;const samples:Record<string,unknown>[]=[];
  for(const [key,count] of counts){
    if(count===2)continue;if(count===1)openEdges++;else nonManifoldEdges++;
    if(samples.length<MESH_IMPORT_DIAGNOSTIC_POLICY.sampleLimit){const ids=key.split('|').map(Number);samples.push({vertexIndices:ids,points:ids.map(id=>vertices[id]),incidentTriangles:count});}
  }
  return {edges:counts.size,openEdges,nonManifoldEdges,problemEdges:samples};
}
function meshImportTopologyDiagnostic(trace:MeshImportDiagnostic|undefined,event:string,mesh:Mesh):void {
  if(trace)trace(event,{triangles:mesh.triangles.length,vertices:mesh.vertices.length,...meshImportEdgeDiagnostic(mesh.vertices,triangleMeshEdgeCounts(mesh))});
}
interface STLImportShell {
  solid: Solid;
  triangleCount: number;
  planarGroupCount: number;
  preservedFacetedGroups?: number;
}
interface STLImportRepair {
  cappedBoundaryLoops: number;
  addedTriangles: number;
}
interface STLImportCleanup {
  removedDegenerateTriangles: number;
  removedDuplicateTriangles: number;
  addedSeamTriangles: number;
  removedContactTriangles?: number;
  separatedContactParts?: number;
  preservedSourceParts?: number;
}
interface STLContactInterface {triangles:[number,number,number][];boundary:[number,number][];}
interface STLImportResult {
  format: 'binary' | 'ascii';
  triangleCount: number;
  weldedVertexCount: number;
  shells: STLImportShell[];
  repair?: STLImportRepair;
  cleanup?: STLImportCleanup;
}
interface STLEdgeRef { triangle: number; a: number; b: number; }
interface STLAdjacency { triangle: number; sameDirection: boolean; }

const STL_IMPORT_POLICY = Object.freeze({
  maxTriangles: 1000000,
  maxShells: 256,
  maxEditableVerticesPerShell: 1000000,
  maxEditableFacesPerShell: 1000000,
  weldDistance: TOL.topologyKey * 2,
  // Only discard sub-minimum-area triangles whose altitude is inside the
  // coordinate noise budget. A genuinely small face must still be rejected.
  degenerateDistance: TOL.weld,
  contactPlaneDistance: TOL.weld,
  contactNormalAngle: TOL.coplanarAngle,
  contactEdgeDistance: TRIANGLE_SEAM_POLICY.distance,
  // A true overlap or contained segment must overlap the rim's padded AABB.
  // Two distances cover the unchanged perpendicular and endpoint allowances.
  contactQueryPadding: TRIANGLE_SEAM_POLICY.distance * 2,
  contactIndexLeafSize: 16,
  // Bound the exceptional partial-contact scan independently of mesh size.
  maxContactEdgeComparisons: 2000000,
  maxContactSplitComparisons: 10000000,
  contactVolumeRelativeTolerance: 1e-6,
  contactVolumeAbsoluteTolerance: 1e-6,
  coplanarAngle: TOL.coplanarAngle * 8,
  coplanarDistance: TOL.coplanarDistance * 4,
  mergePlanarityDistance: TOL.plane * 0.75,
  repairPlanarDistance: TOL.coplanarDistance * 16,
  maxRepairBoundaryLoops: 64,
  maxRepairBoundaryVertices: 10000,
});

interface STLContactEdgeNode {min:Vec3;max:Vec3;ids:number[];left:STLContactEdgeNode|null;right:STLContactEdgeNode|null;}
function stlContactEdgeIndex(vertices:Vec3[],edges:readonly [number,number][]):{query:(a:Vec3,b:Vec3)=>number[]} {
  const boxes=edges.map(([a,b])=>{
    const min:Vec3=[0,0,0],max:Vec3=[0,0,0];
    for(let axis=0;axis<3;axis++){min[axis]=Math.min(vertices[a][axis],vertices[b][axis]);max[axis]=Math.max(vertices[a][axis],vertices[b][axis]);}
    return {min,max};
  });
  const build=(ids:number[]):STLContactEdgeNode=>{
    const min:Vec3=[Infinity,Infinity,Infinity],max:Vec3=[-Infinity,-Infinity,-Infinity];
    for(const id of ids)for(let axis=0;axis<3;axis++){min[axis]=Math.min(min[axis],boxes[id].min[axis]);max[axis]=Math.max(max[axis],boxes[id].max[axis]);}
    if(ids.length<=STL_IMPORT_POLICY.contactIndexLeafSize)return {min,max,ids,left:null,right:null};
    let axis=0;for(let next=1;next<3;next++)if(max[next]-min[next]>max[axis]-min[axis])axis=next;
    ids.sort((a,b)=>(boxes[a].min[axis]+boxes[a].max[axis])-(boxes[b].min[axis]+boxes[b].max[axis])||a-b);
    const middle=ids.length>>>1;
    return {min,max,ids:[],left:build(ids.slice(0,middle)),right:build(ids.slice(middle))};
  };
  const root=edges.length?build(Array.from(edges.keys())):null;
  return {query:(a,b)=>{
    const min:Vec3=[0,0,0],max:Vec3=[0,0,0],pad=STL_IMPORT_POLICY.contactQueryPadding;
    for(let axis=0;axis<3;axis++){min[axis]=Math.min(a[axis],b[axis])-pad;max[axis]=Math.max(a[axis],b[axis])+pad;}
    const overlaps=(box:{min:Vec3;max:Vec3})=>box.min.every((value,axis)=>value<=max[axis]&&box.max[axis]>=min[axis]);
    const stack:STLContactEdgeNode[]=root?[root]:[],found:number[]=[];
    while(stack.length){const node=stack.pop()!;if(!overlaps(node))continue;if(node.left&&node.right){stack.push(node.left,node.right);}else for(const id of node.ids)if(overlaps(boxes[id]))found.push(id);}
    // Stable input order preserves interval tie handling and determinism. The
    // index only discards impossible AABBs; existing geometry tests own truth.
    return found.sort((a,b)=>a-b);
  }};
}

function stlTrianglePoints(buffer:ArrayBuffer,format:'binary'|'ascii'):Vec3[][] {
  if(format==='binary'){
    if(buffer.byteLength<84)throw Error('The binary STL header is incomplete.');
    const view=new DataView(buffer),count=view.getUint32(80,true),expected=84+count*50;
    if(!count)throw Error('The STL contains no triangles.');
    if(count>STL_IMPORT_POLICY.maxTriangles)throw Error(`The STL contains too many triangles (${count.toLocaleString('en-US')}; maximum ${STL_IMPORT_POLICY.maxTriangles.toLocaleString('en-US')}).`);
    if(expected>buffer.byteLength)throw Error('The binary STL is truncated.');
    const triangles:Vec3[][]=[];
    for(let i=0,offset=84;i<count;i++,offset+=50){
      const tri:Vec3[]=[];
      for(let vertex=0;vertex<3;vertex++){
        const pOffset=offset+12+vertex*12;
        const p:Vec3=[view.getFloat32(pOffset,true),view.getFloat32(pOffset+4,true),view.getFloat32(pOffset+8,true)];
        if(p.some(n=>!Number.isFinite(n)))throw Error(`Triangle ${i+1} contains a non-finite coordinate.`);
        tri.push(p);
      }
      triangles.push(tri);
    }
    return triangles;
  }
  const text=new TextDecoder().decode(buffer),number='[-+]?(?:\\d+\\.?\\d*|\\.\\d+)(?:[eE][-+]?\\d+)?',vertexPattern=new RegExp(`\\bvertex\\s+(${number})\\s+(${number})\\s+(${number})`,'gi'),points:Vec3[]=[];
  let match:RegExpExecArray|null;
  while((match=vertexPattern.exec(text))){
    const p:Vec3=[Number(match[1]),Number(match[2]),Number(match[3])];
    if(p.some(n=>!Number.isFinite(n)))throw Error('The ASCII STL contains a non-finite coordinate.');
    points.push(p);
    if(points.length/3>STL_IMPORT_POLICY.maxTriangles)throw Error(`The STL contains too many triangles (maximum ${STL_IMPORT_POLICY.maxTriangles.toLocaleString('en-US')}).`);
  }
  if(!points.length)throw Error('The ASCII STL contains no triangle vertices.');
  if(points.length%3)throw Error('The ASCII STL has an incomplete triangle.');
  const triangles:Vec3[][]=[];for(let i=0;i<points.length;i+=3)triangles.push([points[i],points[i+1],points[i+2]]);
  return triangles;
}

function detectSTLFormat(buffer:ArrayBuffer):'binary'|'ascii' {
  if(buffer.byteLength>=84){
    const view=new DataView(buffer),count=view.getUint32(80,true),expected=84+count*50;
    if(count>0&&expected===buffer.byteLength)return 'binary';
  }
  const prefix=new TextDecoder().decode(buffer.slice(0,Math.min(buffer.byteLength,65536)));
  if(/\bvertex\s+[-+.\d]/i.test(prefix)&&/\bfacet\b/i.test(prefix))return 'ascii';
  if(buffer.byteLength>=84){
    const view=new DataView(buffer),count=view.getUint32(80,true),expected=84+count*50;
    if(count>0&&count<=STL_IMPORT_POLICY.maxTriangles&&expected<=buffer.byteLength)return 'binary';
  }
  throw Error('The file is not a recognizable ASCII or binary STL.');
}

// Shared importer welding index. Detection and conversion use the same spatial
// buckets and real-distance predicate; classification adds no looser tolerance.
function stlSourceVertexIndex():{vertices:Vec3[];indexOf:(p:Vec3)=>number} {
  const vertices:Vec3[]=[],cellSize=STL_IMPORT_POLICY.weldDistance,buckets=new Map<string,number[]>();
  const cell=(p:Vec3):[number,number,number]=>[Math.floor(p[0]/cellSize),Math.floor(p[1]/cellSize),Math.floor(p[2]/cellSize)],key=(x:number,y:number,z:number)=>`${x},${y},${z}`;
  const indexOf=(p:Vec3)=>{
    const c=cell(p);let best=-1,bestDistance=Infinity;
    for(let dx=-1;dx<=1;dx++)for(let dy=-1;dy<=1;dy++)for(let dz=-1;dz<=1;dz++)for(const index of buckets.get(key(c[0]+dx,c[1]+dy,c[2]+dz))||[]){
      const distance=V.len(V.sub(p,vertices[index]));if(distance<=STL_IMPORT_POLICY.weldDistance&&distance<bestDistance){best=index;bestDistance=distance;}
    }
    if(best>=0)return best;
    const index=vertices.length;vertices.push([...p] as Vec3);const bucketKey=key(c[0],c[1],c[2]),bucket=buckets.get(bucketKey)||[];bucket.push(index);buckets.set(bucketKey,bucket);return index;
  };
  return {vertices,indexOf};
}

function weldSTLTriangles(source:Vec3[][],cleanRedundant=false):{vertices:Vec3[];triangles:[number,number,number][];duplicateTriangles:[number,number,number][];cleanup:STLImportCleanup} {
  const {vertices,indexOf}=stlSourceVertexIndex(),triangles:[number,number,number][]=[],duplicateTriangles:[number,number,number][]=[];
  const cleanup:STLImportCleanup={removedDegenerateTriangles:0,removedDuplicateTriangles:0,addedSeamTriangles:0},seen=new Set<string>();
  for(let i=0;i<source.length;i++){
    const tri=source[i];
    if(tri.length!==3||tri.some(p=>p.length!==3||p.some(value=>!Number.isFinite(value))))throw Error(`Triangle ${i+1} contains invalid coordinates.`);
    const sourceArea2=V.len(V.cross(V.sub(tri[1],tri[0]),V.sub(tri[2],tri[0]))),longest=Math.max(...tri.map((p,j)=>V.len(V.sub(p,tri[(j+1)%3]))));
    if(cleanRedundant&&sourceArea2<=TOL.minimumFaceArea*2&&sourceArea2<=longest*STL_IMPORT_POLICY.degenerateDistance){cleanup.removedDegenerateTriangles++;continue;}
    const ids=tri.map(indexOf) as [number,number,number];
    if(new Set(ids).size!==3){if(cleanRedundant){cleanup.removedDegenerateTriangles++;continue;}throw Error(`Triangle ${i+1} collapses after vertex welding.`);}
    const a=vertices[ids[0]],b=vertices[ids[1]],c=vertices[ids[2]],area2=V.len(V.cross(V.sub(b,a),V.sub(c,a)));
    if(area2<=TOL.minimumFaceArea*2)throw Error(`Triangle ${i+1} is degenerate or too small.`);
    if(cleanRedundant){const key=[...ids].sort((x,y)=>x-y).join('|');if(seen.has(key)){cleanup.removedDuplicateTriangles++;duplicateTriangles.push(ids);continue;}seen.add(key);}
    triangles.push(ids);
  }
  return {vertices,triangles,duplicateTriangles,cleanup};
}

// A contact interface may be exported twice, or only once when one solid has
// already had its covered surface removed. Remove complete planar sheets only:
// paired opposite patches, or a branch sheet whose entire perimeter is already
// covered twice by the remaining surface. Final closed-manifold validation is
// mandatory; this does not fill openings or remove arbitrary branch triangles.
function stlCancelContactInterfaces(vertices:Vec3[],input:[number,number,number][],trace?:MeshImportDiagnostic):{triangles:[number,number,number][];interfaces:STLContactInterface[];removedContactTriangles:number;removedDuplicateTriangles:number}|null {
  const triangles:[number,number,number][]=[],orientedKeys=new Set<string>();let removedDuplicateTriangles=0;
  for(const t of input){const start=t.indexOf(Math.min(...t)),key=[t[start],t[(start+1)%3],t[(start+2)%3]].join('|');if(orientedKeys.has(key)){removedDuplicateTriangles++;continue;}orientedKeys.add(key);triangles.push(t);}
  const edges=new Map<string,STLEdgeRef[]>(),planes=triangles.map(t=>planeFromPoints(t.map(id=>vertices[id])));
  const edgeKey=(a:number,b:number)=>a<b?`${a}|${b}`:`${b}|${a}`;
  for(let ti=0;ti<triangles.length;ti++)for(let j=0;j<3;j++){const a=triangles[ti][j],b=triangles[ti][(j+1)%3],key=edgeKey(a,b),refs=edges.get(key)||[];refs.push({triangle:ti,a,b});edges.set(key,refs);}
  const assigned=new Set<number>(),patches:{members:number[];boundary:STLEdgeRef[];forward:string;reverse:string;normal:Vec3}[]=[];
  for(let seed=0;seed<triangles.length;seed++){
    if(assigned.has(seed))continue;
    const plane=planes[seed],members=[seed];assigned.add(seed);
    for(let q=0;q<members.length;q++)for(let j=0;j<3;j++){
      const t=triangles[members[q]],refs=edges.get(edgeKey(t[j],t[(j+1)%3]))!;
      // A branch edge separates surface sheets even when the exporter gave an
      // internal wall the same winding as the neighboring exterior surface.
      if(refs.length>2&&refs.some(ref=>Math.abs(V.dot(plane.normal,planes[ref.triangle].normal))<1-STL_IMPORT_POLICY.contactNormalAngle))continue;
      for(const ref of refs){const ti=ref.triangle;if(assigned.has(ti))continue;
        if(V.dot(plane.normal,planes[ti].normal)<1-STL_IMPORT_POLICY.contactNormalAngle||triangles[ti].some(id=>Math.abs(V.dot(plane.normal,vertices[id])-plane.offset)>STL_IMPORT_POLICY.contactPlaneDistance))continue;
        assigned.add(ti);members.push(ti);
      }
    }
    const local=new Map<string,STLEdgeRef[]>();
    for(const ti of members)for(let j=0;j<3;j++){const t=triangles[ti],a=t[j],b=t[(j+1)%3],key=edgeKey(a,b),refs=local.get(key)||[];refs.push({triangle:ti,a,b});local.set(key,refs);}
    const boundary:STLEdgeRef[]=[];let valid=true;
    for(const refs of local.values()){if(refs.length===1){boundary.push(refs[0]);}else if(refs.length!==2||refs[0].a!==refs[1].b||refs[0].b!==refs[1].a){valid=false;break;}}
    if(!valid||boundary.length<3)continue;
    // A degree-two directed boundary excludes touching/branched patches. The
    // paired boundary proves equal regions on the same plane, including holes.
    const incoming=new Set<number>(),outgoing=new Set<number>();
    for(const ref of boundary){if(outgoing.has(ref.a)||incoming.has(ref.b)){valid=false;break;}outgoing.add(ref.a);incoming.add(ref.b);}
    if(!valid||[...incoming].some(id=>!outgoing.has(id)))continue;
    const forward=boundary.map(ref=>`${ref.a}>${ref.b}`).sort().join('|'),reverse=boundary.map(ref=>`${ref.b}>${ref.a}`).sort().join('|');
    patches.push({members,boundary,forward,reverse,normal:plane.normal});
  }
  trace?.('contact-patches',{patches:patches.length,inputTriangles:input.length,uniqueOrientedTriangles:triangles.length,removedDuplicateTriangles});
  const byBoundary=new Map<string,number[]>();patches.forEach((patch,index)=>{const list=byBoundary.get(patch.forward)||[];list.push(index);byBoundary.set(patch.forward,list);});
  const removed=new Set<number>(),interfaces:STLContactInterface[]=[];
  const remember=(patch:typeof patches[number])=>interfaces.push({triangles:patch.members.map(ti=>triangles[ti]),boundary:patch.boundary.map(ref=>[ref.a,ref.b])});
  for(const patch of patches){const matches=byBoundary.get(patch.reverse)||[];if(matches.length!==1)continue;const opposite=patches[matches[0]];
    if(patch.members.some(ti=>removed.has(ti)))continue;
    if((byBoundary.get(patch.forward)||[]).length!==1||V.dot(patch.normal,opposite.normal)>-1+STL_IMPORT_POLICY.contactNormalAngle||patch.boundary.some(ref=>edges.get(edgeKey(ref.a,ref.b))!.length<3))continue;
    for(const ti of patch.members)removed.add(ti);for(const ti of opposite.members)removed.add(ti);
    remember(patch);
  }
  // A singly exported interface has three surface branches around its rim.
  // Compare geometric edge intervals, not vertex IDs: one neighboring face can
  // span a rim vertex that another exporter has explicitly inserted (T-junction).
  const pairedInterfaces=interfaces.length;let comparisons=0,singleSheets=0,candidates=0,rejected=0;
  const edgeRefs=[...edges.values()],edgeIndex=stlContactEdgeIndex(vertices,edgeRefs.map(refs=>[refs[0].a,refs[0].b]));
  const activeRefs=(key:string)=>edges.get(key)!.filter(ref=>!removed.has(ref.triangle));
  for(const patch of patches){
    if(patch.members.some(ti=>removed.has(ti))||!patch.boundary.some(ref=>activeRefs(edgeKey(ref.a,ref.b)).length>2))continue;
    candidates++;const members=new Set(patch.members);
    const perimeterCovered=patch.boundary.every(boundary=>{
      const a=vertices[boundary.a],b=vertices[boundary.b],d=V.sub(b,a),length=V.len(d),distance=STL_IMPORT_POLICY.contactEdgeDistance;
      const events:{position:number;change:number}[]=[];
      for(const edgeId of edgeIndex.query(a,b)){
        const refs=edgeRefs[edgeId];
        if(++comparisons>STL_IMPORT_POLICY.maxContactEdgeComparisons){trace?.('budget-exceeded',{stage:'contact-classification',comparisons,limit:STL_IMPORT_POLICY.maxContactEdgeComparisons,patchTriangles:patch.members.length,boundaryEdges:patch.boundary.length,rim:[a,b],triangleIndices:patch.members.slice(0,MESH_IMPORT_DIAGNOSTIC_POLICY.sampleLimit)});throw Error('STL contact classification exceeds the edge-comparison budget.');}
        const count=refs.filter(ref=>!members.has(ref.triangle)&&!removed.has(ref.triangle)).length;if(!count)continue;
        const p=vertices[refs[0].a],q=vertices[refs[0].b];
        if(V.len(V.cross(V.sub(p,a),d))/length>distance||V.len(V.cross(V.sub(q,a),d))/length>distance)continue;
        const tp=V.dot(V.sub(p,a),d)/length,tq=V.dot(V.sub(q,a),d)/length;
        const lo=Math.max(0,Math.min(tp,tq)),hi=Math.min(length,Math.max(tp,tq));if(hi-lo<=distance)continue;
        events.push({position:lo,change:count},{position:hi,change:-count});
      }
      events.sort((x,y)=>x.position-y.position);let coverage=0,last=0;
      for(const event of events){if(event.position-last>distance&&coverage<2)return false;coverage+=event.change;last=event.position;}
      return length-last<=distance;
    });
    if(perimeterCovered){for(const ti of patch.members)removed.add(ti);singleSheets++;remember(patch);}else {rejected++;if(rejected<=MESH_IMPORT_DIAGNOSTIC_POLICY.sampleLimit)trace?.('contact-rejected',{reason:'Perimeter is not covered twice by the remaining surface',patchTriangles:patch.members.length,boundaryEdges:patch.boundary.length,triangleIndices:patch.members.slice(0,MESH_IMPORT_DIAGNOSTIC_POLICY.sampleLimit),rimSample:patch.boundary.slice(0,MESH_IMPORT_DIAGNOSTIC_POLICY.sampleLimit).map(ref=>[vertices[ref.a],vertices[ref.b]])});}
  }
  trace?.('contact-classification-result',{patches:patches.length,pairedInterfaces,singleSheets,candidates,rejected,comparisons,comparisonLimit:STL_IMPORT_POLICY.maxContactEdgeComparisons,removedTriangles:removed.size,interfaces:interfaces.length});
  if(!removed.size)return null;
  const result=triangles.filter((_,ti)=>!removed.has(ti));if(!result.length)return null;
  const stats=triangleMeshEdgeStats({vertices,triangles:result,edges:[],face:result.map(()=> 'stl')});
  // Only a proven single-sheet perimeter permits residual T-junctions. The
  // caller must conform those seams with closed output required, even when the
  // user requested opening repair. An unrelated missing face cannot be hidden.
  trace?.('contact-residual-topology',{openEdges:stats.boundary,nonManifoldEdges:stats.nonManifold,accepted:!(stats.nonManifold||stats.boundary&&!singleSheets)});
  if(stats.nonManifold||stats.boundary&&!singleSheets)return null;
  return {triangles:result,interfaces,removedContactTriangles:removed.size,removedDuplicateTriangles};
}

// Cut only proven contact perimeters on the already closed exterior surface.
// Restore one copy of the original interface to each adjacent part. Every part
// must independently close and retain the total material volume; no guessed cap
// or merged substitute is accepted when separation was requested.
function stlSeparateContactParts(mesh:Mesh,interfaces:STLContactInterface[],trace?:MeshImportDiagnostic):Mesh[] {
  const topology=stlEdgeTopology(mesh.triangles),blocked=new Set<string>(),rims:Set<string>[]=interfaces.map(()=>new Set());let comparisons=0;
  const edges=[...topology.edges],edgeIndex=stlContactEdgeIndex(mesh.vertices,edges.map(([,refs])=>[refs[0].a,refs[0].b]));
  const within=(a:Vec3,b:Vec3,c:Vec3,d:Vec3)=>{
    const direction=V.sub(d,c),length=V.len(direction),distance=STL_IMPORT_POLICY.contactEdgeDistance;
    return [a,b].every(p=>{const t=V.dot(V.sub(p,c),direction)/length;return t>=-distance&&t<=length+distance&&V.len(V.cross(V.sub(p,c),direction))/length<=distance;});
  };
  for(let i=0;i<interfaces.length;i++)for(const [c,d] of interfaces[i].boundary){
    for(const edgeId of edgeIndex.query(mesh.vertices[c],mesh.vertices[d])){
      const [key,refs]=edges[edgeId];if(rims[i].has(key))continue;
      const a=mesh.vertices[refs[0].a],b=mesh.vertices[refs[0].b];
      if(++comparisons>STL_IMPORT_POLICY.maxContactSplitComparisons){trace?.('budget-exceeded',{stage:'contact-separation',comparisons,limit:STL_IMPORT_POLICY.maxContactSplitComparisons,interfaceIndex:i,rim:[mesh.vertices[c],mesh.vertices[d]]});throw Error('STL contact separation exceeds the edge-comparison budget.');}
      if(within(a,b,mesh.vertices[c],mesh.vertices[d])){blocked.add(key);rims[i].add(key);}
    }
  }
  trace?.('contact-rims',{interfaces:interfaces.length,blockedEdges:blocked.size,comparisons,comparisonLimit:STL_IMPORT_POLICY.maxContactSplitComparisons});
  const neighbors:number[][]=mesh.triangles.map(()=>[]);
  for(const [key,refs] of topology.edges)if(!blocked.has(key)){neighbors[refs[0].triangle].push(refs[1].triangle);neighbors[refs[1].triangle].push(refs[0].triangle);}
  const owner=new Int32Array(mesh.triangles.length).fill(-1),components:number[][]=[];
  for(let seed=0;seed<owner.length;seed++){
    if(owner[seed]>=0)continue;if(components.length>=STL_IMPORT_POLICY.maxShells)throw Error('STL contact separation exceeds the shell budget.');
    const component=[seed],index=components.length;owner[seed]=index;
    for(let q=0;q<component.length;q++)for(const next of neighbors[component[q]])if(owner[next]<0){owner[next]=index;component.push(next);}
    components.push(component);
  }
  trace?.('contact-components',{components:components.length,componentTriangles:components.map(component=>component.length)});
  const additions:[number,number,number][][]=components.map(()=>[]);
  for(let i=0;i<interfaces.length;i++){
    const adjacent=new Set<number>();for(const key of rims[i])for(const ref of topology.edges.get(key)!)adjacent.add(owner[ref.triangle]);
    if(adjacent.size!==2){trace?.('contact-ambiguous',{interfaceIndex:i,adjacentComponents:[...adjacent],rimEdges:rims[i].size,capTriangles:interfaces[i].triangles.length,rimSample:interfaces[i].boundary.slice(0,MESH_IMPORT_DIAGNOSTIC_POLICY.sampleLimit).map(([a,b])=>[mesh.vertices[a],mesh.vertices[b]])});throw Error('Touching STL parts cannot be separated safely at this contact. Disable Keep touching parts separate to import the closed combined surface.');}
    for(const index of adjacent)additions[index].push(...interfaces[i].triangles);
  }
  return components.map((component,index)=>{
    const triangles=[...component.map(ti=>mesh.triangles[ti]),...additions[index]].map(t=>[...t] as [number,number,number]);
    const candidate:Mesh={vertices:mesh.vertices,triangles,edges:[],face:triangles.map(()=> 'stl')};
    trace?.('contact-part-conform',{partIndex:index,parts:components.length,exteriorTriangles:component.length,capTriangles:additions[index].length});
    return conformTriangleMeshBoundaries(candidate,true,STL_IMPORT_POLICY.maxTriangles);
  });
}
function stlTriangleVolume(vertices:Vec3[],triangles:[number,number,number][]):number {
  const origin=vertices[triangles[0][0]];let volume=0;
  for(const [a,b,c] of triangles)volume+=V.dot(V.sub(vertices[a],origin),V.cross(V.sub(vertices[b],origin),V.sub(vertices[c],origin)))/6;
  return volume;
}

function stlEdgeTopology(triangles:[number,number,number][],requireClosed=true):{edges:Map<string,STLEdgeRef[]>;adjacency:STLAdjacency[][];boundaryCount:number;nonManifoldCount:number} {
  const edges=new Map<string,STLEdgeRef[]>();
  for(let ti=0;ti<triangles.length;ti++)for(let e=0;e<3;e++){
    const a=triangles[ti][e],b=triangles[ti][(e+1)%3],k=a<b?`${a}|${b}`:`${b}|${a}`,list=edges.get(k)||[];list.push({triangle:ti,a,b});edges.set(k,list);
  }
  let boundaryCount=0,nonManifoldCount=0;for(const refs of edges.values()){if(refs.length===1)boundaryCount++;else if(refs.length!==2)nonManifoldCount++;}
  if(nonManifoldCount||requireClosed&&boundaryCount)throw Error(`STL is not a closed manifold (open edges: ${boundaryCount}, non-manifold edges: ${nonManifoldCount}).`);
  const adjacency:Array<STLAdjacency[]>=Array.from({length:triangles.length},()=>[]);
  for(const refs of edges.values())if(refs.length===2){
    const a=refs[0],b=refs[1],sameDirection=a.a===b.a&&a.b===b.b;
    adjacency[a.triangle].push({triangle:b.triangle,sameDirection});adjacency[b.triangle].push({triangle:a.triangle,sameDirection});
  }
  return {edges,adjacency,boundaryCount,nonManifoldCount};
}

function stlBoundaryLoops(edges:Map<string,STLEdgeRef[]>):number[][] {
  const boundary=[...edges.values()].filter(refs=>refs.length===1).map(refs=>refs[0]);
  if(!boundary.length)return [];
  const neighbors=new Map<number,number[]>();
  const add=(a:number,b:number)=>{const list=neighbors.get(a)||[];list.push(b);neighbors.set(a,list);};
  for(const edge of boundary){add(edge.a,edge.b);add(edge.b,edge.a);}
  for(const [vertex,list] of neighbors)if(list.length!==2)throw Error(`Open STL boundary is not a simple loop at welded vertex ${vertex} (degree ${list.length}).`);
  const edgeKey=(a:number,b:number)=>a<b?`${a}|${b}`:`${b}|${a}`,unused=new Set(boundary.map(e=>edgeKey(e.a,e.b))),loops:number[][]=[];
  while(unused.size){
    if(loops.length>=STL_IMPORT_POLICY.maxRepairBoundaryLoops)throw Error(`STL has too many open boundary loops to repair (maximum ${STL_IMPORT_POLICY.maxRepairBoundaryLoops}).`);
    const firstKey=unused.values().next().value as string,[aText,bText]=firstKey.split('|'),start=Number(aText),first=Number(bText),loop=[start];let previous=start,current=first;unused.delete(firstKey);
    while(current!==start){
      if(loop.includes(current))throw Error('Open STL boundary self-connects before closing a simple loop.');
      loop.push(current);if(loop.length>STL_IMPORT_POLICY.maxRepairBoundaryVertices)throw Error(`An open STL boundary has too many vertices to repair (maximum ${STL_IMPORT_POLICY.maxRepairBoundaryVertices}).`);
      const nextCandidates=neighbors.get(current)!;const next=nextCandidates[0]===previous?nextCandidates[1]:nextCandidates[0],key=edgeKey(current,next);
      if(!unused.has(key)){if(next===start)break;throw Error('Open STL boundary could not be traced as a simple loop.');}
      unused.delete(key);previous=current;current=next;
    }
    if(loop.length<3)throw Error('Open STL boundary has fewer than three vertices.');
    loops.push(loop);
  }
  return loops;
}

function stlRepairPlanarBoundaries(vertices:Vec3[],triangles:[number,number,number][],topology:{edges:Map<string,STLEdgeRef[]>;boundaryCount:number}):STLImportRepair {
  if(!topology.boundaryCount)return {cappedBoundaryLoops:0,addedTriangles:0};
  const loops=stlBoundaryLoops(topology.edges),planes:Plane[]=[],projected:Vec2[][]=[];
  for(let i=0;i<loops.length;i++){
    const points=loops[i].map(id=>vertices[id]),plane=planeFromPoints(points);
    if(V.len(plane.normal)<.9)throw Error(`Open STL boundary ${i+1} is degenerate and cannot be capped.`);
    const maxDistance=Math.max(...points.map(p=>Math.abs(V.dot(plane.normal,p)-plane.offset)));
    if(maxDistance>STL_IMPORT_POLICY.repairPlanarDistance)throw Error(`Open STL boundary ${i+1} is not planar enough to repair automatically (deviation ${fmt(maxDistance)} mm).`);
    const basis=planeBasis(plane,points[0]),loop2=points.map(p=>toPlane2(p,basis));
    if(Math.abs(v2.area(loop2))<=TOL.minimumFaceArea||polygonSelfIntersects(loop2))throw Error(`Open STL boundary ${i+1} is not a simple planar opening.`);
    planes.push(plane);projected.push(loop2);
  }
  // Nested coplanar loops describe a face with holes. Filling them independently
  // would guess away the hole, so the conservative repair refuses that case.
  for(let i=0;i<loops.length;i++)for(let j=i+1;j<loops.length;j++){
    const pointsJ=loops[j].map(id=>vertices[id]),coplanar=pointsJ.every(p=>Math.abs(V.dot(planes[i].normal,p)-planes[i].offset)<=STL_IMPORT_POLICY.repairPlanarDistance);if(!coplanar)continue;
    const basis=planeBasis(planes[i],vertices[loops[i][0]]),a=loops[i].map(id=>toPlane2(vertices[id],basis)),b=loops[j].map(id=>toPlane2(vertices[id],basis));
    if(pointInPolygon2(b[0],a)||pointInPolygon2(a[0],b))throw Error('STL has nested coplanar open boundaries; automatic repair would change a hole, so import was stopped.');
  }
  const before=triangles.length;
  for(let i=0;i<loops.length;i++){
    let cap:[number,number,number][];try{cap=triangulateSimple2(projected[i]);}catch(error){throw Error(`Open STL boundary ${i+1} could not be triangulated for repair: ${errorMessage(error)}`);}
    for(const [a,b,c] of cap)triangles.push([loops[i][a],loops[i][b],loops[i][c]]);
  }
  if(triangles.length>STL_IMPORT_POLICY.maxTriangles)throw Error(`Automatic STL repair would exceed the triangle limit (${STL_IMPORT_POLICY.maxTriangles.toLocaleString('en-US')}).`);
  return {cappedBoundaryLoops:loops.length,addedTriangles:triangles.length-before};
}

function orientSTLShells(vertices:Vec3[],triangles:[number,number,number][],adjacency:STLAdjacency[][]):number[][] {
  const flip:Array<boolean|undefined>=Array(triangles.length),components:number[][]=[];
  for(let seed=0;seed<triangles.length;seed++){
    if(flip[seed]!==undefined)continue;
    if(components.length>=STL_IMPORT_POLICY.maxShells)throw Error(`The STL contains too many disconnected shells (maximum ${STL_IMPORT_POLICY.maxShells}).`);
    flip[seed]=false;const component:number[]=[],queue=[seed];
    for(let q=0;q<queue.length;q++){
      const ti=queue[q],currentFlip=flip[ti]!;component.push(ti);
      for(const link of adjacency[ti]){
        const expected=link.sameDirection?!currentFlip:currentFlip;
        if(flip[link.triangle]===undefined){flip[link.triangle]=expected;queue.push(link.triangle);}else if(flip[link.triangle]!==expected)throw Error('The STL surface has inconsistent or non-orientable triangle winding.');
      }
    }
    const used=new Set<number>();for(const ti of component)for(const id of triangles[ti])used.add(id);let center:Vec3=[0,0,0];for(const id of used)center=V.add(center,vertices[id]);center=V.mul(center,1/Math.max(1,used.size));
    let volume=0;for(const ti of component){let [ia,ib,ic]=triangles[ti];if(flip[ti]){const t=ib;ib=ic;ic=t;}const a=V.sub(vertices[ia],center),b=V.sub(vertices[ib],center),c=V.sub(vertices[ic],center);volume+=V.dot(a,V.cross(b,c))/6;}
    if(Math.abs(volume)<=TOL.minimumFaceArea)throw Error('An STL shell has zero or near-zero enclosed volume.');
    if(volume<0)for(const ti of component)flip[ti]=!flip[ti];
    components.push(component);
  }
  for(let ti=0;ti<triangles.length;ti++)if(flip[ti]){const t=triangles[ti][1];triangles[ti][1]=triangles[ti][2];triangles[ti][2]=t;}
  return components;
}

function stlPlanarGroups(vertices:Vec3[],triangles:[number,number,number][],component:number[],adjacency:STLAdjacency[][]):Map<number,number> {
  const componentSet=new Set(component),planes=new Map<number,Plane>();for(const ti of component){const t=triangles[ti];planes.set(ti,planeFromPoints([vertices[t[0]],vertices[t[1]],vertices[t[2]]]));}
  const groupByTriangle=new Map<number,number>();let nextGroup=0;
  // Oppositely directed coplanar neighbours can be zero-thickness folds.
  // Their shared indexed edges cancel just like ordinary internal diagonals;
  // reconstruction still requires a unique planar boundary, source volume
  // preservation and closed export. Do not move or project source vertices.
  const coplanar=(a:Plane,b:Plane)=>{const alignment=V.dot(a.normal,b.normal);return Math.abs(alignment)>1-STL_IMPORT_POLICY.coplanarAngle&&Math.abs(a.offset-(alignment<0?-b.offset:b.offset))<=STL_IMPORT_POLICY.coplanarDistance;};
  const fitsFinalFacePlane=(ti:number,plane:Plane)=>triangles[ti].every(id=>Math.abs(V.dot(plane.normal,vertices[id])-plane.offset)<=STL_IMPORT_POLICY.mergePlanarityDistance);
  // STL float coordinates can make neighbouring triangles look coplanar by
  // normal/offset while their combined vertices are not planar enough for one
  // validated B-rep face. Only merge a triangle when every one of its vertices
  // fits the seed face plane inside the final face-planarity budget. Otherwise
  // leave it for a later (smaller) group instead of rejecting the closed mesh.
  for(const seed of component){if(groupByTriangle.has(seed))continue;const group=nextGroup++,reference=planes.get(seed)!,queue=[seed];groupByTriangle.set(seed,group);for(let q=0;q<queue.length;q++){const ti=queue[q];for(const link of adjacency[ti])if(componentSet.has(link.triangle)&&!groupByTriangle.has(link.triangle)&&coplanar(reference,planes.get(link.triangle)!)&&fitsFinalFacePlane(link.triangle,reference)){groupByTriangle.set(link.triangle,group);queue.push(link.triangle);}}}
  return groupByTriangle;
}

function convertSTLTriangles(source:Vec3[][],format:'binary'|'ascii'='ascii',repairOpenings=true,keepTouchingPartsSeparate=false,trace?:MeshImportDiagnostic):STLImportResult {
  if(!source.length)throw Error('The STL contains no triangles.');
  if(source.length>STL_IMPORT_POLICY.maxTriangles)throw Error(`The STL contains too many triangles (maximum ${STL_IMPORT_POLICY.maxTriangles.toLocaleString('en-US')}).`);
  // Preserve independently verified closed source batches before global
  // welding/deduplication erases ownership at coincident/overlapping surfaces.
  if(keepTouchingPartsSeparate){
    const batches=stlClosedSourceBatches(source,trace);
    if(batches)return stlConvertClosedSourceBatches(source,batches,format,repairOpenings,trace);
  }
  trace?.('weld-start',{triangles:source.length,repairOpenings,keepTouchingPartsSeparate});
  const welded=weldSTLTriangles(source,true);let contactInterfaces:STLContactInterface[]=[];
  if(!welded.triangles.length)throw Error('The STL contains no usable surface triangles after redundant-triangle cleanup.');
  const counts=triangleMeshEdgeCounts({vertices:welded.vertices,triangles:welded.triangles,edges:[],face:welded.triangles.map(()=> 'stl')});
  if(trace)trace('weld-complete',{triangles:welded.triangles.length,vertices:welded.vertices.length,cleanup:welded.cleanup,...meshImportEdgeDiagnostic(welded.vertices,counts)});
  if([...counts.values()].some(count=>count>2)){
    trace?.('contact-classification-start',{triangles:welded.triangles.length,duplicateTriangles:welded.duplicateTriangles.length});
    const cancelled=stlCancelContactInterfaces(welded.vertices,[...welded.triangles,...welded.duplicateTriangles],trace);
    if(cancelled){contactInterfaces=cancelled.interfaces;welded.triangles=cancelled.triangles;welded.cleanup.removedContactTriangles=cancelled.removedContactTriangles;welded.cleanup.removedDuplicateTriangles=cancelled.removedDuplicateTriangles;}
  }
  // Share the kernel's boundary-only seam rule with export. Splitting at an
  // existing boundary vertex restores matching edges without capping a hole.
  trace?.('seam-conform-start',{triangles:welded.triangles.length,requireClosed:!!welded.cleanup.removedContactTriangles});
  const conformed=conformTriangleMeshBoundaries({vertices:welded.vertices,triangles:welded.triangles,edges:[],face:welded.triangles.map(()=> 'stl')},!!welded.cleanup.removedContactTriangles,STL_IMPORT_POLICY.maxTriangles);
  welded.cleanup.addedSeamTriangles=conformed.triangles.length-welded.triangles.length;welded.vertices=conformed.vertices;welded.triangles=conformed.triangles;
  meshImportTopologyDiagnostic(trace,'seam-conform-complete',conformed);
  const initialTopology=stlEdgeTopology(welded.triangles,false);
  if(initialTopology.nonManifoldCount)throw Error(`STL is non-manifold (${initialTopology.nonManifoldCount} edges are shared by more than two triangles); automatic repair only closes simple planar openings.`);
  if(initialTopology.boundaryCount&&!repairOpenings)throw Error(`STL has ${initialTopology.boundaryCount} open edges after redundant-triangle and seam cleanup. Closed solids are required unless planar-opening repair is explicitly enabled.`);
  trace?.('opening-repair-start',{openEdges:initialTopology.boundaryCount,enabled:repairOpenings});
  const repair=initialTopology.boundaryCount?stlRepairPlanarBoundaries(welded.vertices,welded.triangles,initialTopology):undefined,topology=stlEdgeTopology(welded.triangles,true),shells:STLImportShell[]=[];
  trace?.('closed-topology',{triangles:welded.triangles.length,repair:repair||null});
  let expectedVolume=0;
  if(keepTouchingPartsSeparate&&contactInterfaces.length){trace?.('exterior-orientation-start',{triangles:welded.triangles.length});orientSTLShells(welded.vertices,welded.triangles,topology.adjacency);expectedVolume=stlTriangleVolume(welded.vertices,welded.triangles);}
  trace?.('contact-separation-start',{enabled:keepTouchingPartsSeparate,interfaces:contactInterfaces.length});
  const parts=keepTouchingPartsSeparate&&contactInterfaces.length?stlSeparateContactParts(conformed,contactInterfaces,trace):[conformed];let importedVolume=0;
  if(keepTouchingPartsSeparate&&contactInterfaces.length)welded.cleanup.separatedContactParts=parts.length;
  let preparedTriangles=0;
  trace?.('parts-prepared',{parts:parts.length});
  for(const part of parts){
    trace?.('shell-orientation-start',{partIndex:parts.indexOf(part),triangles:part.triangles.length,shellsSoFar:shells.length});
    preparedTriangles+=part.triangles.length;if(preparedTriangles>STL_IMPORT_POLICY.maxTriangles)throw Error('STL contact separation exceeds the triangle budget.');
    const partTopology=stlEdgeTopology(part.triangles),components=orientSTLShells(part.vertices,part.triangles,partTopology.adjacency);
    trace?.('shell-orientation-complete',{components:components.length,componentTriangles:components.map(component=>component.length)});
    for(const component of components){
      const shellIndex=shells.length;if(shellIndex>=STL_IMPORT_POLICY.maxShells)throw Error('The STL contains too many disconnected shells.');
      const usedVertices=new Set<number>();for(const ti of component)for(const id of part.triangles[ti])usedVertices.add(id);if(usedVertices.size>STL_IMPORT_POLICY.maxEditableVerticesPerShell)throw Error(`STL shell ${shellIndex+1} has too many welded vertices (${usedVertices.size.toLocaleString('en-US')}; maximum ${STL_IMPORT_POLICY.maxEditableVerticesPerShell.toLocaleString('en-US')}).`);
      trace?.('planar-groups-start',{shellIndex,triangles:component.length,vertices:usedVertices.size});
      const groups=stlPlanarGroups(part.vertices,part.triangles,component,partTopology.adjacency);if(new Set(groups.values()).size>STL_IMPORT_POLICY.maxEditableFacesPerShell)throw Error(`STL shell ${shellIndex+1} has too many editable face groups (maximum ${STL_IMPORT_POLICY.maxEditableFacesPerShell.toLocaleString('en-US')}).`);
      let rebuilt:{solid:Solid;planarGroupCount:number;preservedFacetedGroups:number};try{rebuilt=buildEditableSTLShell(part.vertices,part.triangles,component,groups,shellIndex,'STL',trace,partTopology.edges);importedVolume+=validateSolid(rebuilt.solid).volume;}catch(error){throw Error(`STL shell ${shellIndex+1} could not be converted to a valid editable solid: ${errorMessage(error)}`);}
      shells.push({solid:rebuilt.solid,triangleCount:component.length,planarGroupCount:rebuilt.planarGroupCount,...(rebuilt.preservedFacetedGroups?{preservedFacetedGroups:rebuilt.preservedFacetedGroups}: {})});
    }
  }
  trace?.('volume-check',{shells:shells.length,importedVolume,expectedVolume:keepTouchingPartsSeparate&&contactInterfaces.length?expectedVolume:null,absoluteTolerance:STL_IMPORT_POLICY.contactVolumeAbsoluteTolerance,relativeTolerance:STL_IMPORT_POLICY.contactVolumeRelativeTolerance});
  if(keepTouchingPartsSeparate&&contactInterfaces.length&&Math.abs(importedVolume-expectedVolume)>Math.max(STL_IMPORT_POLICY.contactVolumeAbsoluteTolerance,expectedVolume*STL_IMPORT_POLICY.contactVolumeRelativeTolerance))throw Error('STL contact separation did not preserve the material volume.');
  return {format,triangleCount:source.length,weldedVertexCount:welded.vertices.length,shells,...(repair&&repair.cappedBoundaryLoops?{repair}: {}),...(Object.values(welded.cleanup).some(count=>count>0)?{cleanup:welded.cleanup}: {})};
}

function importSTLArrayBuffer(buffer:ArrayBuffer):STLImportResult {
  const format=detectSTLFormat(buffer),triangles=stlTrianglePoints(buffer,format);return convertSTLTriangles(triangles,format);
}
