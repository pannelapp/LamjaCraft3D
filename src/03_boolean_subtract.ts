// Object difference is a conversion through the existing transient CSG kernel.
// Each separate material component retains its own closed cavity shells.
interface ObjectSubtractRequest {
  type:'object-subtract';target:Solid;cutter:Solid;targetTransform:Transform;cutterTransform:Transform;
}
interface SolidCutter {solid:Solid;transform:Transform;}
interface GroupSubtractRequest {
  type:'group-subtract';target:Solid;targetTransform:Transform;cutters:SolidCutter[];
}
type BooleanSubtractResult=
  | {status:'changed';solids:Solid[];removedVolume:number}
  | {status:'empty';removedVolume:number}
  | {status:'unchanged'}
  | {status:'invalid';message:string};
// Volume comparisons need a scale-aware noise budget after BSP arithmetic.
const OBJECT_SUBTRACT_POLICY=Object.freeze({minimumVolume:TOL.minimumFaceArea,relativeVolumeNoise:1e-10,maximumCutters:300});
function subtractSolids(request:ObjectSubtractRequest,report?:(update:ModelingProgressUpdate)=>void):BooleanSubtractResult {
  return subtractSolidCutters(request.target,request.targetTransform,[{solid:request.cutter,transform:request.cutterTransform}],report);
}
function subtractGroupSolids(request:GroupSubtractRequest,report?:(update:ModelingProgressUpdate)=>void):BooleanSubtractResult {
  return subtractSolidCutters(request.target,request.targetTransform,request.cutters,report);
}
// A minus the union of all cutters. Keep intermediate polygons transient and
// rebuild only once, so cutters need not form one connected manifold solid.
function subtractSolidCutters(target:Solid,targetTransform:Transform,cutters:SolidCutter[],report?:(update:ModelingProgressUpdate)=>void):BooleanSubtractResult {
  try{
    if(!cutters.length||cutters.length>OBJECT_SUBTRACT_POLICY.maximumCutters)return {status:'invalid',message:`Subtraction requires 1–${OBJECT_SUBTRACT_POLICY.maximumCutters} cutters.`};
    for(const transform of [targetTransform,...cutters.map(cutter=>cutter.transform)])if([transform.position,transform.rotation].some(values=>values.length!==3||values.some(value=>!Number.isFinite(value))))return {status:'invalid',message:'Object subtraction requires finite object transforms.'};
    report?.({progress:5,message:'Checking subtraction objects…'});
    const targetCheck=checkObjectSolid(target);
    if(targetCheck.status!=='passed')return {status:'invalid',message:'Target geometry check failed: '+(targetCheck.errors[0]||'incomplete geometry check')};
    // Check every member before cutting, including non-overlapping members and
    // members after a cutter that removes the whole target.
    for(let index=0;index<cutters.length;index++){
      const check=checkObjectSolid(cutters[index].solid);
      if(check.status!=='passed')return {status:'invalid',message:`Cutter ${index+1} geometry check failed: `+(check.errors[0]||'incomplete geometry check')};
    }
    const originalVolume=targetCheck.volume;
    if(originalVolume===null||!Number.isFinite(originalVolume))return {status:'invalid',message:'Target geometry has no finite volume.'};
    report?.({progress:20,message:'Subtracting overlapping volume…'});
    const volumeNoise=Math.max(OBJECT_SUBTRACT_POLICY.minimumVolume,originalVolume*OBJECT_SUBTRACT_POLICY.relativeVolumeNoise);
    const convex=convexSubtractSeparated(target,targetTransform,cutters,originalVolume,volumeNoise,report);
    if(convex.status==='unchanged'||convex.status==='empty'){report?.({progress:100,message:convex.status==='empty'?'The cutter removes the entire target.':'No overlapping volume to subtract.'});return convex;}
    let polygons=convex.status==='polygons'?convex.polygons:solidToCsg(target);
    for(let index=0;convex.status!=='polygons'&&index<cutters.length&&polygons.length;index++){
      const cutter=cutters[index];
      report?.({progress:20+50*index/cutters.length,message:`Subtracting cutter ${index+1} of ${cutters.length}…`});
      polygons=profiler.measure('geometry','Object subtraction',()=>csgSubtractOwned(polygons,csgPolygonsInReference(cutter.solid,cutter.transform,targetTransform)),{targetFaces:target.faces.size,cutterFaces:cutter.solid.faces.size,cutterIndex:index});
    }
    if(!polygons.length){report?.({progress:100,message:'The cutter removes the entire target.'});return {status:'empty',removedVolume:originalVolume};}
    report?.({progress:70,message:'Rebuilding the subtraction as editable geometry…'});
    const solid=csgToSolid(polygons,target.id,{kind:'boolean',label:'Subtract'},convex.status==='polygons'),validation=validateSolid(solid,false);
    if(!validation.ok||!Number.isFinite(validation.volume))return {status:'invalid',message:validation.errors[0]||'Object subtraction produced invalid volume.'};
    const removedVolume=originalVolume-validation.volume;
    if(convex.status==='polygons'&&Math.abs(removedVolume-convex.intersectionVolume)>volumeNoise)return {status:'invalid',message:'The rebuilt subtraction does not preserve the clipped material volume.'};
    if(removedVolume < -volumeNoise)return {status:'invalid',message:'Object subtraction unexpectedly increased the target volume.'};
    if(removedVolume<=volumeNoise){report?.({progress:100,message:'No overlapping volume to subtract.'});return {status:'unchanged'};}
    report?.({progress:90,message:'Separating remaining pieces and checking export meshes…'});
    const solids=splitConnectedSolidShells(solid);for(const part of solids)solidMeshExportLocal(part);
    report?.({progress:100,message:'Object subtraction complete.'});return {status:'changed',solids,removedVolume};
  }catch(error){return {status:'invalid',message:errorMessage(error)};}
}
