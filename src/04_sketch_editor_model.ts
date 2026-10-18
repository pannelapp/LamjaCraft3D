function insertEditorSketch(objectId:ObjectId,faceId:FaceId,contours:Vec3[][]):FaceId[] {
  const loops=contours.map(loop=>loop.map(point=>[...point] as Vec3));
  return executeDocumentCommand<FaceId[]>({type:'insert-editor-sketch',label:'Insert sketch',parameters:{objectId,faceId,contours:loops},execute(){
    const target=requireObject(objectId);
    if(target.kind==='surface'||groupForObjectId(objectId))throw Error('Choose an ungrouped closed solid for the sketch.');
    if(!geometryApi.hasFace(target.solid,faceId))throw Error('The sketch support face no longer exists.');
    if(loops.some(loop=>loop.length<3))throw Error('Each sketch contour needs at least three points.');
    const frame=geometryApi.faceBasis(target.solid,faceId),validation=geometryApi.validateSketchDraft(loops.map(points=>({kind:'line',points:[...points,points[0]].map(p=>toPlane2(p,frame))})));
    if(!validation.ok)throw Error(validation.message);
    if(loops.some(loop=>loop.some(p=>Math.abs(V.dot(frame.normal,V.sub(p,frame.origin)))>TOL.plane)))throw Error('The sketch must lie on its support plane.');
    let solid=target.solid;const created:FaceId[]=[];
    for(const loop of validation.loops){const result=geometryApi.splitFaceRegion(solid,faceId,loop.map(p=>fromPlane2(p,frame)),'Contour');solid=result.solid;created.push(result.regionFaceId);}
    // Subdivision can rebuild identities. Preserve dimensions at their actual
    // pre-edit locations instead of guessing a replacement vertex or edge.
    freezeDimensionAnchorsForObjects(new Set([objectId]));target.solid=solid;
    return {value:created,selection:{kind:'face',objectId,faceId:created[0]},objectSelection:[objectId],surfaceSketch:null};
  }});
}
