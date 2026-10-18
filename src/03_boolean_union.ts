interface UnionManyRequest {type:'object-union';inputs:{solid:Solid;transform:Transform}[];id?:string;}
const UNION_MANY_POLICY=Object.freeze({maximumObjects:300,minimumVolumeNoise:TOL.minimumFaceArea,relativeVolumeNoise:1e-10});
// The union may be disconnected while accumulating inputs (a later input can
// bridge earlier pieces). Reconstruct and classify material only at the end.
function unionManySolids(request:UnionManyRequest,report?:(update:ModelingProgressUpdate)=>void):BooleanUnionResult {
  try{
    const inputs=request.inputs;
    if(inputs.length<2||inputs.length>UNION_MANY_POLICY.maximumObjects)return {ok:false,reason:'invalid',message:`Combine requires 2–${UNION_MANY_POLICY.maximumObjects} objects.`};
    let totalVolume=0,largestVolume=0;
    for(let i=0;i<inputs.length;i++){
      const input=inputs[i];
      if([input.transform.position,input.transform.rotation].some(values=>values.length!==3||values.some(value=>!Number.isFinite(value))))return {ok:false,reason:'invalid',message:'Combine requires finite object transforms.'};
      const check=checkObjectSolid(input.solid);
      if(check.status!=='passed'||check.volume===null)return {ok:false,reason:'invalid',message:`Object ${i+1} geometry check failed: `+(check.errors[0]||'No valid volume.')};
      totalVolume+=check.volume;largestVolume=Math.max(largestVolume,check.volume);
      report?.({progress:5+15*(i+1)/inputs.length,message:`Checking object ${i+1} of ${inputs.length}…`});
    }
    const primary=inputs[0];let polygons=solidToCsg(primary.solid);
    for(let i=1;i<inputs.length;i++){
      const input=inputs[i];polygons=csgUnionOwned(polygons,csgPolygonsInReference(input.solid,input.transform,primary.transform));
      report?.({progress:20+50*i/(inputs.length-1),message:`Combining object ${i+1} of ${inputs.length}…`});
    }
    if(!polygons.length)return {ok:false,reason:'empty',message:'The union produced no material.'};
    report?.({progress:75,message:'Rebuilding the union as editable geometry…'});
    const solid=csgToSolid(polygons,request.id||primary.solid.id,{kind:'boolean',label:'Union'}),check=checkObjectSolid(solid);
    if(check.status!=='passed'||check.volume===null)return {ok:false,reason:'invalid',message:check.errors[0]||'The union is invalid.'};
    const noise=Math.max(UNION_MANY_POLICY.minimumVolumeNoise,totalVolume*UNION_MANY_POLICY.relativeVolumeNoise);
    if(!Number.isFinite(totalVolume)||check.volume>totalVolume+noise||check.volume<largestVolume-noise)return {ok:false,reason:'invalid',message:'The union produced inconsistent material volume.'};
    if(splitConnectedSolidShells(solid).length!==1)return {ok:false,reason:'disconnected',message:'The selected objects do not form one connected material body.'};
    report?.({progress:90,message:'Checking closed export geometry…'});solidMeshExportLocal(solid);
    report?.({progress:100,message:'Combine complete.'});return {ok:true,solid};
  }catch(error){return {ok:false,reason:'invalid',message:errorMessage(error)};}
}
