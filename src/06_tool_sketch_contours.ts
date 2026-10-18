// Boundary-driven Arc and Contour sketch controllers.

const arcToolController:ToolController={
  name:'arc',sketchHover:true,parameters:TOOL_PARAMETERS.none,
  pointerDown({x,y,hit}){
    if(pointer?.type==='arc-face'){
      const p=pointer;
      if(p.points.length===1){
        // Primary workflow: edge -> edge -> control point. Endpoint picking is
        // deliberately topology-bound and screen-tolerant instead of relying on
        // the generic snap winner (which may be a guide/inference candidate).
        const endHit=faceBoundaryPointAt(x,y,p.object,p.face,SNAP_RADIUS_PX,p.startBoundaryLoop);
        if(endHit&&v2.dist(p.points[0],endHit.uv)>=TOL.minimumEdge){
          p.arcOrder='end-first';p.points.push(endHit.uv);p.endBoundaryLoop=endHit.loopIndex;p.previewArc=[...p.points];
          snapIndicator={point:[0,0],world:endHit.world,kind:'On edge',distance:endHit.distancePx};requestRender();return true;
        }
        const q=onFacePoint(x,y,p.object,p.face,true);if(!q)return true;
        if(v2.dist(p.points[0],q.uv)<TOL.minimumEdge){toast('Choose a different point.');return true;}
        // Alternate workflow remains supported: edge -> control point -> edge.
        p.arcOrder='mid-first';p.points.push(q.uv);p.previewArc=[...p.points];requestRender();return true;
      }
      if(p.arcOrder==='end-first'){
        const q=onFacePoint(x,y,p.object,p.face,true);if(!q)return true;
        if(v2.dist(p.points[0],q.uv)<TOL.minimumEdge||v2.dist(p.points[1],q.uv)<TOL.minimumEdge){toast('Choose a point that gives the arc curvature.');return true;}
        finishSurfaceArc(q.uv);return true;
      }
      // Alternate order ends only on the same topological boundary loop. Use
      // the same screen-tolerant boundary acquisition as the primary workflow.
      const endHit=faceBoundaryPointAt(x,y,p.object,p.face,SNAP_RADIUS_PX,p.startBoundaryLoop);
      if(!endHit){toast('Finish the arc on the same connected face boundary.');return true;}
      if(v2.dist(p.points[0],endHit.uv)<TOL.minimumEdge){toast('The end point must be different from the start point.');return true;}
      snapIndicator={point:[0,0],world:endHit.world,kind:'On edge',distance:endHit.distancePx};finishSurfaceArc(endHit.uv);return true;
    }
    if(!hit){toast('The arc must be drawn on an existing planar face.');return true;}
    const o=objects.find(o=>o.id===hit.id)!;
    const startBoundary=faceBoundaryPointAt(x,y,o,hit.face,SNAP_RADIUS_PX);
    if(!startBoundary){toast('Start the arc on an existing edge.');return true;}
    snapIndicator={point:[0,0],world:startBoundary.world,kind:'On edge',distance:startBoundary.distancePx};
    pointer={type:'arc-face',object:o,face:hit.face,basis:faceBasisLocal(o,hit.face),points:[startBoundary.uv],previewArc:[startBoundary.uv],previewClosure:null,previewRegion:null,startWorld:startBoundary.world,startSnapKind:'On edge',startBoundaryLoop:startBoundary.loopIndex,arcOrder:null};requestRender();return true;
  },
  pointerMove({x,y}){
    if(pointer?.type!=='arc-face')return false;
    const p=pointer;p.previewClosure=null;p.previewRegion=null;p.previewClipped=null;p.previewCanFinish=false;
    if(p.points.length===1){
      const edge=faceBoundaryPointAt(x,y,p.object,p.face,SNAP_RADIUS_PX,p.startBoundaryLoop),q=edge?{uv:edge.uv,world:edge.world}:onFacePoint(x,y,p.object,p.face,true);if(!q)return true;
      p.previewArc=[p.points[0],q.uv];if(edge)snapIndicator={point:[0,0],world:edge.world,kind:'On edge',distance:edge.distancePx};requestRender();return true;
    }
    if(p.arcOrder==='end-first'){
      const q=onFacePoint(x,y,p.object,p.face,true);if(!q)return true;
      try{p.previewArc=circularArcThrough3(p.points[0],q.uv,p.points[1],48);}catch{p.previewArc=[p.points[0],q.uv,p.points[1]];}
      try{const chain=p.previewArc.map((v:Vec2)=>fromPlane2(v,p.basis)),resolved=geometryApi.resolveOpenContour(p.object.solid,p.face,chain);p.previewClosure=resolved.boundaryPath.map(v=>toPlane2(v,p.basis));p.previewRegion=resolved.region.map(v=>toPlane2(v,p.basis));p.previewClipped=resolved.clippedRegions.map(loop=>({outer:loop.map(v=>toPlane2(v,p.basis)),holes:[]}));p.previewCanFinish=true;}catch{}
    }else{
      const edge=faceBoundaryPointAt(x,y,p.object,p.face,SNAP_RADIUS_PX,p.startBoundaryLoop),q=edge?{uv:edge.uv,world:edge.world}:onFacePoint(x,y,p.object,p.face,true);if(!q)return true;
      try{p.previewArc=circularArcThrough3(p.points[0],p.points[1],q.uv,48);}catch{p.previewArc=[...p.points,q.uv];}
      if(edge){snapIndicator={point:[0,0],world:edge.world,kind:'On edge',distance:edge.distancePx};try{const chain=p.previewArc.map((v:Vec2)=>fromPlane2(v,p.basis)),resolved=geometryApi.resolveOpenContour(p.object.solid,p.face,chain);p.previewClosure=resolved.boundaryPath.map(v=>toPlane2(v,p.basis));p.previewRegion=resolved.region.map(v=>toPlane2(v,p.basis));p.previewClipped=resolved.clippedRegions.map(loop=>({outer:loop.map(v=>toPlane2(v,p.basis)),holes:[]}));p.previewCanFinish=true;}catch{}}
    }
    requestRender();return true;
  },
  keyDown(event:any){if(event.key!=='Backspace'||pointer?.type!=='arc-face')return false;event.preventDefault();if(pointer.points.length>1){pointer.points.pop();pointer.arcOrder=null;pointer.endBoundaryLoop=undefined;pointer.previewArc=[...pointer.points];pointer.previewClosure=null;pointer.previewRegion=null;pointer.previewClipped=null;pointer.previewCanFinish=false;}else pointer=null;requestRender();return true;},
  cancel(){if(pointer?.type==='arc-face')pointer=null;}
};

const contourToolController:ToolController={
  name:'poly',sketchHover:true,parameters:TOOL_PARAMETERS.none,
  pointerDown({x,y,hit}){
    if(pointer?.type==='poly-face'){
      const q=onFacePoint(x,y,pointer.object,pointer.face,true);if(!q)return true;const closeTol=Math.max(TOL.snapGeometry*8,Number($('snapStep').value||1)*.35),start=pointer.points[0],startWorld=transformPoint(fromPlane2(start,pointer.basis),pointer.object.transform),startScreen=project(startWorld),nearStart=pointer.points.length>=3&&(v2.dist(q.uv,start)<closeTol||Math.hypot(x-startScreen[0],y-startScreen[1])<=SNAP_RADIUS_PX);if(nearStart){finishSurfacePolygon();return true;}const endBoundary=geometryApi.boundaryLocation(pointer.object.solid,pointer.face,q.local);if(pointer.startBoundaryLoop!==null&&pointer.startBoundaryLoop!==undefined&&endBoundary?.loopIndex===pointer.startBoundaryLoop&&v2.dist(q.uv,start)>=TOL.minimumEdge*2){finishSurfaceOpenContour(q.uv);return true;}if(v2.dist(q.uv,pointer.points[pointer.points.length-1])>=TOL.minimumEdge)pointer.points.push(q.uv);requestRender();return true;
    }
    if(pointer?.type==='poly-ground'){
      const p=snappedGroundPoint(x,y);if(!p)return true;const uv:[number,number]=[p[0],p[1]],closeTol=Math.max(TOL.snapGeometry*8,Number($('snapStep').value||1)*.35),start=pointer.points[0],startScreen=project([start[0],start[1],0]),nearStart=pointer.points.length>=3&&(v2.dist(uv,start)<closeTol||Math.hypot(x-startScreen[0],y-startScreen[1])<=SNAP_RADIUS_PX);if(nearStart){finishGroundPolygon();return true;}if(v2.dist(uv,pointer.points[pointer.points.length-1])>=TOL.minimumEdge)pointer.points.push(uv);requestRender();return true;
    }
    if(hit){const o=objects.find(o=>o.id===hit.id)!,q=onFacePoint(x,y,o,hit.face,true);if(q){const startSnap=snapIndicator,startBoundary=geometryApi.boundaryLocation(o.solid,hit.face,q.local);pointer={type:'poly-face',object:o,face:hit.face,basis:faceBasisLocal(o,hit.face),points:[q.uv],previewPoints:[q.uv],previewClosure:null,previewRegion:null,startWorld:q.world,startSnapKind:startSnap?.kind||null,startBoundaryLoop:startBoundary?.loopIndex??null};requestRender();}}
    else{const p=snappedGroundPoint(x,y);if(p){const startSnap=snapIndicator;pointer={type:'poly-ground',points:[[p[0],p[1]]],previewWorld:[p],startWorld:p,startSnapKind:startSnap?.kind||null};requestRender();}}
    return true;
  },
  pointerMove({x,y}){
    if(pointer?.type==='poly-face'){const q=onFacePoint(x,y,pointer.object,pointer.face,true);if(q){pointer.previewPoints=[...pointer.points,q.uv];pointer.previewClosure=null;pointer.previewRegion=null;pointer.previewClipped=null;pointer.previewCanFinish=false;const endBoundary=geometryApi.boundaryLocation(pointer.object.solid,pointer.face,q.local),start=pointer.points[0];if(pointer.startBoundaryLoop!==null&&pointer.startBoundaryLoop!==undefined&&endBoundary?.loopIndex===pointer.startBoundaryLoop&&v2.dist(q.uv,start)>=TOL.minimumEdge*2){try{const chain=pointer.previewPoints.map((p:Vec2)=>fromPlane2(p,pointer.basis)),resolved=geometryApi.resolveOpenContour(pointer.object.solid,pointer.face,chain);pointer.previewClosure=resolved.boundaryPath.map(p=>toPlane2(p,pointer.basis));pointer.previewRegion=resolved.region.map(p=>toPlane2(p,pointer.basis));pointer.previewClipped=resolved.clippedRegions.map(loop=>({outer:loop.map(p=>toPlane2(p,pointer.basis)),holes:[]}));pointer.previewCanFinish=true;}catch{}}requestRender();}return true;}
    if(pointer?.type==='poly-ground'){const p=snappedGroundPoint(x,y);if(p){pointer.previewWorld=[...pointer.points.map((v:Vec2)=>[v[0],v[1],0] as Vec3),p];requestRender();}return true;}
    return false;
  },
  keyDown(event:any){
    if(event.key==='Enter'){pointer?.type==='poly-face'?finishSurfacePolygon():finishGroundPolygon();return true;}
    if(event.key==='Backspace'&&(pointer?.type==='poly-face'||pointer?.type==='poly-ground')){event.preventDefault();if(pointer.points.length>1)pointer.points.pop();else pointer=null;requestRender();return true;}
    return false;
  },
  cancel(){if(pointer?.type==='poly-face'||pointer?.type==='poly-ground')pointer=null;}
};

