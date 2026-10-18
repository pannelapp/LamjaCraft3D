// Reconstruct planar regions from source edge ownership, without geometric
// edge splitting, coordinate projection or boundary simplification.
const STL_PLANAR_MERGE_POLICY = Object.freeze({
  maximumRecoveryChecks: 32,
  maximumRecoveryTriangleVisits: 2000000,
});

interface STLPlanarRegion {
  group: number;
  triangles: number[];
  face: ProjectSolid['faces'][number] | null;
  opposedTriangles?: number;
  rejection?: string;
}
type STLRebuildAttempt =
  | { ok: true; solid: Solid }
  | { ok: false; stage: 'reconstruction' | 'exportability'; message: string };

function stlIndexedPlanarRegion(
  vertices: Vec3[], triangles: [number,number,number][], indices: number[],
  group: number, groups: Map<number,number>, edges: Map<string,STLEdgeRef[]>,
  shellIndex: number, provenance: FaceProvenance,
): STLPlanarRegion {
  const rejected = (rejection: string): STLPlanarRegion => ({group, triangles: indices, face: null, rejection});
  if (indices.length < 2) return {group, triangles: indices, face: null};
  const outgoing = new Map<number,number>(), incoming = new Set<number>();
  for (const ti of indices) for (let e = 0; e < 3; e++) {
    const a = triangles[ti][e], b = triangles[ti][(e+1)%3];
    const refs = edges.get(a < b ? `${a}|${b}` : `${b}|${a}`)!;
    if (refs.length === 2 && refs.every(ref => groups.get(ref.triangle) === group)) continue;
    // Pinched regions remain triangles. A planar face needs disjoint simple
    // loops; choosing a branch by proximity would change source ownership.
    if (outgoing.has(a) || incoming.has(b)) return rejected('Branching planar boundary');
    outgoing.set(a,b); incoming.add(b);
  }
  const loops: number[][] = [];
  while (outgoing.size) {
    const start = outgoing.keys().next().value!;
    const loop: number[] = []; let current = start;
    do {
      const next = outgoing.get(current);
      if (next === undefined) return rejected('Unclosed planar boundary');
      loop.push(current); outgoing.delete(current); current = next;
    } while (current !== start);
    if (loop.length < 3) return rejected('Degenerate planar boundary');
    loops.push(loop);
  }
  if (!loops.length) return rejected('Coplanar region has no surviving boundary');
  // Source triangle order cannot choose the resulting face orientation: a
  // coplanar fold may supply an opposite-facing seed. The largest surviving
  // boundary owns the material winding; its plane also keeps holes opposite.
  const reference = planeFromPoints(triangles[indices[0]].map(i => vertices[i]));
  const seedBasis = planeBasis(reference, vertices[triangles[indices[0]][0]]);
  const areas = loops.map(loop=>Math.abs(v2.area(loop.map(i=>toPlane2(vertices[i],seedBasis)))));
  const primary = loops[areas.reduce((largest,area,index)=>area>areas[largest]?index:largest,0)];
  const plane = planeFromPoints(primary.map(i=>vertices[i]));
  const basis = planeBasis(plane,vertices[primary[0]]);
  const outer: number[][] = [], holes: number[][] = [];
  for (const loop of loops) {
    const area = v2.area(loop.map(i => toPlane2(vertices[i],basis)));
    if (Math.abs(area) <= TOL.minimumFaceArea) return rejected('Degenerate planar loop area');
    (area > 0 ? outer : holes).push(loop);
  }
  if (outer.length !== 1) return rejected('Planar region has no unique outer boundary');
  if (indices.some(ti => triangles[ti].some(i => Math.abs(V.dot(plane.normal,vertices[i])-plane.offset) > TOL.plane))) {
    return rejected('Merged boundary exceeds the existing face planarity budget');
  }
  const outer2 = outer[0].map(i => toPlane2(vertices[i],basis));
  if (holes.some(loop => !pointInPolygon2(toPlane2(vertices[loop[0]],basis),outer2))) {
    return rejected('Planar hole is outside its outer boundary');
  }
  const opposedTriangles = indices.filter(ti=>V.dot(plane.normal,planeFromPoints(triangles[ti].map(i=>vertices[i])).normal)<0).length;
  return {group, triangles: indices, opposedTriangles, face: {
    id: `f${indices.reduce((minimum,index)=>Math.min(minimum,index),indices[0])+1}`,
    outer: outer[0].map(i => `v${i+1}`), holes: holes.map(loop => loop.map(i => `v${i+1}`)),
    provenance, boundaryGroup: `stl:${shellIndex}:face:${group}`,
  }};
}

function buildEditableSTLShell(
  vertices: Vec3[], triangles: [number,number,number][], component: number[],
  groups: Map<number,number>, shellIndex: number, importLabel = 'STL', trace?: MeshImportDiagnostic,
  sourceEdges?: Map<string,STLEdgeRef[]>,
): {solid: Solid; planarGroupCount: number; preservedFacetedGroups: number} {
  const provenance: FaceProvenance = {kind:'import',label:importLabel};
  const byGroup = new Map<number,number[]>();
  for (const ti of component) {
    const group = groups.get(ti)!; const list = byGroup.get(group);
    if (list) list.push(ti); else byGroup.set(group,[ti]);
  }
  const edges = sourceEdges || stlEdgeTopology(triangles).edges;
  const regions = [...byGroup].map(([group,indices]) => stlIndexedPlanarRegion(vertices,triangles,indices,group,groups,edges,shellIndex,provenance));
  for (const region of regions) if (region.rejection) {
    trace?.('planar-region-preserved',{shellIndex,group:region.group,triangles:region.triangles.length,reason:region.rejection});
  }
  const candidates = regions.filter(region => region.face !== null);
  const expectedVolume = stlTriangleVolume(vertices,component.map(ti => triangles[ti]));
  const volumeTolerance = Math.max(STL_IMPORT_POLICY.contactVolumeAbsoluteTolerance,expectedVolume*STL_IMPORT_POLICY.contactVolumeRelativeTolerance);
  let pass = 0;
  const attempt = (merged: Set<number>): STLRebuildAttempt => {
    const currentPass = pass++;
    trace?.('rebuild-start',{shellIndex,pass:currentPass,triangles:component.length,groups:regions.length,preservedFacetedGroups:regions.length-merged.size,representation:merged.size?'indexed-planar-boundaries':'indexed-triangles'});
    let stage: 'reconstruction' | 'exportability' = 'reconstruction';
    // This is the single adapter for the canonical constructor/exporter's
    // throwing contract. Recovery consumes explicit candidate results.
    try {
      const faces: ProjectSolid['faces'] = [];
      for (const region of regions) {
        if (merged.has(region.group) && region.face) faces.push(region.face);
        else for (const ti of region.triangles) faces.push({id:`f${ti+1}`,outer:triangles[ti].map(i=>`v${i+1}`),holes:[],provenance,boundaryGroup:`stl:${shellIndex}:triangle:${ti}`});
      }
      const used = new Set<number>();
      for (const region of regions) {
        if (merged.has(region.group) && region.face) {
          for (const id of region.face.outer) used.add(Number(id.slice(1))-1);
          for (const loop of region.face.holes) for (const id of loop) used.add(Number(id.slice(1))-1);
        } else for (const ti of region.triangles) for (const index of triangles[ti]) used.add(index);
      }
      const solid = deserializeProjectSolid({schema:'poly-brep-1',id:`stl_shell_${shellIndex+1}`,metadata:{},faces,vertices:[...used].map(index=>({id:`v${index+1}`,position:vertices[index]}))});
      const validation = validateSolid(solid,false);
      if (Math.abs(validation.volume-expectedVolume) > volumeTolerance) throw Error('Planar reconstruction did not preserve source material volume.');
      trace?.('rebuild-validation',{shellIndex,pass:currentPass,ok:true,faces:solid.faces.size,vertices:solid.vertices.size,errors:[]});
      stage = 'exportability'; trace?.('exportability-start',{shellIndex,pass:currentPass});
      solidMeshExportLocal(solid);
      return {ok:true,solid};
    } catch (error) {
      const message = errorMessage(error);
      trace?.('rebuild-rejected',{shellIndex,pass:currentPass,stage,message,fallbackAvailable:merged.size>0});
      return {ok:false,stage,message};
    }
  };
  const finish = (solid: Solid, merged: Set<number>) => {
    for (const region of regions) if (region.opposedTriangles&&merged.has(region.group)) {
      trace?.('planar-fold-merged',{shellIndex,group:region.group,sourceTriangles:region.triangles.length,opposedTriangles:region.opposedTriangles});
    }
    const preservedFacetedGroups = regions.filter(region=>region.triangles.length>1&&!merged.has(region.group)).length;
    trace?.('shell-complete',{shellIndex,faces:solid.faces.size,vertices:solid.vertices.size,preservedFacetedGroups});
    return {solid,planarGroupCount:solid.faces.size,preservedFacetedGroups};
  };
  const all = new Set(candidates.map(region=>region.group)), whole = attempt(all);
  if (whole.ok) return finish(whole.solid,all);
  if (!all.size) throw Error(whole.message);
  const polygon = buildPolygonSTLShell(vertices,triangles,component,groups,shellIndex,importLabel,trace);
  const accepted = new Set<number>(), baseline = attempt(accepted);
  if (!baseline.ok) throw Error(baseline.message);
  let solid = baseline.solid, checks = 0, triangleVisits = 0;
  // Try blocks of candidates against the last validated result. Split only a
  // rejected block; one difficult region cannot discard merging in its peers.
  // Work limits bound pathological input independently of geometric tolerance.
  const recover = (block: STLPlanarRegion[]): void => {
    if (!block.length) return;
    if (checks >= STL_PLANAR_MERGE_POLICY.maximumRecoveryChecks || triangleVisits+component.length > STL_PLANAR_MERGE_POLICY.maximumRecoveryTriangleVisits) {
      trace?.('planar-recovery-budget',{shellIndex,checks,triangleVisits,remainingGroups:block.length}); return;
    }
    checks++; triangleVisits += component.length;
    const trial = new Set(accepted); for (const region of block) trial.add(region.group);
    const result = attempt(trial);
    if (result.ok) {for (const region of block) accepted.add(region.group); solid=result.solid; return;}
    if (block.length === 1) return;
    const middle = block.length >>> 1; recover(block.slice(0,middle)); recover(block.slice(middle));
  };
  // The complete block has already failed. Start with its halves.
  const middle = candidates.length >>> 1;
  recover(candidates.slice(0,middle)); recover(candidates.slice(middle));
  if (polygon.solid.faces.size < solid.faces.size && Math.abs(validateSolid(polygon.solid,false).volume-expectedVolume) <= volumeTolerance) {
    trace?.('shell-complete',{shellIndex,faces:polygon.solid.faces.size,vertices:polygon.solid.vertices.size,preservedFacetedGroups:polygon.preservedFacetedGroups,representation:'merged-polygons'});
    return polygon;
  }
  return finish(solid,accepted);
}

// The existing polygon path can simplify collinear boundary subdivisions that
// the indexed path deliberately retains. Keep its validated result as a lower
// face-count baseline when indexed export needs selective recovery.
function buildPolygonSTLShell(vertices:Vec3[],triangles:[number,number,number][],component:number[],groups:Map<number,number>,shellIndex:number,importLabel:string='STL',trace?:MeshImportDiagnostic):{solid:Solid;planarGroupCount:number;preservedFacetedGroups:number} {
  const preservedFacetedGroups=new Set<number>(),allGroups=new Set(groups.values());
  const makeInputs=():PolyFaceInput[]=>component.map(ti=>{
    const t=triangles[ti],group=groups.get(ti)!;
    // Normally all connected coplanar triangles share one logical face group.
    // If reconstructing that merged boundary creates an invalid B-rep, only the
    // offending planar groups are kept as individual triangle faces. This keeps
    // a valid closed STL importable without discarding merging everywhere else.
    const boundaryGroup=preservedFacetedGroups.has(group)?`stl:${shellIndex}:triangle:${ti}`:`stl:${shellIndex}:face:${group}`;
    return {points:t.map(id=>vertices[id]) as Vec3[],group:boundaryGroup,provenance:{kind:'import',label:importLabel}};
  });
  const groupPrefix=`stl:${shellIndex}:face:`;
  for(let pass=0;pass<8;pass++){
    trace?.('rebuild-start',{shellIndex,pass,triangles:component.length,groups:allGroups.size,preservedFacetedGroups:preservedFacetedGroups.size,representation:preservedFacetedGroups.size===allGroups.size?'indexed-triangles':'merged-polygons'});
    let solid:Solid;
    try{solid=preservedFacetedGroups.size===allGroups.size
      ?buildSolidFromIndexedTriangles(vertices,triangles,component,`stl_shell_${shellIndex+1}`,{kind:'import',label:importLabel})
      :buildSolidFromPolygons(makeInputs(),`stl_shell_${shellIndex+1}`);}catch(error){
      trace?.('rebuild-rejected',{shellIndex,pass,stage:'reconstruction',message:errorMessage(error),fallbackAvailable:preservedFacetedGroups.size<allGroups.size});
      // A pathological merged boundary can also fail during rebuild before a
      // diagnostic solid exists. The triangle-preserving fallback below is the
      // topology-safe representation of an already verified manifold STL.
      if(preservedFacetedGroups.size<allGroups.size){for(const group of allGroups)preservedFacetedGroups.add(group);continue;}
      throw error;
    }
    const validation=validateSolid(solid,false);
    trace?.('rebuild-validation',{shellIndex,pass,ok:validation.ok,faces:solid.faces.size,vertices:solid.vertices.size,errors:validation.errors.slice(0,MESH_IMPORT_DIAGNOSTIC_POLICY.sampleLimit)});
    if(validation.ok){
      if(solid.faces.size>STL_IMPORT_POLICY.maxEditableFacesPerShell)throw Error(`STL shell ${shellIndex+1} needs ${solid.faces.size.toLocaleString('en-US')} editable faces after topology-safe reconstruction (maximum ${STL_IMPORT_POLICY.maxEditableFacesPerShell.toLocaleString('en-US')}).`);
      try{
        // Import/export must be a stable round-trip. A B-rep can be topologically
        // valid while a very complex merged planar boundary triangulates into an
        // ambiguous STL mesh. Verify exportability before accepting the merged
        // reconstruction; otherwise preserve the original manifold triangles.
        trace?.('exportability-start',{shellIndex,pass});solidMeshExportLocal(solid);
        trace?.('polygon-shell-complete',{shellIndex,faces:solid.faces.size,vertices:solid.vertices.size,preservedFacetedGroups:preservedFacetedGroups.size});
        return {solid,planarGroupCount:solid.faces.size,preservedFacetedGroups:preservedFacetedGroups.size};
      }catch(error){
        trace?.('rebuild-rejected',{shellIndex,pass,stage:'exportability',message:errorMessage(error),fallbackAvailable:preservedFacetedGroups.size<allGroups.size});
        if(preservedFacetedGroups.size<allGroups.size){for(const group of allGroups)preservedFacetedGroups.add(group);continue;}
        throw error;
      }
    }
    let added=0;
    for(const he of solid.halfEdges.values()){
      if(he.twin)continue;
      const boundaryGroup=solid.faces.get(he.face)?.boundaryGroup||'';
      if(!boundaryGroup.startsWith(groupPrefix))continue;
      const group=Number(boundaryGroup.slice(groupPrefix.length));
      if(Number.isInteger(group)&&!preservedFacetedGroups.has(group)){preservedFacetedGroups.add(group);added++;}
    }
    if(added&&pass<6)continue;
    // The source triangle mesh has already passed the closed-manifold check. If
    // logical-face merging still cannot represent it, retain every STL triangle
    // as an editable face rather than rejecting geometry that slicers correctly
    // accept as watertight.
    if(preservedFacetedGroups.size<allGroups.size){for(const group of allGroups)preservedFacetedGroups.add(group);continue;}
    throw Error(validation.errors[0]||'The STL could not be reconstructed as an editable solid.');
  }
  throw Error('The STL could not be reconstructed as an editable solid after conservative planar fallback.');
}
