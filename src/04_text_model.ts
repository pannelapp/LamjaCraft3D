// Commit only a prepared, validated result for the exact source document.
function applyPreparedFaceText(objectId:ObjectId,source:Solid,revision:number,sourceTransform:ModelObject['transform'],result:GeometryDissolveResult,faceId:FaceId,parameters:FaceTextParameters):void {
  const o=requireObject(objectId);
  if(modelRevision!==revision||o.solid!==source||JSON.stringify(o.transform)!==JSON.stringify(sourceTransform)||!isObjectVisible(o)||groupForObjectId(o.id))throw Error('The object or project changed while text was generated. Place the text again.');
  executeDocumentCommand<void>({type:'face-text',label:parameters.operation==='add'?'Raised Text':'Engraved Text',parameters:{objectId,faceId,...structuredClone(parameters)},execute(){
    const target=requireObject(objectId);if(target.solid!==source)throw Error('The text source no longer exists.');
    target.solid=result.solid;
    return {selection:{kind:'object',objectId},objectSelection:[objectId],topology:{objectId,topology:result.topology},surfaceSketch:null};
  }});
}
