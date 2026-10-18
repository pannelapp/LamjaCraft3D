interface ObjectCheckResult {
  status:'passed'|'failed'|'incomplete';
  errors:string[];
  volume:number|null;
  counts:{vertices:number;halfEdges:number;loops:number;faces:number};
}

// Inspect the actual runtime graph. Serialization/reconstruction would hide broken
// twin/loop links and is therefore inappropriate for a read-only health check.
function checkObjectSolid(s:Solid):ObjectCheckResult {
  const counts={vertices:s.vertices.size,halfEdges:s.halfEdges.size,loops:s.loops.size,faces:s.faces.size},errors:string[]=[];
  for(const vertex of s.vertices.values())if(!vertex.position.every(Number.isFinite))errors.push(`Non-finite vertex ${vertex.id}`);
  for(const face of s.faces.values()){
    if(!face.plane.normal.every(Number.isFinite)||!Number.isFinite(face.plane.offset))errors.push(`Non-finite face plane ${face.id}`);
    else if(Math.abs(V.len(face.plane.normal)-1)>TOL.coplanarAngle)errors.push(`Non-unit face normal ${face.id}`);
  }
  // Non-finite coordinates are not suitable inputs to triangulation.
  if(errors.some(error=>error.startsWith('Non-finite')))return {status:'failed',errors,volume:null,counts};
  try{
    const validation=validateSolid(s,false);
    errors.push(...validation.errors);
    if(!Number.isFinite(validation.volume))errors.push('Non-finite volume');
    return {status:errors.length?'failed':'passed',errors:[...new Set(errors)],volume:Number.isFinite(validation.volume)?validation.volume:null,counts};
  }catch(error){
    errors.push(`Check could not complete: ${errorMessage(error)}`);
    return {status:'incomplete',errors:[...new Set(errors)],volume:null,counts};
  }
}
