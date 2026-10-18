type EdgeFeatureWorkerRequest=
  | SplitSurfaceRequest
  | StlExportRequest
  | MeshImportRequest
  | ObjectSubtractRequest
  | GroupSubtractRequest
  | UnionManyRequest
  | {type:'thread';solid:Solid;halfEdgeId:HalfEdgeId;pitch:number;depth:number;length:number;profileAngleDeg:number;direction:ThreadDirection;operation:ThreadOperation}
  | {type:'rounded-chamfer';solid:Solid;halfEdgeId:HalfEdgeId;halfEdgeIds?:HalfEdgeId[];distance:number;angleDeg:number;segments:number;operation?:ChamferOperation}
  | {type:'carve-out';solid:Solid;faceId:FaceId;wallThickness:number;minimumInnerDetail:number}
  | {type:'surface-texture';solid:Solid;faceIds:FaceId[];parameters:SurfaceTextureParameters}
  | {type:'face-text';solid:Solid;faceId:FaceId;parameters:FaceTextParameters}
  | {type:'object-check';solid:Solid}
  | {type:'face-twist';solid:Solid;faceId:FaceId;distance:number;angleDeg:number}
  | {type:'ground-twist';solid:Solid;faceId:FaceId;distance:number;angleDeg:number}
  | {type:'face-taper';solid:Solid;faceId:FaceId;distance:number;angleDeg:number;twistAngleDeg?:number;taperMode?:TaperMode}
  | {type:'ground-taper';solid:Solid;faceId:FaceId;distance:number;angleDeg:number;twistAngleDeg?:number;taperMode?:TaperMode};
type EdgeFeatureWorkerResponse=
  | {type:'split-surface-result';result:SplitSurfaceResult}
  | {type:'stl-export-result';bytes:ArrayBuffer}
  | {type:'mesh-import-result';result:MeshImportResult}
  | {type:'object-subtract-result';result:BooleanSubtractResult}
  | {type:'object-union-result';result:BooleanUnionResult}
  | {type:'progress';update:ModelingProgressUpdate}
  | {type:'diagnostic';event:ModelingDiagnosticEvent}
  | {type:'result';solid:Solid}
  | {type:'object-check-result';report:ObjectCheckResult}
  | {type:'error';message:string};

const edgeFeatureWorkerScope=globalThis as unknown as {onmessage:((event:{data:EdgeFeatureWorkerRequest})=>void)|null;postMessage:(message:EdgeFeatureWorkerResponse,transfer?:Transferable[])=>void};
edgeFeatureWorkerScope.onmessage=(event)=>{
  const started=profilerClock();
  try{
    const request=event.data,report=(update:ModelingProgressUpdate)=>edgeFeatureWorkerScope.postMessage({type:'progress',update}),reportDiagnostic=(diagnostic:ModelingDiagnosticEvent)=>edgeFeatureWorkerScope.postMessage({type:'diagnostic',event:diagnostic});
    if(request.type==='split-surface'){edgeFeatureWorkerScope.postMessage({type:'split-surface-result',result:splitSolidBySurface(request,report)});return;}
    if(request.type==='stl-export'){const bytes=prepareBinarySTL(request.objects,report);edgeFeatureWorkerScope.postMessage({type:'stl-export-result',bytes},[bytes]);return;}
    if(request.type==='object-union'){edgeFeatureWorkerScope.postMessage({type:'object-union-result',result:unionManySolids(request,report)});return;}
    if(request.type==='group-subtract'){edgeFeatureWorkerScope.postMessage({type:'object-subtract-result',result:subtractGroupSolids(request,report)});return;}
    if(request.type==='object-subtract'){edgeFeatureWorkerScope.postMessage({type:'object-subtract-result',result:subtractSolids(request,report)});return;}
    if(request.type==='mesh-import'){edgeFeatureWorkerScope.postMessage({type:'mesh-import-result',result:prepareMeshImport(request,report,reportDiagnostic)});return;}
    if(request.type==='ground-twist'){edgeFeatureWorkerScope.postMessage({type:'result',solid:buildGroundTwist(request.solid,request.faceId,request.distance,request.angleDeg,report)});return;}
    if(request.type==='face-taper'||request.type==='ground-taper'){const solid=request.type==='face-taper'?taperFaceSweep(request.solid,request.faceId,request.distance,request.angleDeg,report,request.twistAngleDeg??0,request.taperMode??'edge-angle').solid:buildGroundTaper(request.solid,request.faceId,request.distance,request.angleDeg,report,request.twistAngleDeg??0,request.taperMode??'edge-angle');edgeFeatureWorkerScope.postMessage({type:'result',solid});return;}
    if(request.type==='face-text'){edgeFeatureWorkerScope.postMessage({type:'result',solid:applyFaceTextSolid(request.solid,request.faceId,request.parameters,report)});return;}
    if(request.type==='object-check'){
      edgeFeatureWorkerScope.postMessage({type:'object-check-result',report:checkObjectSolid(request.solid)});
      return;
    }
    reportDiagnostic({category:'worker',event:'request',elapsedMs:0,data:request.type==='surface-texture'?{type:request.type,faceIds:request.faceIds}:(request.type==='carve-out'||request.type==='face-twist')?{type:request.type,faceId:request.faceId}:{type:request.type,halfEdgeId:request.halfEdgeId}});
    const solid=request.type==='face-twist'?twistFaceSweep(request.solid,request.faceId,request.distance,request.angleDeg,report).solid:request.type==='thread'
      ?threadEdgeSolid(request.solid,request.halfEdgeId,request.pitch,request.depth,request.length,request.profileAngleDeg,request.direction,request.operation,report,reportDiagnostic)
      :request.type==='rounded-chamfer'
        ?roundedChamferEdgesSolid(request.solid,request.halfEdgeIds??chamferEdgeChainCandidate(request.solid,request.halfEdgeId,request.operation),request.distance,request.angleDeg,request.segments,report,reportDiagnostic,request.operation)
        :request.type==='surface-texture'
          ?applySurfaceTextureFacesSolid(request.solid,request.faceIds,request.parameters,report,reportDiagnostic).solid
          :carveOutSolid(request.solid,request.faceId,{wallThickness:request.wallThickness,minimumInnerDetail:request.minimumInnerDetail},report,reportDiagnostic).solid;
    reportDiagnostic({category:'worker',event:'result',elapsedMs:profilerClock()-started,data:{type:request.type,faces:solid.faces.size,halfEdges:solid.halfEdges.size}});
    edgeFeatureWorkerScope.postMessage({type:'result',solid});
  }catch(error){const message=errorMessage(error);edgeFeatureWorkerScope.postMessage({type:'diagnostic',event:{category:'worker',event:'error',elapsedMs:profilerClock()-started,data:{message,stack:error instanceof Error?error.stack||null:null}}});edgeFeatureWorkerScope.postMessage({type:'error',message});}
};
