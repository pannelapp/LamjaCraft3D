interface STLClosedSourceBatch {start:number;end:number;sourceVolume:number;}
// Some STL writers concatenate closed oriented solids, including collapsed
// collinear facets that encode a boundary split. Detect complete directed-edge
// closure in the original order, without discarding faces shared by two parts.
// This is a conversion-path precondition, not STL object metadata. Interleaved
// or inconsistently wound batches stay on the existing contact classifier.
function stlClosedSourceBatches(source:Vec3[][],trace?:MeshImportDiagnostic):STLClosedSourceBatch[]|null {
  trace?.('source-batches-start',{triangles:source.length});
  const {indexOf}=stlSourceVertexIndex(),edges=new Map<string,number>(),batches:STLClosedSourceBatch[]=[];
  let start=0,volume=0,unfinishedEdges=0;
  for(let ti=0;ti<source.length;ti++){
    const triangle=source[ti];
    if(triangle.length!==3||triangle.some(p=>p.length!==3||p.some(value=>!Number.isFinite(value))))return null;
    const ids=triangle.map(indexOf);
    for(let j=0;j<3;j++){
      const a=ids[j],b=ids[(j+1)%3];if(a===b)continue;
      const key=a<b?`${a}|${b}`:`${b}|${a}`,direction=a<b?1:-1,previous=edges.get(key);
      if(previous===undefined){edges.set(key,direction);unfinishedEdges++;}
      else if(previous===0||previous===direction){trace?.('source-batches-unavailable',{reason:'Source batch edge is repeated or inconsistently oriented',start,triangleIndex:ti});return null;}
      else {edges.set(key,0);unfinishedEdges--;}

    }
    const origin=source[start][0];volume+=V.dot(V.sub(triangle[0],origin),V.cross(V.sub(triangle[1],origin),V.sub(triangle[2],origin)))/6;
    if(unfinishedEdges)continue;
    if(!edges.size||Math.abs(volume)<=TOL.minimumFaceArea){trace?.('source-batches-unavailable',{reason:'A source batch is not an oriented closed manifold with nonzero volume',start,end:ti+1});return null;}
    batches.push({start,end:ti+1,sourceVolume:Math.abs(volume)});start=ti+1;volume=0;edges.clear();
    // A zero-area opposite pair is not a source solid. Require every batch and
    // every source triangle to qualify before choosing this path.
    if(batches.length>STL_IMPORT_POLICY.maxShells){trace?.('budget-exceeded',{stage:'source-batches',batches:batches.length,limit:STL_IMPORT_POLICY.maxShells});throw Error(`STL source-part conversion exceeds the shell budget (maximum ${STL_IMPORT_POLICY.maxShells}).`);}
  }
  if(start!==source.length||batches.length<2){trace?.('source-batches-unavailable',{reason:start!==source.length?'Source does not close into complete ordered batches':'No multiple source batches',batches:batches.length,unfinishedEdges});return null;}
  trace?.('source-batches-proven',{batches:batches.length,triangles:source.length});return batches;
}
function stlConvertClosedSourceBatches(source:Vec3[][],batches:STLClosedSourceBatch[],format:'binary'|'ascii',repairOpenings:boolean,trace?:MeshImportDiagnostic):STLImportResult {
  const shells:STLImportShell[]=[],cleanup:STLImportCleanup={removedDegenerateTriangles:0,removedDuplicateTriangles:0,addedSeamTriangles:0,preservedSourceParts:batches.length};
  let weldedVertexCount=0,preparedTriangles=0;
  for(let index=0;index<batches.length;index++){
    const batch=batches[index];trace?.('source-batch-convert',{batchIndex:index,batches:batches.length,start:batch.start,end:batch.end,sourceVolume:batch.sourceVolume});
    // Classification already proved each complete closed input batch. Convert
    // it with the unchanged cleanup/reconstruction path, without recursive
    // partitioning or opening repair inventing a surface.
    const result=convertSTLTriangles(source.slice(batch.start,batch.end),format,false,false,trace?(event,data)=>trace(event,{...data,batchIndex:index}):undefined);
    let importedVolume=0;for(const shell of result.shells){importedVolume+=validateSolid(shell.solid).volume;preparedTriangles+=shell.triangleCount;}
    const tolerance=Math.max(STL_IMPORT_POLICY.contactVolumeAbsoluteTolerance,batch.sourceVolume*STL_IMPORT_POLICY.contactVolumeRelativeTolerance);
    trace?.('source-batch-volume',{batchIndex:index,sourceVolume:batch.sourceVolume,importedVolume,tolerance,shells:result.shells.length});
    if(Math.abs(importedVolume-batch.sourceVolume)>tolerance)throw Error(`STL source part ${index+1} did not preserve its material volume.`);
    if(shells.length+result.shells.length>STL_IMPORT_POLICY.maxShells)throw Error('The STL contains too many disconnected shells.');
    if(preparedTriangles>STL_IMPORT_POLICY.maxTriangles)throw Error('STL source-part conversion exceeds the triangle budget.');
    for(let partIndex=0;partIndex<result.shells.length;partIndex++)result.shells[partIndex].solid.id=`stl_shell_${shells.length+partIndex+1}`;
    shells.push(...result.shells);weldedVertexCount+=result.weldedVertexCount;
    for(const key of ['removedDegenerateTriangles','removedDuplicateTriangles','addedSeamTriangles'] as const)cleanup[key]+=result.cleanup?.[key]||0;
  }
  trace?.('source-batches-complete',{batches:batches.length,shells:shells.length,preparedTriangles,repairRequested:repairOpenings});
  return {format,triangleCount:source.length,weldedVertexCount,shells,cleanup};
}
