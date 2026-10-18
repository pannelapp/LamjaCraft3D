const scene:any=$('scene'),overlay:any=$('overlay'),ctx:any=overlay?.getContext('2d');
const gl:any=scene?.getContext('webgl',{antialias:true,alpha:false,preserveDrawingBuffer:true});
if(!gl)throw Error('WebGL unavailable');
function compileShader(type:number,source:string){const s=gl.createShader(type);gl.shaderSource(s,source);gl.compileShader(s);if(!gl.getShaderParameter(s,gl.COMPILE_STATUS))throw Error(gl.getShaderInfoLog(s));return s;}
// Default clip distances are in millimetres. Larger views expand the depth
// range according to the current camera and visible model, not a fixed 10 m cap.
const CAMERA_PROJECTION_POLICY=Object.freeze({nearPlane:.1,farPlane:10000,adaptiveNearStart:1000,nearDistanceRatio:.005,nearBoundsFraction:.25,farDistanceFactor:3,farBoundsFactor:1.2,farPadding:100});
interface CameraClipRange {nearPlane:number;farPlane:number;}
const program=gl.createProgram();gl.attachShader(program,compileShader(gl.VERTEX_SHADER,modelVertexShaderSource()));gl.attachShader(program,compileShader(gl.FRAGMENT_SHADER,modelFragmentShaderSource()));gl.linkProgram(program);if(!gl.getProgramParameter(program,gl.LINK_STATUS))throw Error(gl.getProgramInfoLog(program));gl.useProgram(program);
const attrib={position:gl.getAttribLocation(program,'position'),color:gl.getAttribLocation(program,'color'),material:gl.getAttribLocation(program,'material'),faceKey:gl.getAttribLocation(program,'faceKey')};const uniform:any={};for(const k of ['eye','right','up','forward','aspect','focal','ortho','span','nearPlane','farPlane','materialEye','materialForward','materialOrtho','opacity','faceHighlightKey','faceHighlightEnabled','faceHighlightStyle','faceHighlightAmbient',...MODEL_SHADOW_UNIFORMS])uniform[k]=gl.getUniformLocation(program,k);gl.enableVertexAttribArray(attrib.position);gl.enableVertexAttribArray(attrib.color);
const camera:CameraState={target:[0,0,10],distance:155,yaw:-Math.PI/3,pitch:Math.PI/5,orthographic:false};let basis:any={},cameraClip:CameraClipRange={nearPlane:CAMERA_PROJECTION_POLICY.nearPlane,farPlane:CAMERA_PROJECTION_POLICY.farPlane},W=1,H=1,dpr=1,framePending=false;let pointer:any=null,snapIndicator:SnapResult|null=null,hoverGround:Vec3|null=null;let sketchGround:Vec3[]=[];let measure:Vec3[]=[];let measureAnchors:GeometryAnchor[]=[];let measurePreview:Vec3|null=null;let debugPickHit:HitResult|null=null,debugPointerXY:[number,number]|null=null,debugSnapCandidates:any[]=[];let debugPreviewSolid:Solid|null=null;
let deleteFeatureHover:{objectId:string;candidate:GeometryDeleteFeatureCandidate}|null=null;
let deleteObjectHoverId:ObjectId|null=null;
let chamferHover:{objectId:string;halfEdgeId:HalfEdgeId;halfEdgeIds:HalfEdgeId[];sourceSolid:Solid;previewResult:GeometryDissolveResult|null;previewSolid:Solid|null;previewKey:string;error:string|null}|null=null;
let roundedChamferHover:{objectId:string;halfEdgeId:HalfEdgeId;halfEdgeIds:HalfEdgeId[];previewSolid:Solid|null;previewKey:string;error:string|null}|null=null;
let threadHover:{objectId:string;halfEdgeId:HalfEdgeId;halfEdgeIds:HalfEdgeId[];kind:'internal'|'external';radius:number;maxLength:number}|null=null;
function cameraBasis(){basis=sceneCameraFrame(camera);cameraClip=sceneCameraClipRange(camera,basis,sceneBounds(visibleObjects()));}
function project(p:Vec3):[number,number,number]{const d=V.sub(p,basis.eye),z=V.dot(d,basis.forward),scale=camera.orthographic?H/(2*basis.span):H*basis.focal/(2*z);return [W/2+V.dot(d,basis.right)*scale,H/2-V.dot(d,basis.up)*scale,z];}
function ray(x:number,y:number):Ray3{const nx=(2*x/W-1)*W/H,ny=1-2*y/H;if(camera.orthographic){const origin=V.add(basis.eye,V.add(V.mul(basis.right,nx*basis.span),V.mul(basis.up,ny*basis.span)));return {origin,dir:basis.forward};}return {origin:basis.eye,dir:V.unit(V.add(basis.forward,V.add(V.mul(basis.right,nx/basis.focal),V.mul(basis.up,ny/basis.focal))))};}
function intersectPlaneWorld(x:number,y:number,point:Vec3,normal:Vec3):Vec3|null{const r=ray(x,y),den=V.dot(r.dir,normal);if(Math.abs(den)<1e-9)return null;const t=V.dot(V.sub(point,r.origin),normal)/den;if(t<0)return null;return V.add(r.origin,V.mul(r.dir,t));}
const CAMERA_NAVIGATION_POLICY={wheelZoomExponent:.001,cursorZoomPull:1.4,minimumDistance:CAMERA_PROJECTION_POLICY.nearPlane*2,maximumDistance:100000} as const;
function zoomCameraTowardCursor(x:number,y:number,deltaY:number){
  cameraBasis();
  const previousDistance=camera.distance,nextDistance=clamp(previousDistance*Math.exp(deltaY*CAMERA_NAVIGATION_POLICY.wheelZoomExponent),CAMERA_NAVIGATION_POLICY.minimumDistance,CAMERA_NAVIGATION_POLICY.maximumDistance);
  if(Math.abs(nextDistance-previousDistance)<1e-12)return;
  const anchor=intersectPlaneWorld(x,y,camera.target,basis.forward);
  if(anchor){
    // A pull of 1 keeps the anchor approximately under the cursor. A slightly
    // stronger pull makes zoom-in drift toward screen center and zoom-out drift
    // away from it, while keeping the motion gradual instead of snapping.
    const pull=(1-nextDistance/previousDistance)*CAMERA_NAVIGATION_POLICY.cursorZoomPull;
    camera.target=V.add(camera.target,V.mul(V.sub(anchor,camera.target),pull));
  }
  camera.distance=nextDistance;
}
function snapValue(n:number){return gridSnapValue(n,!!$('snap')?.checked,Number($('snapStep').value||1));}
function ground(x:number,y:number,snap=true):Vec3|null{const p=intersectPlaneWorld(x,y,[0,0,0],[0,0,1]);if(!p)return null;return snap?[snapValue(p[0]),snapValue(p[1]),0]:p;}
function hitTest(x:number,y:number):HitResult|null{cameraBasis();return sceneGeometry.pick(objects,ray(x,y));}
function geometrySnapEnabled(){return !!$('geomSnap')?.checked;}
function guideSnapEnabled(){return !!$('guideSnap')?.checked;}
function guideLinesThroughSolids(){return !!$('guideThroughSolids')?.checked;}
function inferenceSnapEnabled(){return !!$('inferenceSnap')?.checked;}
function livePushPreviewEnabled(){return !!$('livePushPreview')?.checked;}
function livePushPreviewSolidFor(o:ModelObject):Solid|null{if(!livePushPreviewEnabled()||pointer?.type!=='push'||pointer.object?.id!==o.id)return null;return pointer.previewResult?.solid||null;}
function livePushPreviewKey(){if(!livePushPreviewEnabled()||pointer?.type!=='push'||!pointer.previewResult?.solid)return '';const s=pointer.previewResult.solid as Solid;return [pointer.object?.id,pointer.face,pointer.distance??0,s.vertices.size,s.faces.size,s.halfEdges.size].join(':');}
function inferenceToolEligible():boolean{return tool==='rect'||tool==='arc'||tool==='poly'||tool==='guide';}
function activeInferenceEnabled():boolean{return inferenceSnapEnabled()&&inferenceToolEligible()&&!!pointer;}
const SNAP_RADIUS_PX=16;
function screenPointSegmentDistance(x:number,y:number,a:[number,number,number],b:[number,number,number]):number{const dx=b[0]-a[0],dy=b[1]-a[1],l2=dx*dx+dy*dy;if(l2<1e-9)return Math.hypot(x-a[0],y-a[1]);const t=clamp(((x-a[0])*dx+(y-a[1])*dy)/l2,0,1);return Math.hypot(x-(a[0]+dx*t),y-(a[1]+dy*t));}
interface FaceBoundaryScreenHit{local:Vec3;uv:Vec2;world:Vec3;loopIndex:number;kind:'outer'|'hole';edgeIndex:number;t:number;distancePx:number;}
function faceBoundaryPointAt(x:number,y:number,o:ModelObject,faceId:FaceId,maxDistancePx=SNAP_RADIUS_PX,requiredLoopIndex?:number):FaceBoundaryScreenHit|null{
  const rawWorld=faceRawWorldPoint(x,y,o,faceId);if(!rawWorld)return null;const rawLocal=inverseTransformPoint(rawWorld,o.transform),basis2=faceBasisLocal(o,faceId),loops=geometryApi.faceLoops(o.solid,faceId),all=[loops.outer,...loops.holes];let best:FaceBoundaryScreenHit|null=null,bestD=maxDistancePx;
  for(let li=0;li<all.length;li++){if(requiredLoopIndex!==undefined&&li!==requiredLoopIndex)continue;const loop=all[li];for(let ei=0;ei<loop.length;ei++){const a=loop[ei],b=loop[(ei+1)%loop.length],aw=transformPoint(a,o.transform),bw=transformPoint(b,o.transform),as=project(aw),bs=project(bw);if(as[2]<=0&&bs[2]<=0)continue;const d=screenPointSegmentDistance(x,y,as,bs);if(d>bestD)continue;const ab=V.sub(b,a),l2=V.dot(ab,ab);if(l2<TOL.minimumEdge*TOL.minimumEdge)continue;const t=clamp(V.dot(V.sub(rawLocal,a),ab)/l2,0,1),local=V.lerp(a,b,t),world=transformPoint(local,o.transform),uv=toPlane2(local,basis2);bestD=d;best={local,uv,world,loopIndex:li,kind:li===0?'outer':'hole',edgeIndex:ei,t,distancePx:d};}}
  return best;
}
function topologyEdgeAt(x:number,y:number,hit:HitResult|null,maxDistance=9):EntityRef|null{if(!hit)return null;const o=objects.find(v=>v.id===hit.id);if(!o)return null;let best:EntityRef|null=null,bestD=maxDistance;for(const e of geometryApi.faceTopologyEdges(o.solid,hit.face)){const a=project(transformPoint(e.a,o.transform)),b=project(transformPoint(e.b,o.transform));if(a[2]<=0||b[2]<=0)continue;const d=screenPointSegmentDistance(x,y,a,b);if(d<bestD){bestD=d;best={kind:'edge',objectId:o.id,halfEdgeId:e.id};}}return best;}
const TOPOLOGY_POINT_PICK_POLICY=Object.freeze({radiusPx:11});
function topologyVertexAt(x:number,y:number,hit:HitResult|null):Extract<EntityRef,{kind:'vertex'}>|null{if(!hit)return null;const o=objects.find(o=>o.id===hit.id);if(!o||!isObjectVisible(o))return null;let best:Extract<EntityRef,{kind:'vertex'}>|null=null,bestD:number=TOPOLOGY_POINT_PICK_POLICY.radiusPx;for(const id of geometryApi.faceVertexIds(o.solid,hit.face)){const q=project(transformPoint(geometryApi.vertex(o.solid,id),o.transform));if(q[2]<=0)continue;const d=Math.hypot(x-q[0],y-q[1]);if(d<bestD){bestD=d;best={kind:'vertex',objectId:o.id,vertexId:id};}}return best;}
function activeInferenceOriginWorld():Vec3|null{if(!pointer)return null;if(pointer.type==='poly-face'&&pointer.points?.length){const p=pointer.points[pointer.points.length-1] as Vec2;return transformPoint(fromPlane2(p,pointer.basis),pointer.object.transform);}if(pointer.type==='poly-ground'&&pointer.points?.length){const p=pointer.points[pointer.points.length-1] as Vec2;return [p[0],p[1],0];}if(pointer.type==='arc-face'&&pointer.points?.length){const p=pointer.points[pointer.points.length-1] as Vec2;return transformPoint(fromPlane2(p,pointer.basis),pointer.object.transform);}if(pointer.startWorld)return [...pointer.startWorld] as Vec3;return null;}
function snapInference(edges:SnapEdge[],plane:SnapPlane|undefined,axes:Vec3[]):SnapInference|undefined{if(!activeInferenceEnabled()||!plane)return undefined;const origin=activeInferenceOriginWorld();if(!origin)return undefined;const referenceDirections:Vec3[]=[],alignmentPoints:Vec3[]=[];for(const e of edges){referenceDirections.push(V.sub(e.b,e.a));alignmentPoints.push(e.a,e.b);}for(const g of guides)if(g.kind==='line'&&guideLineInPlane(g,plane))referenceDirections.push(g.direction);return {origin,referenceDirections,alignmentPoints,axes:[...axes,...referenceDirections]};}
function snapSourceUsesGuideDisplay(source?:SnapSource):boolean{return !!source&&(source.kind==='guide'||source.kind==='guide-intersection'||source.kind==='guide-edge-intersection'||source.kind==='guide-segment');}
function snapCandidateVisible(world:Vec3,_kind:SnapKind,source?:SnapSource):boolean{
  const screen=project(world);if(!screen.every(Number.isFinite)||screen[2]<cameraClip.nearPlane||screen[2]>cameraClip.farPlane||screen[0]<0||screen[0]>W||screen[1]<0||screen[1]>H)return false;
  const guide=snapSourceUsesGuideDisplay(source);
  if(guide&&!$('showGuides')?.checked)return false;
  if(guide&&guideLinesThroughSolids())return true;
  const r=ray(screen[0],screen[1]),nearT=cameraClip.nearPlane/V.dot(r.dir,basis.forward);
  // Start at the rendered near plane so clipped foreground geometry cannot hide a target.
  return sceneGeometry.pointVisible(objects,{origin:V.add(r.origin,V.mul(r.dir,nearT)),dir:r.dir},world,livePushPreviewSolidFor);
}
function createSnapVisibilityCheck():typeof snapCandidateVisible {
  // Visibility depends on the exact world point and guide-display policy,
  // not endpoint kind or owning object. Lifetime is one synchronous query.
  // Do not use this cache for source-specific tool acceptance predicates.
  const modelPoints=new Map<string,boolean>(),guidePoints=new Map<string,boolean>(),check=snapCandidateVisible;
  return (world,kind,source)=>{
    const cache=snapSourceUsesGuideDisplay(source)?guidePoints:modelPoints,key=`${world[0]}|${world[1]}|${world[2]}`,cached=cache.get(key);
    if(cached!==undefined)return cached;
    const visible=check(world,kind,source);cache.set(key,visible);return visible;
  };
}
function snapSpatialQuery(edges:SnapEdge[],points:SnapPointCandidate[]=[]):SnapSpatialQuery {
  return {projection:camera.orthographic?'affine':'perspective',edges:reusableSnapEdgeArrays.has(edges),points:reusableSnapPointArrays.has(points)};
}
function bestWorldEdgeSnap(x:number,y:number,rawWorld:Vec3,edges:SnapEdge[],plane?:SnapPlane,axes:Vec3[]=[],allowInference=true,points:SnapPointCandidate[]=[]):SnapResult|null{const inference=allowInference?snapInference(edges,plane,axes):undefined;const result=bestSnapCandidate({x,y,rawWorld,edges,points,guides,plane,project,spatial:snapSpatialQuery(edges,points),radiusPx:SNAP_RADIUS_PX,geometryEnabled:geometrySnapEnabled(),guideEnabled:guideSnapEnabled(),inferenceEnabled:!!inference,inference,acceptCandidate:createSnapVisibilityCheck()});debugSnapCandidates=result.candidates;return result.best;}
function faceWorldPlane(o:ModelObject,faceId:FaceId):SnapPlane|null{const f=o.solid.faces.get(faceId);if(!f)return null;return {point:transformPoint(geometryApi.faceCentroid(o.solid,faceId),o.transform),normal:transformDir(f.plane.normal,o.transform)};}
function faceRawWorldPoint(x:number,y:number,o:ModelObject,faceId:FaceId):Vec3|null{const f=o.solid.faces.get(faceId);if(!f)return null;const localOrigin=geometryApi.faceCentroid(o.solid,faceId),worldOrigin=transformPoint(localOrigin,o.transform),worldNormal=transformDir(f.plane.normal,o.transform);return intersectPlaneWorld(x,y,worldOrigin,worldNormal);}
function faceSnapCandidate(x:number,y:number,o:ModelObject,faceId:FaceId):SnapResult|null{const raw=faceRawWorldPoint(x,y,o,faceId);if(!raw)return null;const b=faceBasisLocal(o,faceId);/* Hover-face retention may use direct geometry/guide snap, never inferred hints. */return bestWorldEdgeSnap(x,y,raw,faceSnapEdges(o,faceId),faceWorldPlane(o,faceId)||undefined,[transformDir(b.u,o.transform),transformDir(b.v,o.transform)],false);}
function sketchHoverHit(x:number,y:number,rawHit:HitResult|null):HitResult|null{const prev=hoverHit;if(!prev)return rawHit;if(rawHit?.id===prev.id&&rawHit.face===prev.face)return rawHit;const o=objects.find(o=>o.id===prev.id);if(!o||!isObjectVisible(o)||!geometryApi.hasFace(o.solid,prev.face))return rawHit;const snap=faceSnapCandidate(x,y,o,prev.face);if(!snap)return rawHit;return {id:o.id,face:prev.face,point:snap.world,localPoint:inverseTransformPoint(snap.world,o.transform),t:rawHit?.t??prev.t};}
function onFacePoint(x:number,y:number,o:ModelObject,faceId:FaceId,snap=true):{local:Vec3;uv:Vec2;world:Vec3}|null{let world=faceRawWorldPoint(x,y,o,faceId);if(!world)return null;const rawWorld=world,b=faceBasisLocal(o,faceId),edges=faceSnapEdges(o,faceId),plane=faceWorldPlane(o,faceId)||undefined;const snapped=bestWorldEdgeSnap(x,y,rawWorld,edges,plane,[transformDir(b.u,o.transform),transformDir(b.v,o.transform)],true,faceSnapCenters(o,faceId));if(snapped){world=snapped.world;snapIndicator=snapped;}else snapIndicator=null;const local=inverseTransformPoint(world,o.transform);let uv=toPlane2(local,b);if(!snapped&&snap){uv=[snapValue(uv[0]),snapValue(uv[1])];const lp=fromPlane2(uv,b);world=transformPoint(lp,o.transform);return {local:lp,uv,world};}return {local,uv,world};}
function snappedGroundPoint(x:number,y:number):Vec3|null{const raw=ground(x,y,false);if(!raw)return null;const {edges,centers}=groundSnapGeometry(),plane={point:[0,0,0] as Vec3,normal:[0,0,1] as Vec3};const snap=bestWorldEdgeSnap(x,y,raw,edges,plane,[[1,0,0],[0,1,0]],true,centers);if(snap){snapIndicator=snap;return [snap.world[0],snap.world[1],0];}snapIndicator=null;return ground(x,y,true);}
const gridBuffer=gl.createBuffer(),axesBuffer=gl.createBuffer(),triangleBuffer=gl.createBuffer(),lineBuffer=gl.createBuffer(),guideDepthBuffer=gl.createBuffer(),materialBuffer=gl.createBuffer(),faceKeyBuffer=gl.createBuffer();let gridKey='',gridCount=0,axesCount=0,triCount=0,lineCount=0,sceneKey='';
function rgb(hex:string){return [1,3,5].map(i=>parseInt(hex.slice(i,i+2),16)/255);}
const SELECTION_VISUAL_POLICY={
  objectLighten:0.34,coolTint:0.08,tint:[0.55,0.78,1],
  selectedAmbient:0.82,ordinaryAmbient:0.70,selectedEdge:[0.10,0.38,0.82],
} as const;
const GUIDE_VISUAL_POLICY={normalWidthPx:1.5,activeWidthPx:2.5,dashPx:5,gapPx:4,maxDashSegments:600,minHalfWidthPx:.5,polygonOffsetFactor:-1,polygonOffsetUnits:-1} as const;
function selectionDisplayColor(base:number[],selected:boolean):number[]{if(!selected)return [...base];const amount=SELECTION_VISUAL_POLICY.objectLighten;return base.map((v,i)=>(v+(1-v)*amount)*(1-SELECTION_VISUAL_POLICY.coolTint)+SELECTION_VISUAL_POLICY.tint[i]*SELECTION_VISUAL_POLICY.coolTint);}
function addVertex(data:number[],p:Vec3,c:number[]){data.push(...p,...c);}
function bindBuffer(buf:any){gl.disableVertexAttribArray(attrib.faceKey);gl.vertexAttrib4f(attrib.faceKey,0,0,0,1);gl.disableVertexAttribArray(attrib.material);gl.vertexAttrib4f(attrib.material,0,0,1,0);gl.bindBuffer(gl.ARRAY_BUFFER,buf);gl.vertexAttribPointer(attrib.position,3,gl.FLOAT,false,24,0);gl.vertexAttribPointer(attrib.color,3,gl.FLOAT,false,24,12);}
function upload(buf:any,data:number[]){bindBuffer(buf);gl.bufferData(gl.ARRAY_BUFFER,new Float32Array(data),gl.DYNAMIC_DRAW);return data.length/6;}
function sceneGridVertices(spacing:number,extent:number,ox:number,oy:number):{grid:number[];axes:number[]}{const g:number[]=[],a:number[]=[];for(let i=-35;i<=35;i++){const x=ox+i*spacing,y=oy+i*spacing,c=i%5===0?[.80,.84,.85]:[.87,.90,.91];addVertex(g,[x,oy-extent,-.03],c);addVertex(g,[x,oy+extent,-.03],c);addVertex(g,[ox-extent,y,-.03],c);addVertex(g,[ox+extent,y,-.03],c);}for(const [p,q,c] of [[[-extent+ox,0,0],[extent+ox,0,0],[.71,.39,.41]],[[0,-extent+oy,0],[0,extent+oy,0],[.36,.61,.44]],[[0,0,0],[0,0,spacing*8],[.38,.57,.76]]] as any[]) {addVertex(a,p,c);addVertex(a,q,c);}return {grid:g,axes:a};}
function ensureGrid(spacing:number,extent:number,ox:number,oy:number){const k=[spacing,extent,ox,oy].join('|');if(k===gridKey)return;const data=sceneGridVertices(spacing,extent,ox,oy);gridCount=upload(gridBuffer,data.grid);axesCount=upload(axesBuffer,data.axes);gridKey=k;}
function toolHighlightsFace(toolName:ToolName):boolean{if(toolName==='delete')return modelDocument.hover?.kind==='face';return ['push','rect','circle','arc','poly','guide','select'].includes(toolName);}
// Both key components stay small/exact in vertex highp, including scenes with
// more than 65,536 faces. Zero is reserved for non-face/preview-color vertices.
const SCENE_PREPARATION_POLICY=Object.freeze({trianglesPerChunk:1024,edgesPerChunk:2048,faceKeyRadix:4096});
// These tools differ only in uniform-driven face feedback or 2D overlays.
// Live Push/Pull geometry is independently represented by livePushPreviewKey.
const SHARED_FACE_BUFFER_TOOLS=new Set<ToolName>(['push','rect','circle','arc','poly','guide','select']);
let sceneFaceKeys=new Map<ObjectId,Map<FaceId,number>>();
function applySceneFaceHighlight():void{
  const focus=tool==='delete'?hoverFaceRef():hoverFaceRef()||selectedFaceRef(),key=focus&&toolHighlightsFace(tool)?sceneFaceKeys.get(focus.objectId)?.get(focus.faceId)||0:0,style=activeModelViewStyle();
  const deleteGroup=tool==='delete'&&deleteObjectHoverId?groupForObjectId(deleteObjectHoverId):null,deleteActive=focus&&(deleteObjectHoverId===focus.objectId||deleteGroup?.objectIds.includes(focus.objectId)),selected=!!focus&&selectedObjectIds().includes(focus.objectId);
  gl.uniform2f(uniform.faceHighlightKey,key%SCENE_PREPARATION_POLICY.faceKeyRadix,Math.floor(key/SCENE_PREPARATION_POLICY.faceKeyRadix));
  gl.uniform1f(uniform.faceHighlightEnabled,key?1:0);gl.uniform1f(uniform.faceHighlightStyle,style==='modeling'?0:style==='illustration'?1:2);
  gl.uniform1f(uniform.faceHighlightAmbient,selected&&!deleteActive?SELECTION_VISUAL_POLICY.selectedAmbient:SELECTION_VISUAL_POLICY.ordinaryAmbient);
}
let nativeOpenRenderSuspended=false;
function* sceneBufferChunks():Generator<void>{
  const style=activeModelViewStyle(),selectedIds=selectedObjectIds(),selectedSet=new Set(selectedIds),liveKey=livePushPreviewKey(),mergeKey=tool==='mergefaces'?mergeFacesViewRevision:'',deleteHover=tool==='delete'?deleteObjectHoverId:null,deleteHoverGroup=deleteHover?groupForObjectId(deleteHover):null,k=[modelRevision,selectedIds.join(','),SHARED_FACE_BUFFER_TOOLS.has(tool)?'face':tool,deleteHoverGroup?.id||deleteHover||'',livePushPreviewEnabled()?1:0,liveKey,mergeKey,tool==='delete'?deleteEdgeViewRevision:'',tool==='delete'?deletePointViewRevision:'',tool==='move'?movePointViewRevision:'',style,pastePreviewRevision,style==='illustration'?JSON.stringify(camera):''].join('|');if(k===sceneKey)return;
  {
    const tris:number[]=[],lines:number[]=[],materials:number[]=[],faceKeys:number[]=[],nextFaceKeys=new Map<ObjectId,Map<FaceId,number>>();let nextFaceKey=1;
    for(const o of [...visibleObjects(),...pastePreviewObjects()]){
      const previewSolid=movePointPreviewSolidFor(o)||deletePointPreviewSolidFor(o)||deleteEdgePreviewSolidFor(o)||mergeFacesPreviewSolidFor(o)||livePushPreviewSolidFor(o),m=previewSolid?sceneGeometry.previewMesh(o,previewSolid):sceneGeometry.mesh(o),appearance=style==='modeling'?null:sceneGeometry.appearance(m),selected=pastePlacement?pastePlacement.objects.some(object=>object.id===o.id):selectedSet.has(o.id),deleteActive=deleteHover===o.id||!!deleteHoverGroup?.objectIds.includes(o.id),col=deleteActive?[.96,.70,.32]:selectionDisplayColor(rgb(o.color),selected);
      const objectFaceKeys=new Map<FaceId,number>();nextFaceKeys.set(o.id,objectFaceKeys);
      for(let ti=0;ti<m.triangles.length;ti++){
        const ids=m.triangles[ti],ps=ids.map(i=>m.vertices[i]) as Vec3[],normal=V.unit(V.cross(V.sub(ps[1],ps[0]),V.sub(ps[2],ps[0]))),ambient=selected&&!deleteActive?SELECTION_VISUAL_POLICY.selectedAmbient:SELECTION_VISUAL_POLICY.ordinaryAmbient,override=movePointDisplayColor(o.id,m.face[ti])||deletePointDisplayColor(o.id,m.face[ti])||deleteEdgeDisplayColor(o.id,m.face[ti])||mergeFacesDisplayColor(o.id,m.face[ti]),base=override||col;
        let faceKey=objectFaceKeys.get(m.face[ti]);if(faceKey===undefined){faceKey=nextFaceKey++;objectFaceKeys.set(m.face[ti],faceKey);}
        const encoded=override?0:faceKey;for(let j=0;j<3;j++)faceKeys.push(encoded%SCENE_PREPARATION_POLICY.faceKeyRadix,Math.floor(encoded/SCENE_PREPARATION_POLICY.faceKeyRadix));
        if(!appearance){const color=sceneLitColor(base,normal,style,ambient);for(const p of ps)addVertex(tris,p,color);}else for(let j=0;j<3;j++)addVertex(tris,ps[j],sceneLitColor(base,appearance.cornerNormals[ti][j],style,ambient,camera.orthographic?V.mul(basis.forward,-1):V.unit(V.sub(basis.eye,ps[j]))));
        for(let j=0;j<3;j++)materials.push(...(appearance?.cornerNormals[ti][j]||normal),style==='presentation'?objectShininess(o)/100:0);
        if((ti+1)%SCENE_PREPARATION_POLICY.trianglesPerChunk===0)yield;
      }
      const lc=deleteActive?[.78,.42,.10]:selected?[...SELECTION_VISUAL_POLICY.selectedEdge]:[.32,.42,.43],edges=appearance?sceneStyleEdges(m,appearance,style,camera,basis):m.edges;
      for(let ei=0;ei<edges.length;ei++){const [a,b]=edges[ei];addVertex(lines,m.vertices[a],lc);addVertex(lines,m.vertices[b],lc);if((ei+1)%SCENE_PREPARATION_POLICY.edgesPerChunk===0)yield;}
      yield;
    }
    triCount=upload(triangleBuffer,tris);gl.bindBuffer(gl.ARRAY_BUFFER,materialBuffer);gl.bufferData(gl.ARRAY_BUFFER,new Float32Array(materials),gl.DYNAMIC_DRAW);lineCount=upload(lineBuffer,lines);gl.bindBuffer(gl.ARRAY_BUFFER,faceKeyBuffer);gl.bufferData(gl.ARRAY_BUFFER,new Float32Array(faceKeys),gl.STATIC_DRAW);sceneFaceKeys=nextFaceKeys;sceneKey=k;
  }
}
function ensureScene(){profiler.measure('scene','Render buffer rebuild',()=>{for(const _ of sceneBufferChunks()){void _;}},{objects:objects.length,style:activeModelViewStyle()});}
async function prepareNativeOpenScene():Promise<void>{
  const chunks=sceneBufferChunks();let started=performance.now();
  for(;;){const next=chunks.next();if(next.done)return;if(performance.now()-started>=NATIVE_OPEN_POLICY.yieldBudgetMs){await yieldNativeOpen();started=performance.now();}}
}
function drawStored(buf:any,mode:number,count:number){if(!count)return;bindBuffer(buf);if(buf===triangleBuffer){gl.bindBuffer(gl.ARRAY_BUFFER,materialBuffer);gl.enableVertexAttribArray(attrib.material);gl.vertexAttribPointer(attrib.material,4,gl.FLOAT,false,16,0);gl.bindBuffer(gl.ARRAY_BUFFER,faceKeyBuffer);gl.enableVertexAttribArray(attrib.faceKey);gl.vertexAttribPointer(attrib.faceKey,2,gl.FLOAT,false,8,0);gl.bindBuffer(gl.ARRAY_BUFFER,buf);}gl.drawArrays(mode,0,count);}
function requestRender(){if(nativeOpenRenderSuspended||framePending)return;framePending=true;requestAnimationFrame(()=>{framePending=false;render();});}
const viewportShadows=new ModelShadowRenderer(gl),shadowGroundBuffer=gl.createBuffer();
function render(){
  if(nativeOpenRenderSuspended)return;
  cameraBasis();let shadows=false;
  if($('viewShadows')?.checked){
    try{shadows=viewportShadows.prepare([...visibleObjects(),...pastePreviewObjects()].map(o=>{
      const preview=movePointPreviewSolidFor(o)||deletePointPreviewSolidFor(o)||deleteEdgePreviewSolidFor(o)||mergeFacesPreviewSolidFor(o)||livePushPreviewSolidFor(o);
      return preview?sceneGeometry.previewMesh(o,preview):sceneGeometry.mesh(o);
    }));}catch(error){$('viewShadows').checked=false;$('viewShadows').title=errorMessage(error);toast(errorMessage(error));}
  }
  gl.useProgram(program);gl.enableVertexAttribArray(attrib.position);gl.enableVertexAttribArray(attrib.color);viewportShadows.apply(name=>uniform[name],false);
  gl.viewport(0,0,scene.width,scene.height);gl.clearColor(.943,.96,.966,1);gl.clear(gl.COLOR_BUFFER_BIT|gl.DEPTH_BUFFER_BIT);gl.enable(gl.DEPTH_TEST);gl.depthFunc(gl.LEQUAL);
  for(const k of ['eye','right','up','forward'])gl.uniform3fv(uniform[k],basis[k]);
  gl.uniform3fv(uniform.materialEye,basis.eye);gl.uniform3fv(uniform.materialForward,basis.forward);gl.uniform1f(uniform.materialOrtho,camera.orthographic?1:0);
  gl.uniform1f(uniform.aspect,W/H);gl.uniform1f(uniform.focal,basis.focal);gl.uniform1f(uniform.ortho,camera.orthographic?1:0);gl.uniform1f(uniform.span,basis.span);gl.uniform1f(uniform.nearPlane,cameraClip.nearPlane);gl.uniform1f(uniform.farPlane,cameraClip.farPlane);
  const spacing=Math.pow(10,Math.floor(Math.log10(camera.distance/12))),extent=spacing*35,ox=Math.round(camera.target[0]/spacing)*spacing,oy=Math.round(camera.target[1]/spacing)*spacing;
  ensureGrid(spacing,extent,ox,oy);ensureScene();gl.uniform1f(uniform.opacity,1);drawBuildPlates();
  if(shadows){
    viewportShadows.apply(name=>uniform[name],true,true);gl.enable(gl.BLEND);gl.blendFuncSeparate(gl.SRC_ALPHA,gl.ONE_MINUS_SRC_ALPHA,gl.ONE,gl.ONE_MINUS_SRC_ALPHA);gl.depthMask(false);gl.uniform1f(uniform.opacity,MODEL_SHADOW_POLICY.groundOpacity);
    const count=upload(shadowGroundBuffer,viewportShadows.groundVertices());drawStored(shadowGroundBuffer,gl.TRIANGLES,count);
    gl.depthMask(true);gl.disable(gl.BLEND);gl.uniform1f(uniform.opacity,1);viewportShadows.apply(name=>uniform[name],false);
  }
  if(!$('showGroundPlane')||$('showGroundPlane').checked){drawStored(gridBuffer,gl.LINES,gridCount);drawStored(axesBuffer,gl.LINES,axesCount);}
  gl.enable(gl.POLYGON_OFFSET_FILL);gl.polygonOffset(1,1);viewportShadows.apply(name=>uniform[name],shadows);applySceneFaceHighlight();drawStored(triangleBuffer,gl.TRIANGLES,triCount);
  gl.disable(gl.POLYGON_OFFSET_FILL);viewportShadows.apply(name=>uniform[name],false);drawStored(lineBuffer,gl.LINES,lineCount);drawDepthTestedGuideLines();drawOverlay();
}
function topologyPointCount(){let n=0;for(const o of visibleObjects())n+=o.solid.vertices.size;return n;}
function debugChecked(id:string){return !!$(id)?.checked;}
function topologyStats():SceneTopologyStats{return sceneGeometry.topologyStats(visibleObjects(),debugChecked('debugBVH'));}
function updateDebugStats(){const s=topologyStats(),pointCounter=$('topologyPointCount'),full=$('debugStats');if(pointCounter)pointCounter.textContent=String(s.vertices);if(full)full.textContent=`V ${s.vertices} · E ${s.edges} · HE ${s.halfEdges} · L ${s.loops} · F ${s.faces} · holes ${s.holes} · tri ${s.triangles} · BVH ${s.bvhNodes}${s.openEdges?` · open ${s.openEdges}`:''}`;return s;}
function path3(points:Vec3[],color:string,dashed=false,width=1.6){if(!ctx||points.length<2)return;ctx.beginPath();points.forEach((p,i)=>{const q=project(p);i?ctx.lineTo(q[0],q[1]):ctx.moveTo(q[0],q[1]);});ctx.strokeStyle=color;ctx.lineWidth=width;ctx.setLineDash(dashed?[5,4]:[]);ctx.stroke();ctx.setLineDash([]);}
function fillPath3(points:Vec3[],color:string){if(!ctx||points.length<3)return;ctx.beginPath();points.forEach((p,i)=>{const q=project(p);i?ctx.lineTo(q[0],q[1]):ctx.moveTo(q[0],q[1]);});ctx.closePath();ctx.fillStyle=color;ctx.fill();}
function label(text:string,p:[number,number],color='#276a61',small=false){if(!ctx)return;ctx.font=`500 ${small?10:11}px system-ui`;const width=ctx.measureText(text).width+(small?12:18),height=small?19:24;ctx.fillStyle='#ffffffee';ctx.strokeStyle='#d6e2df';ctx.lineWidth=1;ctx.beginPath();ctx.roundRect(p[0]-width/2,p[1]-height/2,width,height,5);ctx.fill();ctx.stroke();ctx.fillStyle=color;ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillText(text,p[0],p[1]);}
function drawScreenArrow(a:Vec3,b:Vec3,color:string,offset=0,width=1.5){if(!ctx)return;const pa=project(a),pb=project(b);if(pa[2]<=0&&pb[2]<=0)return;const dx=pb[0]-pa[0],dy=pb[1]-pa[1],len=Math.hypot(dx,dy);if(len<5)return;const nx=-dy/len,ny=dx/len,ax=pa[0]+dx*.28+nx*offset,ay=pa[1]+dy*.28+ny*offset,bx=pa[0]+dx*.72+nx*offset,by=pa[1]+dy*.72+ny*offset,ux=(bx-ax)/Math.hypot(bx-ax,by-ay),uy=(by-ay)/Math.hypot(bx-ax,by-ay),hs=5;ctx.strokeStyle=color;ctx.fillStyle=color;ctx.lineWidth=width;ctx.beginPath();ctx.moveTo(ax,ay);ctx.lineTo(bx,by);ctx.stroke();ctx.beginPath();ctx.moveTo(bx,by);ctx.lineTo(bx-ux*hs-uy*hs*.65,by-uy*hs+ux*hs*.65);ctx.lineTo(bx-ux*hs+uy*hs*.65,by-uy*hs-ux*hs*.65);ctx.closePath();ctx.fill();}
function drawArrow3(a:Vec3,b:Vec3,color:string,width=1.6){path3([a,b],color,false,width);drawScreenArrow(a,b,color,0,width);}
function drawSnapMarker(world:Vec3,kind:SnapResult['kind']|null,labelText:string){if(!ctx)return;const q=project(world);ctx.strokeStyle='#177568';ctx.fillStyle='#fff';ctx.lineWidth=2;ctx.beginPath();if(kind==='Corner')ctx.rect(q[0]-5,q[1]-5,10,10);else if(kind==='Midpoint'){ctx.moveTo(q[0],q[1]-6);ctx.lineTo(q[0]+6,q[1]+5);ctx.lineTo(q[0]-6,q[1]+5);ctx.closePath();}else if(kind==='On edge')ctx.arc(q[0],q[1],5,0,Math.PI*2);else if(kind==='Intersection'){ctx.moveTo(q[0]-5,q[1]-5);ctx.lineTo(q[0]+5,q[1]+5);ctx.moveTo(q[0]+5,q[1]-5);ctx.lineTo(q[0]-5,q[1]+5);}else if(kind==='On guide line'){ctx.moveTo(q[0]-6,q[1]);ctx.lineTo(q[0]+6,q[1]);ctx.moveTo(q[0],q[1]-3);ctx.lineTo(q[0],q[1]+3);}else if(kind==='Parallel'){ctx.moveTo(q[0]-6,q[1]-2);ctx.lineTo(q[0]+6,q[1]-2);ctx.moveTo(q[0]-6,q[1]+2);ctx.lineTo(q[0]+6,q[1]+2);}else if(kind==='Perpendicular'){ctx.moveTo(q[0]-5,q[1]+5);ctx.lineTo(q[0]-5,q[1]-5);ctx.lineTo(q[0]+5,q[1]-5);}else if(kind==='On line'){ctx.moveTo(q[0]-6,q[1]);ctx.lineTo(q[0]+6,q[1]);ctx.arc(q[0],q[1],2.5,0,Math.PI*2);}else{ctx.moveTo(q[0]-5,q[1]);ctx.lineTo(q[0]+5,q[1]);ctx.moveTo(q[0],q[1]-5);ctx.lineTo(q[0],q[1]+5);}if(kind){ctx.fill();}ctx.stroke();if(labelText)label(labelText,[q[0],q[1]-19]);}
function drawSnap(){if(!snapIndicator)return;drawSnapMarker(snapIndicator.world,snapIndicator.kind,snapIndicator.kind);}
function drawTopologyPoints(){if(!ctx||!debugChecked('topologyPoints'))return;const selectedSet=new Set(selectedObjectIds());for(const o of visibleObjects()){const selectedObject=selectedSet.has(o.id);for(const v of o.solid.vertices.values()){const world=transformPoint(v.position,o.transform),q=project(world);if(q[2]<=0||q[0]<-10||q[0]>W+10||q[1]<-10||q[1]>H+10)continue;ctx.beginPath();ctx.arc(q[0],q[1],selectedObject?4.2:3.5,0,Math.PI*2);ctx.fillStyle=selectedObject?'#b33a62':'#68498a';ctx.fill();ctx.strokeStyle='#fff';ctx.lineWidth=1.4;ctx.stroke();}}}
function drawTopologyEdges(){if(!ctx||!debugChecked('debugEdges'))return;for(const o of visibleObjects()){for(const he of o.solid.halfEdges.values()){if(he.twin&&he.id>he.twin)continue;const next=o.solid.halfEdges.get(he.next);if(!next)continue;const a=transformPoint(o.solid.vertices.get(he.origin)!.position,o.transform),b=transformPoint(o.solid.vertices.get(next.origin)!.position,o.transform);path3([a,b],isObjectSelected(o.id)?'rgba(25,94,145,.88)':'rgba(51,89,112,.58)',false,isObjectSelected(o.id)?2:1.2);}}}
function drawHalfEdges(){if(!ctx||!debugChecked('debugHalfEdges'))return;for(const o of visibleObjects())for(const he of o.solid.halfEdges.values()){const next=o.solid.halfEdges.get(he.next);if(!next)continue;const a=transformPoint(o.solid.vertices.get(he.origin)!.position,o.transform),b=transformPoint(o.solid.vertices.get(next.origin)!.position,o.transform);const sign=he.twin&&he.id>he.twin?-1:1;const sf=selectedFaceRef();drawScreenArrow(a,b,he.face===sf?.faceId&&o.id===sf?.objectId?'#a44b72':'rgba(188,104,42,.86)',sign*2.4,1.25);}}
function loopWorldPoints(o:ModelObject,lid:LoopId){return loopPoints(o.solid,lid).map(p=>transformPoint(p,o.transform));}
function drawLoops(){if(!ctx||!debugChecked('debugLoops'))return;let labels=0;for(const o of visibleObjects())for(const l of o.solid.loops.values()){const pts=loopWorldPoints(o,l.id);if(pts.length<2)continue;path3([...pts,pts[0]],l.kind==='hole'?'rgba(181,72,75,.92)':'rgba(43,121,118,.9)',l.kind==='hole',2);if(labels++<160){const c=pts.reduce((s,p)=>V.add(s,p),[0,0,0] as Vec3).map(v=>v/pts.length) as Vec3,q=project(c);label(`${l.id} · ${l.kind==='hole'?'hole':'outer'}`,[q[0],q[1]],l.kind==='hole'?'#a3474d':'#276a61',true);}}}
function debugNormalScale(o:ModelObject){return clamp(V.len(objectDimensions(o))*.12,3,18);}
function provenanceColor(kind:string|undefined){return kind==='primitive'?'#526f91':kind==='split'?'#8d5d9e':kind==='pushpull'?'#b26d31':kind==='boolean'?'#735f8f':kind==='import'?'#6e7a82':'#6e7a82';}
function drawFacesDebug(){const ids=debugChecked('debugFaceIds'),normals=debugChecked('debugFaceNormals'),prov=debugChecked('debugProvenance');if(!ctx||(!ids&&!normals&&!prov))return;let labels=0;for(const o of visibleObjects())for(const f of o.solid.faces.values()){const local=faceCentroid(o.solid,f.id),c=transformPoint(local,o.transform),q=project(c);if(prov){const col=provenanceColor(f.provenance?.kind);for(const lp of faceWorldLoops(o,f.id))path3([...lp,lp[0]],col,false,2.15);}if(normals){const n=transformDir(f.plane.normal,o.transform),end=V.add(c,V.mul(n,debugNormalScale(o)));drawArrow3(c,end,'rgba(181,111,40,.92)',1.5);}if((ids||prov)&&labels++<220){const p=f.provenance,group=f.boundaryGroup?` · ${f.boundaryGroup}`:'',txt=ids&&prov?`${f.id} · ${p?.kind||'unknown'}${p?.label?':'+p.label:''}${group}`:ids?f.id:`${p?.kind||'unknown'}${p?.label?' · '+p.label:''}${group}`;label(txt,[q[0],q[1]],provenanceColor(p?.kind),true);}}}
function drawFacePlaneDebug(){if(!ctx||!debugChecked('debugFacePlane'))return;const hit=hoverFaceRef()||selectedFaceRef();if(!hit)return;const o=objects.find(x=>x.id===hit.objectId),f=o?.solid.faces.get(hit.faceId);if(!o||!f)return;const c=transformPoint(faceCentroid(o.solid,f.id),o.transform),q=project(c),n=f.plane.normal;label(`${f.id} · n [${fmt(n[0])}, ${fmt(n[1])}, ${fmt(n[2])}] · d ${fmt(f.plane.offset)}`,[q[0],q[1]+24],'#536b78',true);}
function drawTriangulation(){if(!ctx||!debugChecked('debugTriangulation'))return;for(const o of visibleObjects()){const m=sceneGeometry.mesh(o);for(const t of m.triangles){const a=m.vertices[t[0]],b=m.vertices[t[1]],c=m.vertices[t[2]];path3([a,b,c,a],'rgba(109,84,151,.38)',true,.85);}}}
function boundsCorners(b:Bounds3):Vec3[]{const [x0,y0,z0]=b.min,[x1,y1,z1]=b.max;return [[x0,y0,z0],[x1,y0,z0],[x1,y1,z0],[x0,y1,z0],[x0,y0,z1],[x1,y0,z1],[x1,y1,z1],[x0,y1,z1]] as Vec3[];}
const boundsEdgeIndices=[[0,1],[1,2],[2,3],[3,0],[4,5],[5,6],[6,7],[7,4],[0,4],[1,5],[2,6],[3,7]];
function drawBounds3(b:Bounds3,color:string){const c=boundsCorners(b);for(const [a,z] of boundsEdgeIndices)path3([c[a],c[z]],color,true,1);}
function drawBVH(){if(!ctx||!debugChecked('debugBVH'))return;const depthValue=String($('debugBvhDepth')?.value||'2'),want=depthValue==='all'?-1:Number(depthValue);let drawn=0;for(const o of visibleObjects()){const root=sceneGeometry.bvh(o);if(!root)continue;const stack:[BVHNode,number][]=[[root,0]];while(stack.length&&drawn<500){const [node,depth]=stack.pop()!;if(want<0||depth===want){drawBounds3(node,`rgba(46,113,133,${want<0?Math.max(.16,.55-depth*.07):.55})`);drawn++;}if((want<0||depth<want)&&node.left)stack.push([node.left,depth+1]);if((want<0||depth<want)&&node.right)stack.push([node.right,depth+1]);}}}
function drawPickingDebug(){if(!ctx||!debugChecked('debugPicking')||!debugPointerXY)return;const r=ray(debugPointerXY[0],debugPointerXY[1]);const dist=debugPickHit?.t||camera.distance*1.3,start=V.add(r.origin,V.mul(r.dir,Math.max(.2,dist*.025))),end=debugPickHit?.point||V.add(r.origin,V.mul(r.dir,dist));path3([start,end],'rgba(194,75,79,.78)',true,1.3);if(debugPickHit){const q=project(debugPickHit.point);ctx.beginPath();ctx.arc(q[0],q[1],5,0,Math.PI*2);ctx.fillStyle='#c24b4f';ctx.fill();ctx.strokeStyle='#fff';ctx.lineWidth=1.5;ctx.stroke();label(`${debugPickHit.id} · ${debugPickHit.face} · t ${fmt(debugPickHit.t)}`,[q[0],q[1]-20],'#a43d42',true);}}
function drawSnapCandidatesDebug(){if(!ctx||!debugChecked('debugSnapCandidates'))return;for(let i=0;i<Math.min(debugSnapCandidates.length,120);i++){const c=debugSnapCandidates[i],q=project(c.world),active=c.distance<=SNAP_RADIUS_PX;ctx.beginPath();if(c.kind==='Corner')ctx.rect(q[0]-3,q[1]-3,6,6);else if(c.kind==='Midpoint'){ctx.moveTo(q[0],q[1]-4);ctx.lineTo(q[0]+4,q[1]+3);ctx.lineTo(q[0]-4,q[1]+3);ctx.closePath();}else ctx.arc(q[0],q[1],3,0,Math.PI*2);ctx.strokeStyle=active?'rgba(23,117,104,.9)':'rgba(23,117,104,.38)';ctx.lineWidth=active?1.8:1;ctx.stroke();}}
function drawBasisGizmo(origin:Vec3,u:Vec3,v:Vec3,n:Vec3,scale:number){drawArrow3(origin,V.add(origin,V.mul(u,scale)),'#ba6467',1.7);drawArrow3(origin,V.add(origin,V.mul(v,scale)),'#589870',1.7);drawArrow3(origin,V.add(origin,V.mul(n,scale)),'#588cbd',1.7);const ou=project(V.add(origin,V.mul(u,scale))),ov=project(V.add(origin,V.mul(v,scale))),on=project(V.add(origin,V.mul(n,scale)));label('U',[ou[0],ou[1]],'#9c5154',true);label('V',[ov[0],ov[1]],'#427e59',true);label('N',[on[0],on[1]],'#46749e',true);}
function drawSketchPlaneDebug(){if(!ctx||!debugChecked('debugSketchPlane'))return;let o:ModelObject|null=null,fid:FaceId|null=null,b:PlaneBasis|null=null;if(pointer?.type==='draw-face'||pointer?.type==='circle-face'||pointer?.type==='arc-face'||pointer?.type==='poly-face'){o=pointer.object;fid=pointer.face;b=pointer.basis||faceBasisLocal(o!,fid!);}else if(hoverFaceRef()&&(tool==='rect'||tool==='circle'||tool==='arc'||tool==='poly')){const hf=hoverFaceRef()!;o=objects.find(x=>x.id===hf.objectId)||null;fid=hf.faceId;if(o)b=faceBasisLocal(o,fid);}if(o&&fid&&b){const origin=transformPoint(faceCentroid(o.solid,fid),o.transform),u=transformDir(b.u,o.transform),v=transformDir(b.v,o.transform),n=transformDir(b.normal,o.transform);drawBasisGizmo(origin,u,v,n,debugNormalScale(o));return;}if(debugPointerXY){const p=ground(debugPointerXY[0],debugPointerXY[1],false);if(p)drawBasisGizmo(p,[1,0,0],[0,1,0],[0,0,1],clamp(camera.distance*.07,4,18));}}
function drawPreviewSolidDebug(){if(!ctx||!debugChecked('debugPreviewSolid')||!debugPreviewSolid||!pointer?.object)return;const m=solidMeshLocal(debugPreviewSolid),t=pointer.object.transform;for(const [a,b] of m.edges)path3([transformPoint(m.vertices[a],t),transformPoint(m.vertices[b],t)],'rgba(24,137,146,.82)',true,1.4);}
function drawSketchStartSnap(){if(!pointer||!['draw-face','draw-ground','circle-face','circle-ground','arc-face','poly-face','poly-ground'].includes(pointer.type)||!pointer.startWorld)return;const current=snapIndicator?.world;if(current&&V.len(V.sub(current,pointer.startWorld))<TOL.snapGeometry)return;const kind:SnapResult['kind']|null=pointer.startSnapKind||null;drawSnapMarker(pointer.startWorld,kind,kind?'Start · '+kind:'Start');}
function drawMoveAnchor(){if(!pointer||pointer.type!=='move-object'||!pointer.sourceAnchorWorld||!pointer.sourceAnchorKind)return;const world=transformPoint(inverseTransformPoint(pointer.sourceAnchorWorld,{position:pointer.position,rotation:pointer.rotation}),pointer.object.transform);const current=snapIndicator?.world;if(current&&V.len(V.sub(current,world))<TOL.snapGeometry)return;drawSnapMarker(world,pointer.sourceAnchorKind,'Move anchor · '+pointer.sourceAnchorKind);}
function pushPreviewEdgeKey(a:Vec3,b:Vec3):string{const q=(p:Vec3)=>p.map(v=>Math.round(v*1e5)).join(','),ka=q(a),kb=q(b);return ka<kb?ka+'|'+kb:kb+'|'+ka;}
function drawPushPreview(){if(!ctx||!pointer||pointer.type!=='push'||!pointer.object||!pointer.face)return;const o=pointer.object as ModelObject,f=o.solid.faces.get(pointer.face);if(!f)return;const d=pointer.distance||0,preview=pointer.previewResult?.solid as Solid|undefined;
  if(pointer.valid===false&&pointer.previewError){const q=project(transformPoint(geometryApi.faceCentroid(o.solid,pointer.face),o.transform));label(pointer.previewError,[q[0],q[1]-18],'#a33');return;}
  if(pointer.taperAngleDeg){
    const sweep=pointer.taperPreview as TaperSweepPreview|null;
    if(sweep){for(const path of sweep.paths)path3(path.map(p=>transformPoint(p,o.transform)),'#b97723',true,1.4);const q=project(transformPoint(sweep.center,o.transform));label(`Taper sweep · ${fmt(d)} mm · ${fmt(pointer.taperAngleDeg)}°${pointer.twistAngleDeg?` · twist ${fmt(pointer.twistAngleDeg)}°`:""}`,[q[0],q[1]-18],'#926131');}return;
  }
  if(pointer.twistAngleDeg){
    const sweep=pointer.twistPreview as TwistSweepPreview|null;
    if(sweep){for(const path of sweep.paths)path3(path.map(p=>transformPoint(p,o.transform)),'#b97723',true,1.4);const q=project(transformPoint(sweep.center,o.transform));label(`Twist sweep · ${fmt(d)} mm · ${fmt(pointer.twistAngleDeg)}°`,[q[0],q[1]-18],'#926131');}
    else if(pointer.previewError){const q=project(transformPoint(geometryApi.faceCentroid(o.solid,pointer.face),o.transform));label(pointer.previewError,[q[0],q[1]-18],'#a33');}
    return;
  }
  if(preview){
    // Draw geometry from the actual validated preview B-rep, not a synthetic
    // translated-face sketch. Only edges that differ from the current solid are
    // highlighted, so what the user sees is the geometry that commit will keep.
    if(!livePushPreviewEnabled()){const existing=new Set(geometryApi.edges(o.solid).map(e=>pushPreviewEdgeKey(e.a,e.b))),col=pointer.valid===false?'#b84d4d':'#b97723';for(const e of geometryApi.edges(preview))if(!existing.has(pushPreviewEdgeKey(e.a,e.b)))path3([transformPoint(e.a,o.transform),transformPoint(e.b,o.transform)],col,true,1.8);}
    let local:Vec3;try{local=geometryApi.hasFace(preview,pointer.face)?geometryApi.faceCentroid(preview,pointer.face):V.add(geometryApi.faceCentroid(o.solid,pointer.face),V.mul(f.plane.normal,d));}catch{local=V.add(geometryApi.faceCentroid(o.solid,pointer.face),V.mul(f.plane.normal,d));}
    const q=project(transformPoint(local,o.transform));label((livePushPreviewEnabled()?'Live Preview':'Preview')+' · '+(d>=0?'+':'')+fmt(d)+' mm',[q[0],q[1]-18],pointer.valid===false?'#a33':'#926131');return;
  }
  const loops=faceWorldLoops(o,pointer.face),n=transformDir(f.plane.normal,o.transform);for(const loop of loops){const moved=loop.map(p=>V.add(p,V.mul(n,d)));path3([...moved,moved[0]],pointer.valid===false?'#b84d4d':'#b97723',true);for(let i=0;i<loop.length;i++)path3([loop[i],moved[i]],'#c6975a',true);}const c=loops[0].reduce((s,p)=>V.add(s,p),[0,0,0] as Vec3).map(v=>v/loops[0].length) as Vec3,q=project(V.add(c,V.mul(n,d)));label('Preview · '+(d>=0?'+':'')+fmt(d)+' mm',[q[0],q[1]-18],pointer.valid===false?'#a33':'#926131');}
function drawClippedSketchPreview(o:ModelObject,b:PlaneBasis,components:any[]){if(!ctx||!components?.length)return;for(const c of components){const outer=(c.outer||[] as Vec2[]).map((p:Vec2)=>transformPoint(fromPlane2(p,b),o.transform));if(outer.length>=3){fillPath3(outer,'rgba(23,117,104,.12)');path3([...outer,outer[0]],'#177568',false,2.4);}for(const hole2 of (c.holes||[])){const hole=(hole2 as Vec2[]).map(p=>transformPoint(fromPlane2(p,b),o.transform));if(hole.length>=3)path3([...hole,hole[0]],'#177568',true,1.8);}}}
function drawGroundSweepPreview():boolean {
  if(!ctx||!isGroundExtrusionPointer(pointer)||(!pointer.twistAngleDeg&&!pointer.taperAngleDeg))return false;
  const p=pointer,loops=p.type==='ground-extrude'?[p.profile,...p.holes]:p.profiles;
  for(const loop of loops){const base=loop.map(v=>[v[0],v[1],0] as Vec3);if(base.length)path3([...base,base[0]],'#177568',true,1.5);}
  for(const preview of p.taperAngleDeg?p.taperPreviews||[]:p.twistPreviews||[]){for(const path of preview.paths)path3(path,'#b97723',true,1.4);const q=project(preview.center);label(`Height ${fmt(p.height)} mm · ${p.taperAngleDeg?`taper ${fmt(p.taperAngleDeg)}°`:''}${p.taperAngleDeg&&p.twistAngleDeg?' · ':''}${p.twistAngleDeg?`twist ${fmt(p.twistAngleDeg)}°`:''}`,[q[0],q[1]-20],'#926131');}
  if(p.previewError&&loops[0]?.length){const q=project([loops[0][0][0],loops[0][0][1],p.height]);label(p.previewError,[q[0],q[1]-20],'#a33');}return true;
}
function drawGroundExtrudePreview(){if(!ctx||pointer?.type!=='ground-extrude')return;if(drawGroundSweepPreview())return;const h=pointer.height||0,loops:[Vec2[],string][]=[[pointer.profile,'#177568'],...(pointer.holes||[]).map((loop:Vec2[])=>[loop,'#177568'] as [Vec2[],string])];for(const [loop,color] of loops){if(loop.length<3)continue;const base=loop.map(p=>[p[0],p[1],0] as Vec3),top=loop.map(p=>[p[0],p[1],h] as Vec3);path3([...base,base[0]],color,true,1.5);path3([...top,top[0]],pointer.valid===false?'#b84d4d':'#b97723',true,2);const step=Math.max(1,Math.floor(loop.length/24));for(let i=0;i<loop.length;i+=step)path3([base[i],top[i]],'rgba(185,119,35,.52)',true,1);}
  const c=(pointer.profile as Vec2[]).reduce((sum,p)=>[sum[0]+p[0],sum[1]+p[1]] as Vec2,[0,0] as Vec2).map(v=>v/pointer.profile.length) as Vec2,q=project([c[0],c[1],h]);label(h>0?`Height ${fmt(h)} mm · click to create`:'Move upward to set height',[q[0],q[1]-20],pointer.valid===false&&h>0?'#a33':'#926131');}
function drawGroundPatternExtrudePreview(){if(!ctx||pointer?.type!=='ground-extrude-pattern')return;if(drawGroundSweepPreview())return;const h=pointer.height||0,profiles=pointer.profiles as Vec2[][];for(const loop of profiles){if(loop.length<3)continue;const base=loop.map(p=>[p[0],p[1],0] as Vec3),top=loop.map(p=>[p[0],p[1],h] as Vec3);path3([...base,base[0]],'#177568',true,1.2);path3([...top,top[0]],pointer.valid===false?'#b84d4d':'#b97723',true,1.7);const step=Math.max(1,Math.floor(loop.length/12));for(let i=0;i<loop.length;i+=step)path3([base[i],top[i]],'rgba(185,119,35,.42)',true,1);}const points=profiles.flat();if(points.length){const c=points.reduce((sum,p)=>[sum[0]+p[0],sum[1]+p[1]] as Vec2,[0,0] as Vec2).map(v=>v/points.length) as Vec2,q=project([c[0],c[1],h]);label(h>0?`Height ${fmt(h)} mm · click to create ${profiles.length} solids`:'Move upward to set height',[q[0],q[1]-20],pointer.valid===false&&h>0?'#a33':'#926131');}}

function drawSurfaceTexturePreview(){
  if(!ctx||tool!=='texture')return;
  const target=textureTarget,o=target&&objects.find(v=>v.id===target.objectId);if(!target||!o)return;
  const epsilon=Math.max(TOL.snapGeometry*6,.0008),operation=(($('textureOperation') as HTMLSelectElement|null)?.value||'cut'),color=operation==='add'?'#177568':'#b97723';
  for(const faceId of target.faceIds){if(!geometryApi.hasFace(o.solid,faceId))continue;const loops=faceWorldLoops(o,faceId);for(const loop of loops)if(loop.length)path3([...loop,loop[0]],color,false,2);}
  if(!texturePreviewState)return;const state=texturePreviewState;
  for(const {faceId,preview} of state.patch.faces){
    if(!geometryApi.hasFace(o.solid,faceId))continue;const n=preview.basis.normal;
    for(const loop of preview.reliefLines||[]){if(loop.length<3)continue;const world=loop.map(p=>transformPoint(p,o.transform));path3([...world,world[0]],color,false,1);}
    for(const loop of preview.outlines){if(loop.length<3)continue;const world=loop.map(p=>transformPoint(V.add(fromPlane2(p,preview.basis),V.mul(n,epsilon)),o.transform));path3([...world,world[0]],color,false,1.35);}
  }
  const first=state.patch.faces[0]?.preview;
  if(textureReferenceEnabled()&&!textureBandEnabled()&&first){const origin=transformPoint(V.add(first.basis.origin,V.mul(first.basis.normal,epsilon*2)),o.transform);drawSnapMarker(origin,null,'Pattern origin');}
}
function carveInsetLoopsWorld(o:ModelObject,faceId:FaceId,outer:Vec3[],normal:Vec3,distance:number):Vec3[][]|null{
  const spatial=carveSpatialOpeningGuide(o.solid,faceId,distance);if(spatial.applicable)return spatial.loop?[spatial.loop.map(p=>transformPoint(p,o.transform))]:null;
  if(outer.length<3||distance<=0)return null;const b=planeBasis({normal,offset:V.dot(normal,outer[0])},outer[0]),poly=outer.map(p=>toPlane2(p,b)),insets=carveInsetConcaveProfiles2(poly,distance);return insets?.map(inset=>inset.map(p=>fromPlane2(p,b)))||null;
}
interface CarveOpeningGuide {object:ModelObject;solid:Solid;faceId:FaceId;wall:number;transformKey:string;outer:Vec3[];centroid:Vec3;insets:Vec3[][]|null;}
// One disposable guide, including misses. Camera-only redraws do no offset or
// triangulation work; exact source/face/wall/transform changes derive it anew.
let carveOpeningGuideCache:CarveOpeningGuide|null=null;
function carveOpeningGuide(o:ModelObject,faceId:FaceId,wall:number):CarveOpeningGuide|null{
  const transformKey=derivedTransformKey(o.transform),cached=carveOpeningGuideCache;
  if(cached&&cached.object===o&&cached.solid===o.solid&&cached.faceId===faceId&&Object.is(cached.wall,wall)&&cached.transformKey===transformKey)return cached;
  const outer=faceWorldLoops(o,faceId)[0];if(!outer||outer.length<3)return null;
  const normal=transformDir(o.solid.faces.get(faceId)!.plane.normal,o.transform),centroid=outer.reduce((sum,p)=>V.add(sum,p),[0,0,0] as Vec3).map(v=>v/outer.length) as Vec3;
  const insets=Number.isFinite(wall)&&wall>=CARVE_OUT_POLICY.minimumWall?carveInsetLoopsWorld(o,faceId,outer,normal,wall):null;
  return carveOpeningGuideCache={object:o,solid:o.solid,faceId,wall,transformKey,outer,centroid,insets};
}

function drawCarveOpeningPreview(){
  if(!ctx||tool!=='carve'||!carveTarget)return;const o=objects.find(v=>v.id===carveTarget!.objectId);if(!o||!geometryApi.hasFace(o.solid,carveTarget.faceId))return;const f=o.solid.faces.get(carveTarget.faceId);if(!f)return;
  const wall=Number(($('carveWallThickness') as HTMLInputElement|null)?.value),guide=carveOpeningGuide(o,carveTarget.faceId,wall);if(!guide)return;const valid=Number.isFinite(wall)&&wall>=CARVE_OUT_POLICY.minimumWall,color=valid?'#b97723':'#b84d4d',outer=guide.outer,centroid=guide.centroid;
  path3([...outer,outer[0]],color,false,2.6);if(!valid){fillPath3(outer,'rgba(184,77,77,.10)');const q=project(centroid);label('Opening · enter a valid wall thickness',[q[0],q[1]-20],'#a33',true);return;}
  const insets=guide.insets;if(!insets){const q=project(centroid);label(`Opening selected · wall ${fmt(wall)} mm · inset guide unavailable`,[q[0],q[1]-20],'#926131',true);return;}
  // Offset topology can have fewer vertices after an edge disappears. Do not
  // connect unrelated vertices by array index or imply a false correspondence.
  for(const loop of insets){fillPath3(loop,'rgba(242,176,80,.36)');path3([...loop,loop[0]],'#b97723',true,2.2);}
  const inset=insets[0],insetCentroid=inset.reduce((sum,p)=>V.add(sum,p),[0,0,0] as Vec3).map(v=>v/inset.length) as Vec3;const q=project(insetCentroid);label(`Opening · wall ${fmt(wall)} mm`,[q[0],q[1]-20],'#926131',true);
}
function drawMirrorPlanePreview(){
  if(!ctx||tool!=='mirror'||!mirrorDraft||!mirrorDraftIsCurrent(mirrorDraft))return;
  for(const loop of mirrorDraft.outlines)if(loop.length)path3([...loop,loop[0]],'#b97723',false,MIRROR_PREVIEW_POLICY.lineWidth);
  const point=project(mirrorDraft.center);label('Mirror plane',[point[0],point[1]-MIRROR_PREVIEW_POLICY.labelOffsetPx],'#b97723',true);
}
function drawRotatePlanePreview(){
  if(!ctx||tool!=='rotate')return;const p=activeRotatePointer();
  if(!p){
    const hit=hoverHit;if(rotationPlaneMode!=='face'||!hit)return;const o=objects.find(object=>object.id===hit.id);
    if(!o||!geometryApi.hasFace(o.solid,hit.face))return;
    const face=geometryApi.face(o.solid,hit.face);
    for(const loop of [face.outer,...face.holes]){const world=loop.map(point=>transformPoint(point,o.transform));path3([...world,world[0]],'#b97723',false,2);}
    drawSnapMarker(transformPoint(face.centroid,o.transform),'Center','Pick rotation plane');return;
  }
  if(p.planeMode!=='face')return;
  const frame=planeBasis({normal:p.rotationAxis,offset:V.dot(p.rotationAxis,p.rotationPivot)},p.rotationPivot),ring:Vec3[]=[];
  for(let i=0;i<=ROTATE_INTERACTION_POLICY.ringSegments;i++){const angle=2*Math.PI*i/ROTATE_INTERACTION_POLICY.ringSegments;ring.push(V.add(p.rotationPivot,V.add(V.mul(frame.u,Math.cos(angle)*p.ringRadius),V.mul(frame.v,Math.sin(angle)*p.ringRadius))));}
  path3(ring,'rgba(185,119,35,.85)',true,1.6);
  for(const loop of p.faceLoops){const moved=loop.map(point=>V.add(p.rotationPivot,rotateVectorAroundAxis(V.sub(point,p.rotationPivot),p.rotationAxis,p.numericAngle)));path3([...moved,moved[0]],'#b97723',false,2);}
  drawSnapMarker(p.rotationPivot,'Center',`Rotate ${fmt(rotationDisplayAngle(p.numericAngle))}°`);
}
function drawSketchPreviewOverlay(){
  if(!ctx||!pointer)return;
  if(pointer.type==='ground-extrude'){drawGroundExtrudePreview();return;}
  if(pointer.type==='ground-extrude-pattern'){drawGroundPatternExtrudePreview();return;}
  if(pointer.type==='draw-face'&&pointer.points?.length){const o=pointer.object as ModelObject,b=pointer.basis as PlaneBasis;let pts:Vec2[]=pointer.previewPoints||pointer.points;const world=pts.map(p=>transformPoint(fromPlane2(p,b),o.transform));if(pointer.previewClipped?.length)drawClippedSketchPreview(o,b,pointer.previewClipped);if(world.length>1)path3([...world,world[0]],pointer.previewClipped?.length?'rgba(23,117,104,.48)':'#177568',true);}
  if(pointer.type==='draw-ground'&&pointer.previewWorld?.length)path3(pointer.previewWorld,'#177568',true);
  if(pointer.type==='circle-face'&&pointer.previewPoints?.length){const o=pointer.object as ModelObject,b=pointer.basis as PlaneBasis,world=(pointer.previewPoints as Vec2[]).map(p=>transformPoint(fromPlane2(p,b),o.transform));if(pointer.previewClipped?.length)drawClippedSketchPreview(o,b,pointer.previewClipped);if(world.length>2)path3([...world,world[0]],pointer.previewClipped?.length?'rgba(23,117,104,.42)':'#177568',true,1.4);}
  if(pointer.type==='circle-ground'&&pointer.previewWorld?.length)path3(pointer.previewWorld,'#177568',false,2);
  if(pointer.type==='gear-face'&&pointer.previewPoints?.length){const o=pointer.object as ModelObject,b=pointer.basis as PlaneBasis,world=(pointer.previewPoints as Vec2[]).map(p=>transformPoint(fromPlane2(p,b),o.transform));if(pointer.previewClipped?.length)drawClippedSketchPreview(o,b,pointer.previewClipped);if(world.length>2)path3([...world,world[0]],pointer.previewClipped?.length?'rgba(23,117,104,.42)':'#177568',true,1.5);for(const hole2 of (pointer.previewHoles||[]) as Vec2[][]){const hole=hole2.map(p=>transformPoint(fromPlane2(p,b),o.transform));if(hole.length>2)path3([...hole,hole[0]],'#177568',true,1.5);}drawSnapMarker(pointer.startWorld,pointer.startSnapKind||null,'Center');if(pointer.previewInvalid){const q=project(pointer.startWorld);label(pointer.previewInvalid,[q[0],q[1]-38],'#a33',true);}}
  if(pointer.type==='gear-ground'&&pointer.previewWorld?.length){path3(pointer.previewWorld,'#177568',false,2);for(const hole2 of (pointer.previewHoles||[]) as Vec2[][]){const hole=hole2.map(p=>[p[0],p[1],0] as Vec3);if(hole.length>2)path3([...hole,hole[0]],'#177568',true,1.5);}drawSnapMarker(pointer.startWorld,pointer.startSnapKind||null,'Center');if(pointer.previewInvalid){const q=project(pointer.startWorld);label(pointer.previewInvalid,[q[0],q[1]-38],'#a33',true);}}
  if(pointer.type==='rack-face'&&pointer.previewPoints?.length){const o=pointer.object as ModelObject,b=pointer.basis as PlaneBasis,world=(pointer.previewPoints as Vec2[]).map(p=>transformPoint(fromPlane2(p,b),o.transform));if(pointer.previewClipped?.length)drawClippedSketchPreview(o,b,pointer.previewClipped);if(world.length>2)path3([...world,world[0]],pointer.previewClipped?.length?'rgba(23,117,104,.42)':'#177568',true,1.5);drawSnapMarker(pointer.startWorld,pointer.startSnapKind||null,'Start');if(pointer.previewInvalid){const q=project(pointer.startWorld);label(pointer.previewInvalid,[q[0],q[1]-38],'#a33',true);}}
  if(pointer.type==='rack-ground'&&pointer.previewWorld?.length){path3(pointer.previewWorld,'#177568',false,2);drawSnapMarker(pointer.startWorld,pointer.startSnapKind||null,'Start');if(pointer.previewInvalid){const q=project(pointer.startWorld);label(pointer.previewInvalid,[q[0],q[1]-38],'#a33',true);}}
  if((pointer.type==='slot-face'||pointer.type==='arcslot-face')&&pointer.previewPoints?.length){const o=pointer.object as ModelObject,b=pointer.basis as PlaneBasis,world=(pointer.previewPoints as Vec2[]).map(p=>transformPoint(fromPlane2(p,b),o.transform));if(pointer.previewClipped?.length)drawClippedSketchPreview(o,b,pointer.previewClipped);path3([...world,world[0]],pointer.previewClipped?.length?'rgba(23,117,104,.42)':'#177568',true,1.5);drawSnapMarker(pointer.startWorld,pointer.startSnapKind||null,'Center');if(pointer.previewInvalid){const q=project(pointer.startWorld);label(pointer.previewInvalid,[q[0],q[1]-38],'#a33',true);}}
  if((pointer.type==='slot-ground'||pointer.type==='arcslot-ground')&&pointer.previewWorld?.length){path3(pointer.previewWorld,'#177568',false,2);drawSnapMarker(pointer.startWorld,pointer.startSnapKind||null,'Center');if(pointer.previewInvalid){const q=project(pointer.startWorld);label(pointer.previewInvalid,[q[0],q[1]-38],'#a33',true);}}
  if(pointer.type==='boltcircle-face'&&pointer.previewProfiles?.length){const o=pointer.object as ModelObject,b=pointer.basis as PlaneBasis;for(const loop of pointer.previewProfiles as Vec2[][]){const world=loop.map(p=>transformPoint(fromPlane2(p,b),o.transform));path3([...world,world[0]],'#177568',true,1.4);}for(const clips of (pointer.previewClippedGroups||[]))if(clips?.length)drawClippedSketchPreview(o,b,clips);drawSnapMarker(pointer.startWorld,pointer.startSnapKind||null,'Center');if(pointer.previewInvalid){const q=project(pointer.startWorld);label(pointer.previewInvalid,[q[0],q[1]-38],'#a33',true);}}
  if(pointer.type==='boltcircle-ground'&&pointer.previewWorldGroups?.length){for(const loop of pointer.previewWorldGroups as Vec3[][])path3(loop,'#177568',false,1.6);drawSnapMarker(pointer.startWorld,pointer.startSnapKind||null,'Center');if(pointer.previewInvalid){const q=project(pointer.startWorld);label(pointer.previewInvalid,[q[0],q[1]-38],'#a33',true);}}
  if(pointer.type==='arc-face'&&pointer.previewArc?.length){const o=pointer.object as ModelObject,b=pointer.basis as PlaneBasis,world=(pointer.previewArc as Vec2[]).map(p=>transformPoint(fromPlane2(p,b),o.transform));if(pointer.previewClipped?.length)drawClippedSketchPreview(o,b,pointer.previewClipped);else if(pointer.previewRegion?.length){const region=(pointer.previewRegion as Vec2[]).map(p=>transformPoint(fromPlane2(p,b),o.transform));fillPath3(region,'rgba(23,117,104,.10)');}if(world.length>1)path3(world,'#177568',false,2);if(pointer.arcOrder==='end-first'&&pointer.points?.length===2){const chord=(pointer.points as Vec2[]).map(p=>transformPoint(fromPlane2(p,b),o.transform));path3(chord,'rgba(185,119,35,.7)',true,1.5);}if(pointer.previewClosure?.length){const closure=(pointer.previewClosure as Vec2[]).map(p=>transformPoint(fromPlane2(p,b),o.transform));path3(closure,'rgba(185,119,35,.95)',true,2);const anchor=pointer.arcOrder==='end-first'?project(transformPoint(fromPlane2((pointer.previewArc as Vec2[])[Math.floor((pointer.previewArc as Vec2[]).length/2)],b),o.transform)):project(world[world.length-1]);label(pointer.arcOrder==='end-first'?'Click: use this arc':'Click: finish arc',[anchor[0],anchor[1]-24],'#926131',true);}else if(pointer.arcOrder==='end-first'&&pointer.points?.length===2){const q=project(transformPoint(fromPlane2(pointer.points[1],b),o.transform));label('Choose a point that defines the arc',[q[0],q[1]-24],'#926131',true);}for(const p of pointer.points as Vec2[]){const q=project(transformPoint(fromPlane2(p,b),o.transform));ctx.beginPath();ctx.arc(q[0],q[1],3.8,0,Math.PI*2);ctx.fillStyle='#177568';ctx.fill();ctx.strokeStyle='#fff';ctx.lineWidth=1.2;ctx.stroke();}}
  if(pointer.type==='poly-face'&&pointer.previewPoints?.length){const o=pointer.object as ModelObject,b=pointer.basis as PlaneBasis,world=(pointer.previewPoints as Vec2[]).map(p=>transformPoint(fromPlane2(p,b),o.transform));if(pointer.previewClipped?.length)drawClippedSketchPreview(o,b,pointer.previewClipped);else if(pointer.previewRegion?.length){const region=(pointer.previewRegion as Vec2[]).map(p=>transformPoint(fromPlane2(p,b),o.transform));fillPath3(region,'rgba(23,117,104,.10)');}if(world.length>1)path3(world,'#177568',false,2);if(pointer.previewClosure?.length){const closure=(pointer.previewClosure as Vec2[]).map(p=>transformPoint(fromPlane2(p,b),o.transform));path3(closure,'rgba(185,119,35,.95)',true,2);const q=project(world[world.length-1]);label('Click: finish edge-to-edge',[q[0],q[1]-24],'#926131',true);}for(const p of (pointer.points as Vec2[])){const q=project(transformPoint(fromPlane2(p,b),o.transform));ctx.beginPath();ctx.arc(q[0],q[1],3.5,0,Math.PI*2);ctx.fillStyle='#177568';ctx.fill();ctx.strokeStyle='#fff';ctx.lineWidth=1.2;ctx.stroke();}}
  if(pointer.type==='poly-ground'&&pointer.previewWorld?.length){path3(pointer.previewWorld,'#177568',false,2);for(const p of pointer.points as Vec2[]){const q=project([p[0],p[1],0]);ctx.beginPath();ctx.arc(q[0],q[1],3.5,0,Math.PI*2);ctx.fillStyle='#177568';ctx.fill();ctx.strokeStyle='#fff';ctx.lineWidth=1.2;ctx.stroke();}}
}
function guideScreenSegment(g:GuideLine):[[number,number,number],[number,number,number]]|null{
  // A construction guide is mathematically infinite, but a perspective camera
  // only sees the half of that line in front of its near plane. Projecting the
  // entire mathematical line as an infinite 2D line makes it continue through
  // the vanishing point and reappear on the other side. Clip in camera space
  // first, then project the visible half-line. Orthographic view still projects
  // an infinite 3D line to an infinite 2D line.
  const d=V.unit(g.direction),rel=V.sub(g.point,basis.eye);
  const dx=V.dot(d,basis.right),dy=V.dot(d,basis.up),dz=V.dot(d,basis.forward);
  const x=V.dot(rel,basis.right),y=V.dot(rel,basis.up),z=V.dot(rel,basis.forward);
  const margin=24,minX=-margin,maxX=W+margin,minY=-margin,maxY=H+margin;
  const clipInfinite=(px:number,py:number,sx0:number,sy0:number,zTag:number):[[number,number,number],[number,number,number]]|null=>{
    let sx=sx0,sy=sy0;const sl=Math.hypot(sx,sy);if(sl<1e-10)return [[px,py,zTag],[px,py,zTag]];sx/=sl;sy/=sl;
    let t0=-Infinity,t1=Infinity;
    const clip=(p:number,v:number,lo:number,hi:number)=>{if(Math.abs(v)<1e-12)return p>=lo&&p<=hi;let a=(lo-p)/v,b=(hi-p)/v;if(a>b)[a,b]=[b,a];t0=Math.max(t0,a);t1=Math.min(t1,b);return t0<=t1;};
    if(!clip(px,sx,minX,maxX)||!clip(py,sy,minY,maxY))return null;
    return [[px+sx*t0,py+sy*t0,zTag],[px+sx*t1,py+sy*t1,zTag]];
  };
  const clipFinite=(ax:number,ay:number,bx:number,by:number):[[number,number,number],[number,number,number]]|null=>{
    const vx=bx-ax,vy=by-ay;let u0=0,u1=1;
    const test=(p:number,q:number)=>{if(Math.abs(p)<1e-12)return q>=0;const r=q/p;if(p<0){if(r>u1)return false;u0=Math.max(u0,r);}else{if(r<u0)return false;u1=Math.min(u1,r);}return true;};
    if(!test(-vx,ax-minX)||!test(vx,maxX-ax)||!test(-vy,ay-minY)||!test(vy,maxY-ay))return null;
    return [[ax+vx*u0,ay+vy*u0,1],[ax+vx*u1,ay+vy*u1,1]];
  };
  if(camera.orthographic){
    const scale=H/(2*basis.span),px=W/2+x*scale,py=H/2-y*scale;
    return clipInfinite(px,py,dx,-dy,z);
  }
  const nearPlane=cameraClip.nearPlane,k=H*basis.focal/2;
  if(Math.abs(dz)<1e-8){
    if(z<nearPlane)return null;
    const px=W/2+k*x/z,py=H/2-k*y/z;
    return clipInfinite(px,py,dx,-dy,z);
  }
  const tNear=(nearPlane-z)/dz,nx=x+dx*tNear,ny=y+dy*tNear;
  const nearX=W/2+k*nx/nearPlane,nearY=H/2-k*ny/nearPlane;
  const vanishX=W/2+k*dx/dz,vanishY=H/2-k*dy/dz;
  if(!Number.isFinite(nearX+nearY+vanishX+vanishY))return null;
  return clipFinite(vanishX,vanishY,nearX,nearY);
}
function guideLineCameraSegment(g:GuideLine,state:CameraState,frame:RenderCameraFrame,width:number,height:number):[Vec3,Vec3]|null{
  const d=V.unit(g.direction);if(V.len(d)<1e-12)return null;
  const rel=V.sub(g.point,frame.eye),x=V.dot(rel,frame.right),y=V.dot(rel,frame.up),z=V.dot(rel,frame.forward),dx=V.dot(d,frame.right),dy=V.dot(d,frame.up),dz=V.dot(d,frame.forward);
  let t0=-Infinity,t1=Infinity;
  const clipLeq=(a:number,b:number)=>{if(Math.abs(b)<1e-12)return a<=0;const t=-a/b;if(b>0)t1=Math.min(t1,t);else t0=Math.max(t0,t);return t0<=t1;};
  if(state.orthographic){
    const sx=frame.span*width/height,sy=frame.span,near=cameraClip.nearPlane,far=cameraClip.farPlane;
    if(!clipLeq(x-sx,dx)||!clipLeq(-x-sx,-dx)||!clipLeq(y-sy,dy)||!clipLeq(-y-sy,-dy)||!clipLeq(z-far,dz)||!clipLeq(near-z,-dz))return null;
  }else{
    const near=cameraClip.nearPlane,far=cameraClip.farPlane,aspect=width/height,f=frame.focal;
    if(!clipLeq(near-z,-dz)||!clipLeq(z-far,dz)||!clipLeq(x*f-aspect*z,dx*f-aspect*dz)||!clipLeq(-x*f-aspect*z,-dx*f-aspect*dz)||!clipLeq(y*f-z,dy*f-dz)||!clipLeq(-y*f-z,-dy*f-dz))return null;
  }
  if(!Number.isFinite(t0)||!Number.isFinite(t1)||t1-t0<TOL.minimumEdge)return null;
  return [V.add(g.point,V.mul(d,t0)),V.add(g.point,V.mul(d,t1))];
}
function guideLineViewSegment(g:GuideLine):[Vec3,Vec3]|null{return guideLineCameraSegment(g,camera,basis,W,H);}
function worldAtScreenDepth(x:number,y:number,z:number):Vec3{
  if(camera.orthographic){
    const scale=H/(2*basis.span);
    return V.add(basis.eye,V.add(V.mul(basis.forward,z),V.add(V.mul(basis.right,(x-W/2)/scale),V.mul(basis.up,(H/2-y)/scale))));
  }
  const k=H*basis.focal/2;
  return V.add(basis.eye,V.add(V.mul(basis.forward,z),V.add(V.mul(basis.right,(x-W/2)*z/k),V.mul(basis.up,(H/2-y)*z/k))));
}
function projectedFractionWorldPoint(a:Vec3,b:Vec3,sa:[number,number,number],sb:[number,number,number],u:number):Vec3{
  if(camera.orthographic)return V.lerp(a,b,u);
  // Perspective projection is linear in screen space, but not in the world-space
  // segment parameter. Convert the desired projected fraction back to the matching
  // point on the 3D segment so short screen dashes do not stretch deeply toward the
  // camera when a guide becomes nearly view-parallel.
  const denom=(1-u)*sb[2]+u*sa[2];
  const t=Math.abs(denom)>1e-12?u*sa[2]/denom:u;
  return V.lerp(a,b,clamp(t,0,1));
}
function addDashedGuideRibbonVertices(data:number[],a:Vec3,b:Vec3,color:number[],widthPx:number){
  const sa=project(a),sb=project(b),screenDx=sb[0]-sa[0],screenDy=sb[1]-sa[1],screenLength=Math.hypot(screenDx,screenDy);if(screenLength<1)return;
  // Depth-tested guides are expanded in screen space and then unprojected at the
  // guide's own depth. This keeps their CSS-pixel width stable even when the guide
  // points strongly toward the camera, while still letting the depth buffer occlude it.
  const nx=-screenDy/screenLength,ny=screenDx/screenLength,dashPx=GUIDE_VISUAL_POLICY.dashPx,gapPx=GUIDE_VISUAL_POLICY.gapPx,cyclePx=dashPx+gapPx,cycles=Math.min(GUIDE_VISUAL_POLICY.maxDashSegments,Math.max(1,Math.ceil(screenLength/cyclePx))),halfWidth=Math.max(GUIDE_VISUAL_POLICY.minHalfWidthPx,widthPx/2);
  for(let i=0;i<cycles;i++){
    const startPx=i*cyclePx;if(startPx>=screenLength)break;
    const endPx=Math.min(startPx+dashPx,screenLength),uA=startPx/screenLength,uB=endPx/screenLength;
    const pA=projectedFractionWorldPoint(a,b,sa,sb,uA),pB=projectedFractionWorldPoint(a,b,sa,sb,uB),zA=project(pA)[2],zB=project(pB)[2];
    const ax=sa[0]+screenDx*uA,ay=sa[1]+screenDy*uA,bx=sa[0]+screenDx*uB,by=sa[1]+screenDy*uB;
    const aL=worldAtScreenDepth(ax+nx*halfWidth,ay+ny*halfWidth,zA),aR=worldAtScreenDepth(ax-nx*halfWidth,ay-ny*halfWidth,zA),bL=worldAtScreenDepth(bx+nx*halfWidth,by+ny*halfWidth,zB),bR=worldAtScreenDepth(bx-nx*halfWidth,by-ny*halfWidth,zB);
    addVertex(data,aL,color);addVertex(data,aR,color);addVertex(data,bL,color);
    addVertex(data,bL,color);addVertex(data,aR,color);addVertex(data,bR,color);
  }
}
function drawDepthTestedGuideLines(){
  if(!$('showGuides')?.checked||guideLinesThroughSolids())return;
  const selected=modelDocument.selection?.kind==='guide'?modelDocument.selection.guideId:null,hover=modelDocument.hover?.kind==='guide'?modelDocument.hover.guideId:null,data:number[]=[];
  for(const g of guides){const active=g.id===selected||g.id===hover,color=active?[.725,.467,.137]:[.212,.443,.620],width=active?GUIDE_VISUAL_POLICY.activeWidthPx:GUIDE_VISUAL_POLICY.normalWidthPx;if(g.kind==='line'){const segment=guideLineViewSegment(g);if(segment)addDashedGuideRibbonVertices(data,segment[0],segment[1],color,width);}else if(g.kind==='circle'){const pts=guideCircleWorldPoints(g,96);for(let i=0;i+1<pts.length;i++)addDashedGuideRibbonVertices(data,pts[i],pts[i+1],color,width);}}
  const count=upload(guideDepthBuffer,data);if(!count)return;
  // Pull the guide ribbon very slightly toward the camera in depth-buffer space.
  // Without this bias, one side of a screen-facing ribbon can fall behind the
  // support face at grazing view angles and appear thinner even though its projected
  // geometry is the requested pixel width. Real foreground solids still occlude it.
  gl.enable(gl.POLYGON_OFFSET_FILL);
  gl.polygonOffset(GUIDE_VISUAL_POLICY.polygonOffsetFactor,GUIDE_VISUAL_POLICY.polygonOffsetUnits);
  drawStored(guideDepthBuffer,gl.TRIANGLES,count);
  gl.disable(gl.POLYGON_OFFSET_FILL);
}
function screenSegmentDistance(x:number,y:number,a:[number,number,number],b:[number,number,number]):number{const dx=b[0]-a[0],dy=b[1]-a[1],l2=dx*dx+dy*dy;if(l2<1e-9)return Math.hypot(x-a[0],y-a[1]);const t=clamp(((x-a[0])*dx+(y-a[1])*dy)/l2,0,1),px=a[0]+dx*t,py=a[1]+dy*t;return Math.hypot(x-px,y-py);}
function drawScreenSegment(a:[number,number,number],b:[number,number,number],color:string,dashed=false,width=1.6){if(!ctx)return;ctx.beginPath();ctx.moveTo(a[0],a[1]);ctx.lineTo(b[0],b[1]);ctx.strokeStyle=color;ctx.lineWidth=width;ctx.setLineDash(dashed?[5,4]:[]);ctx.stroke();ctx.setLineDash([]);}
function guideCircleWorldPoints(g:GuideCircle,segments=96):Vec3[]{const {u,v}=guideCircleBasis(g.normal),out:Vec3[]=[];for(let i=0;i<=segments;i++){const a=i*Math.PI*2/segments;out.push(V.add(g.center,V.add(V.mul(u,Math.cos(a)*g.radius),V.mul(v,Math.sin(a)*g.radius))));}return out;}
function guideCircleScreenDistance(x:number,y:number,g:GuideCircle):number{const pts=guideCircleWorldPoints(g,64).map(project);let best=Infinity;for(let i=0;i+1<pts.length;i++)best=Math.min(best,screenSegmentDistance(x,y,pts[i],pts[i+1]));return best;}
function drawGuideCircleCenter(g:GuideCircle,color:string,width:number){if(!ctx)return;const q=project(g.center),r=activeGuideCenterRadius(g);ctx.strokeStyle=color;ctx.lineWidth=width;ctx.beginPath();ctx.moveTo(q[0]-r,q[1]);ctx.lineTo(q[0]+r,q[1]);ctx.moveTo(q[0],q[1]-r);ctx.lineTo(q[0],q[1]+r);ctx.stroke();}
function activeGuideCenterRadius(g:GuideCircle):number{const active=(modelDocument.selection?.kind==='guide'&&modelDocument.selection.guideId===g.id)||(modelDocument.hover?.kind==='guide'&&modelDocument.hover.guideId===g.id);return active?5:4;}
function guidePlaneFrame(g:GuidePlane){
  const scale=clamp(camera.distance*.18,12,60),n=V.unit(g.normal),storedAxis=g.axis?normalizedGuidePlaneAxis(g.axis,n):undefined,u=storedAxis|| (Math.abs(n[2])<.9?V.unit(V.cross(n,[0,0,1])):V.unit(V.cross(n,[0,1,0]))),v=V.unit(V.cross(n,u)),corners=[V.add(g.origin,V.add(V.mul(u,-scale),V.mul(v,-scale))),V.add(g.origin,V.add(V.mul(u,scale),V.mul(v,-scale))),V.add(g.origin,V.add(V.mul(u,scale),V.mul(v,scale))),V.add(g.origin,V.add(V.mul(u,-scale),V.mul(v,scale)))];return {scale,u,v,corners};
}
const SPLIT_PLANE_GESTURE_POLICY=Object.freeze({moveHandleScale:.58,rotateHandleScale:.72,minimumProjectionPixels:4,minimumPixelsPerMm:.05,minimumCameraSpan:40,cameraSpanFactor:1.5,rotationProbeDegrees:5,minimumRotationProjectionPixels:1,fallbackPixelsPerDegree:2,angleSnapDegrees:15,distancePrecision:1e6,changeTolerance:1e-8});
function splitPlaneHandleAxis(g:GuidePlane,kind:'move'|'tilt'):Vec3 {
  const f=guidePlaneFrame(g),value=String($(kind==='move'?'splitPlaneMoveAxis':'splitPlaneTiltAxis').value||(kind==='move'?'normal':'u'));
  return value==='x'?[1,0,0]:value==='y'?[0,1,0]:value==='z'?[0,0,1]:value==='u'?f.u:value==='v'?f.v:V.unit(g.normal);
}
function splitPlaneGizmoGeometry(g:GuidePlane){
  const frame=guidePlaneFrame(g),normal=V.unit(g.normal),axis=splitPlaneHandleAxis(g,'tilt'),moveAxis=splitPlaneHandleAxis(g,'move'),movePoint=V.add(g.origin,V.mul(moveAxis,frame.scale*SPLIT_PLANE_GESTURE_POLICY.moveHandleScale)),rotateRadial=V.unit(V.cross(normal,axis));
  const radial=V.len(rotateRadial)>TOL.minimumEdge?rotateRadial:splitPlaneDefaultAxis(axis),rotateRadius=frame.scale*SPLIT_PLANE_GESTURE_POLICY.rotateHandleScale,rotatePoint=V.add(g.origin,V.mul(radial,rotateRadius));return {frame,normal,axis,moveAxis,movePoint,rotateRadial:radial,rotateRadius,rotatePoint};
}
function splitPlaneGizmoHit(x:number,y:number,g:GuidePlane):'move'|'rotate'|null{const z=splitPlaneGizmoGeometry(g);if(z.rotatePoint){const q=project(z.rotatePoint);if(q[2]>0&&Math.hypot(x-q[0],y-q[1])<=11)return 'rotate';}const m=project(z.movePoint);return m[2]>0&&Math.hypot(x-m[0],y-m[1])<=11?'move':null;}
function drawSplitPlaneGizmo(g:GuidePlane){
  if(!ctx||tool!=='splitplane'||activeSplitPlaneId!==g.id)return;const z=splitPlaneGizmoGeometry(g),moveColor='#177568',rotateColor='#b97723';path3([g.origin,z.movePoint],moveColor,false,2.5);const mq=project(z.movePoint);ctx.beginPath();ctx.arc(mq[0],mq[1],6.5,0,Math.PI*2);ctx.fillStyle='#fff';ctx.fill();ctx.strokeStyle=moveColor;ctx.lineWidth=2.5;ctx.stroke();label('move',[mq[0]+9,mq[1]-8],moveColor,true);
  if(z.axis&&z.rotateRadial&&z.rotatePoint){const axisSpan=z.frame.scale*.7;path3([V.add(g.origin,V.mul(z.axis,-axisSpan)),V.add(g.origin,V.mul(z.axis,axisSpan))],rotateColor,true,1.6);const ring:Vec3[]=[];for(let i=0;i<=48;i++){const a=i/48*Math.PI*2,radial=V.add(V.mul(z.rotateRadial,Math.cos(a)),V.mul(V.unit(V.cross(z.axis,z.rotateRadial)),Math.sin(a)));ring.push(V.add(g.origin,V.mul(radial,z.rotateRadius)));}path3(ring,'rgba(185,119,35,.72)',true,1.5);const rq=project(z.rotatePoint);ctx.beginPath();ctx.arc(rq[0],rq[1],6.5,0,Math.PI*2);ctx.fillStyle='#fff';ctx.fill();ctx.strokeStyle=rotateColor;ctx.lineWidth=2.5;ctx.stroke();label('tilt',[rq[0]+9,rq[1]-8],rotateColor,true);}
}
function guidePlaneScreenDistance(x:number,y:number,g:GuidePlane):number{if(g.surface){const ps=splitSurfaceWorldPoints(g.surface,splitSurfaceGuideFrame(g)).map(project);let best=Infinity;for(let y0=0;y0<g.surface.rows;y0++)for(let x0=0;x0<g.surface.columns;x0++){const i=y0*g.surface.columns+x0;if(x0+1<g.surface.columns)best=Math.min(best,screenSegmentDistance(x,y,ps[i],ps[i+1]));if(y0+1<g.surface.rows)best=Math.min(best,screenSegmentDistance(x,y,ps[i],ps[i+g.surface.columns]));}return best;}const f=guidePlaneFrame(g),c=f.corners.map(project),crossU=[project(V.add(g.origin,V.mul(f.u,-f.scale))),project(V.add(g.origin,V.mul(f.u,f.scale)))] as [[number,number,number],[number,number,number]],crossV=[project(V.add(g.origin,V.mul(f.v,-f.scale))),project(V.add(g.origin,V.mul(f.v,f.scale)))] as [[number,number,number],[number,number,number]];let best=Math.min(screenSegmentDistance(x,y,crossU[0],crossU[1]),screenSegmentDistance(x,y,crossV[0],crossV[1]));for(let i=0;i<4;i++)best=Math.min(best,screenSegmentDistance(x,y,c[i],c[(i+1)%4]));return best;}
function hitTestGuide(x:number,y:number):GuideId|null{if(!$('showGuides')?.checked)return null;let best:GuideId|null=null,bestD=8;for(const g of guides){if(g.kind==='point'){const p=project(g.point),d=Math.hypot(x-p[0],y-p[1]);if(d<bestD){bestD=d;best=g.id;}}else if(g.kind==='line'){const seg=guideScreenSegment(g);if(!seg)continue;const d=screenSegmentDistance(x,y,seg[0],seg[1]);if(d<bestD){bestD=d;best=g.id;}}else if(g.kind==='circle'){const c=project(g.center),dc=Math.hypot(x-c[0],y-c[1]),d=Math.min(dc,guideCircleScreenDistance(x,y,g));if(d<bestD){bestD=d;best=g.id;}}else{const d=guidePlaneScreenDistance(x,y,g);if(d<bestD){bestD=d;best=g.id;}}}return best;}
function hitTestGuideLine(x:number,y:number):GuideId|null{if(!$('showGuides')?.checked)return null;let best:GuideId|null=null,bestD=8;for(const g of guides){let d=Infinity;if(g.kind==='line'){const seg=guideScreenSegment(g);if(seg)d=screenSegmentDistance(x,y,seg[0],seg[1]);}else if(g.kind==='circle')d=guideCircleScreenDistance(x,y,g);if(d<bestD){bestD=d;best=g.id;}}return best;}
function dimensionScreenSegment(d:DimensionAnnotation):[[number,number,number],[number,number,number]]|null{if(!isDimensionVisible(d))return null;const a=project(resolveGeometryAnchor(d.a)),b=project(resolveGeometryAnchor(d.b));if(!Number.isFinite(a[0]+a[1]+a[2]+b[0]+b[1]+b[2])||a[2]<=0||b[2]<=0)return null;return [a,b];}
function hitTestDimension(x:number,y:number):DimensionId|null{if(!$('showDimensions')?.checked)return null;let best:DimensionId|null=null,bestD=9;for(const d of dimensions){const seg=dimensionScreenSegment(d);if(!seg)continue;const dist=screenSegmentDistance(x,y,seg[0],seg[1]);if(dist<bestD){bestD=dist;best=d.id;}}return best;}
function drawDimensions(){if(!ctx||!$('showDimensions')?.checked)return;const selected=modelDocument.selection?.kind==='dimension'?modelDocument.selection.dimensionId:null,hover=modelDocument.hover?.kind==='dimension'?modelDocument.hover.dimensionId:null;for(const d of dimensions){const seg=dimensionScreenSegment(d);if(!seg)continue;const active=d.id===selected||d.id===hover,color=active?'#b97723':'#276a61',width=active?2.4:1.5,a=seg[0],b=seg[1],dx=b[0]-a[0],dy=b[1]-a[1],len=Math.hypot(dx,dy)||1,nx=-dy/len,ny=dx/len,offset=12,ao:[number,number,number]=[a[0]+nx*offset,a[1]+ny*offset,a[2]],bo:[number,number,number]=[b[0]+nx*offset,b[1]+ny*offset,b[2]];drawScreenSegment(a,ao,color,false,1);drawScreenSegment(b,bo,color,false,1);drawScreenSegment(ao,bo,color,false,width);const tick=5;drawScreenSegment([ao[0]-nx*tick,ao[1]-ny*tick,ao[2]],[ao[0]+nx*tick,ao[1]+ny*tick,ao[2]],color,false,width);drawScreenSegment([bo[0]-nx*tick,bo[1]-ny*tick,bo[2]],[bo[0]+nx*tick,bo[1]+ny*tick,bo[2]],color,false,width);label((d.label?d.label+' · ':'')+fmt(dimensionValue(d))+' mm',[(ao[0]+bo[0])/2+nx*12,(ao[1]+bo[1])/2+ny*12],color,true);}}

function drawSplitSurfaceGuide(g:GuidePlane):void {
  if(!ctx||!g.surface)return;const grid=g.surface,points=splitSurfaceWorldPoints(grid,splitSurfaceGuideFrame(g)),screen=points.map(project),active=g.id===activeSplitPlaneId,color=active?'#177568':'rgba(54,113,158,.82)';
  for(const tri of splitSurfaceTriangles(grid)){const ps=tri.map(i=>screen[i]);if(ps.some(p=>p[2]<=0))continue;ctx.beginPath();ctx.moveTo(ps[0][0],ps[0][1]);ctx.lineTo(ps[1][0],ps[1][1]);ctx.lineTo(ps[2][0],ps[2][1]);ctx.closePath();ctx.fillStyle=active?'rgba(23,117,104,.10)':'rgba(54,113,158,.06)';ctx.fill();}
  for(let y=0;y<grid.rows;y++)path3(points.slice(y*grid.columns,(y+1)*grid.columns),color,false,1);
  for(let x=0;x<grid.columns;x++)path3(Array.from({length:grid.rows},(_,y)=>points[y*grid.columns+x]),color,false,1);
  for(let i=0;i<points.length;i++){const q=screen[i];if(q[2]<=0)continue;const selected=active&&splitSurfaceSelectedPoint===i;ctx.beginPath();ctx.arc(q[0],q[1],selected?6:active&&splitSurfaceMode==='edit'?3.5:2,0,Math.PI*2);ctx.fillStyle=selected?'#b97723':'#fff';ctx.fill();ctx.strokeStyle=color;ctx.lineWidth=1.5;ctx.stroke();}
  if(active&&splitSurfaceMode==='edit'&&splitSurfaceSelectedPoint!==null){const point=points[splitSurfaceSelectedPoint];if(point){const radius=Number($('splitSurfaceRadius').value),frame=splitSurfaceBasis(splitSurfaceGuideFrame(g));if(Number.isFinite(radius)&&radius>0){const ring=Array.from({length:SPLIT_SURFACE_POLICY.influenceRingSegments+1},(_,i)=>{const a=i/SPLIT_SURFACE_POLICY.influenceRingSegments*Math.PI*2;return V.add(point,V.add(V.mul(frame.u,Math.cos(a)*radius),V.mul(frame.v,Math.sin(a)*radius)));});path3(ring,'rgba(185,119,35,.8)',true,1.5);}}}
  const q=project(points[0]);label(g.label||'Curved split surface',[q[0]+8,q[1]-8],color,true);drawSplitPlaneGizmo(g);
}
function drawGuides(){
  if(!ctx)return;const showGuides=!!$('showGuides')?.checked,selected=modelDocument.selection?.kind==='guide'?modelDocument.selection.guideId:null,hover=modelDocument.hover?.kind==='guide'?modelDocument.hover.guideId:null;
  for(const g of guides){if(!showGuides&&g.id!==activeSplitPlaneId)continue;const active=g.id===selected||g.id===hover,color=active?'#b97723':'rgba(54,113,158,.82)',width=active?GUIDE_VISUAL_POLICY.activeWidthPx:GUIDE_VISUAL_POLICY.normalWidthPx;
    if(g.kind==='point'){const q=project(g.point);ctx.beginPath();ctx.arc(q[0],q[1],active?5:4,0,Math.PI*2);ctx.fillStyle='#fff';ctx.fill();ctx.strokeStyle=color;ctx.lineWidth=width;ctx.stroke();}
    else if(g.kind==='line'){if(guideLinesThroughSolids()){const seg=guideScreenSegment(g);if(seg)drawScreenSegment(seg[0],seg[1],color,true,width);}}
    else if(g.kind==='circle'){if(guideLinesThroughSolids())path3(guideCircleWorldPoints(g),color,true,width);drawGuideCircleCenter(g,color,width);}
    else if(g.surface){drawSplitSurfaceGuide(g);}
    else{const f=guidePlaneFrame(g),splitActive=g.id===activeSplitPlaneId,corners=f.corners.map(project);ctx.save();ctx.beginPath();ctx.moveTo(corners[0][0],corners[0][1]);for(let i=1;i<corners.length;i++)ctx.lineTo(corners[i][0],corners[i][1]);ctx.closePath();ctx.fillStyle=splitActive?'rgba(23,117,104,.10)':'rgba(54,113,158,.06)';ctx.fill();ctx.strokeStyle=splitActive?'rgba(23,117,104,.92)':color;ctx.lineWidth=splitActive?Math.max(2,width):width;ctx.setLineDash([6,4]);ctx.stroke();ctx.setLineDash([]);ctx.restore();path3([V.add(g.origin,V.mul(f.u,-f.scale)),V.add(g.origin,V.mul(f.u,f.scale))],splitActive?'#177568':color,true,width);path3([V.add(g.origin,V.mul(f.v,-f.scale)),V.add(g.origin,V.mul(f.v,f.scale))],splitActive?'#177568':color,true,width);const q=project(g.origin);label(g.label||'Guide plane',[q[0]+8,q[1]-8],splitActive?'#177568':undefined,true);drawSplitPlaneGizmo(g);}
  }
}
function drawGuidePreview(){
  if(!ctx||!pointer)return;
  if(pointer.type==='split-plane-two-point'){
    const a=pointer.pointA as Vec3,b=(pointer.previewB||a) as Vec3;path3([a,b],'rgba(185,119,35,.95)',true,2.2);drawSnapMarker(a,pointer.startSnapKind||null,'Point 1');
    if(V.len(V.sub(b,a))>=TOL.minimumEdge){try{const axis=V.unit(V.sub(b,a)),normal=twoPointSplitPlaneNormal(a,b,basis.forward),preview:GuidePlane={id:'preview-split-plane',kind:'plane',origin:V.mul(V.add(a,b),.5),normal,axis,label:'Split plane preview'},f=guidePlaneFrame(preview),corners=f.corners.map(project);ctx.save();ctx.beginPath();ctx.moveTo(corners[0][0],corners[0][1]);for(let i=1;i<corners.length;i++)ctx.lineTo(corners[i][0],corners[i][1]);ctx.closePath();ctx.fillStyle='rgba(23,117,104,.08)';ctx.fill();ctx.strokeStyle='rgba(23,117,104,.78)';ctx.lineWidth=1.8;ctx.setLineDash([6,4]);ctx.stroke();ctx.restore();path3([V.add(preview.origin,V.mul(axis,-f.scale)),V.add(preview.origin,V.mul(axis,f.scale))],'rgba(185,119,35,.9)',true,1.8);}catch{}}
    return;
  }
  if(pointer.type==='guide-line'){const p=pointer.previewWorld||pointer.startWorld;if(!p)return;path3([pointer.startWorld,p],'rgba(54,113,158,.95)',true,2);drawSnapMarker(pointer.startWorld,pointer.startSnapKind||null,'Start');return;}
  if(pointer.type==='guide-offset'){const source:GuideLine={id:'preview-source',kind:'line',point:pointer.sourcePoint,direction:pointer.sourceDirection,planeNormal:pointer.planeNormal},preview:GuideLine={id:'preview-offset',kind:'line',point:pointer.previewPoint,direction:pointer.sourceDirection,planeNormal:pointer.planeNormal},a=guideScreenSegment(source),b=guideScreenSegment(preview);if(a)drawScreenSegment(a[0],a[1],'rgba(54,113,158,.38)',true,1.2);if(b)drawScreenSegment(b[0],b[1],'rgba(185,119,35,.96)',true,2.2);const q=project(pointer.previewPoint);label(`Offset ${pointer.distance>=0?'+':''}${fmt(pointer.distance)} mm`,[q[0],q[1]-18],'#926131',true);return;}
  if(pointer.type==='guide-circle'){const preview:GuideCircle={id:'preview-guide-circle',kind:'circle',center:pointer.centerWorld,normal:pointer.normal,radius:pointer.radius,label:'Guide circle'};path3(guideCircleWorldPoints(preview),'rgba(54,113,158,.95)',true,2);drawGuideCircleCenter(preview,'rgba(185,119,35,.96)',2);drawSnapMarker(pointer.centerWorld,pointer.startSnapKind||'Center','Center');const q=project(pointer.centerWorld);label(`Ø ${fmt(pointer.radius*2)} mm`,[q[0],q[1]-18],'#926131',true);}
}
function drawEntitySelectionRef(ref:EntityRef|null,hover=false){if(!ctx||!ref||!('objectId' in ref))return;const o=objects.find(v=>v.id===ref.objectId);if(!o)return;const color=hover?'rgba(213,140,46,.72)':'#d58c2e';if(ref.kind==='edge'&&geometryApi.hasHalfEdge(o.solid,ref.halfEdgeId)){const e=geometryApi.edge(o.solid,ref.halfEdgeId),a=transformPoint(e.a,o.transform),b=transformPoint(e.b,o.transform);path3([a,b],color,false,hover?3:4.5);return;}if(ref.kind==='vertex'&&geometryApi.hasVertex(o.solid,ref.vertexId)){const q=project(transformPoint(geometryApi.vertex(o.solid,ref.vertexId),o.transform));ctx.beginPath();ctx.arc(q[0],q[1],hover?5:6.5,0,Math.PI*2);ctx.fillStyle=hover?'rgba(255,255,255,.78)':'#fff';ctx.fill();ctx.strokeStyle=color;ctx.lineWidth=hover?2:3;ctx.stroke();}}
function drawOperationPreviewEdges(o:ModelObject,preview:Solid,color:string){const existing=new Set(geometryApi.edges(o.solid).map(e=>pushPreviewEdgeKey(e.a,e.b)));for(const e of geometryApi.edges(preview))if(!existing.has(pushPreviewEdgeKey(e.a,e.b)))path3([transformPoint(e.a,o.transform),transformPoint(e.b,o.transform)],color,true,1.8);}
function drawChamferHover(){
  if(!ctx||tool!=='chamfer')return;
  const draft=chamferEdgeSelection;
  if(draft&&chamferSelectionIsCurrent(draft)){
    const o=objects.find(v=>v.id===draft.objectId)!;
    if(draft.previewResult)drawOperationPreviewEdges(o,draft.previewResult.solid,'#b97723');
    for(const side of draft.sides)for(const id of side.halfEdgeIds){const e=geometryApi.edge(o.solid,id);path3([transformPoint(e.a,o.transform),transformPoint(e.b,o.transform)],draft.error?'#b74632':'#276a61',false,5);}
    return;
  }
  if(!chamferHover)return;const o=objects.find(v=>v.id===chamferHover!.objectId);if(!o)return;if(chamferHover.previewSolid)drawOperationPreviewEdges(o,chamferHover.previewSolid,'#b97723');for(const id of chamferHover.halfEdgeIds){if(!geometryApi.hasHalfEdge(o.solid,id))continue;const e=geometryApi.edge(o.solid,id);path3([transformPoint(e.a,o.transform),transformPoint(e.b,o.transform)],'rgba(213,140,46,.96)',false,5);}
}

function drawRoundedChamferHover(){if(!ctx||tool!=='roundchamfer')return;const draft=chamferEdgeSelection;if(draft&&chamferSelectionIsCurrent(draft)){const o=objects.find(v=>v.id===draft.objectId)!;for(const side of draft.sides)for(const id of side.halfEdgeIds){const e=geometryApi.edge(o.solid,id);path3([transformPoint(e.a,o.transform),transformPoint(e.b,o.transform)],'#276a61',false,5);}return;}if(!roundedChamferHover)return;const o=objects.find(v=>v.id===roundedChamferHover!.objectId);if(!o)return;for(const id of roundedChamferHover.halfEdgeIds){if(!geometryApi.hasHalfEdge(o.solid,id))continue;const e=geometryApi.edge(o.solid,id);path3([transformPoint(e.a,o.transform),transformPoint(e.b,o.transform)],'rgba(213,140,46,.96)',false,5);}}
function drawThreadHover(){if(!ctx||tool!=='thread'||!threadHover)return;const o=objects.find(v=>v.id===threadHover!.objectId);if(!o)return;for(const id of threadHover.halfEdgeIds){if(!geometryApi.hasHalfEdge(o.solid,id))continue;const e=geometryApi.edge(o.solid,id);path3([transformPoint(e.a,o.transform),transformPoint(e.b,o.transform)],'rgba(213,140,46,.96)',false,5);}}
function drawDeleteFeatureHover(){if(!ctx||tool!=='delete'||!deleteFeatureHover)return;const o=objects.find(v=>v.id===deleteFeatureHover!.objectId);if(!o)return;for(const id of deleteFeatureHover.candidate.rimHalfEdgeIds){if(!geometryApi.hasHalfEdge(o.solid,id))continue;const e=geometryApi.edge(o.solid,id);path3([transformPoint(e.a,o.transform),transformPoint(e.b,o.transform)],'rgba(213,140,46,.92)',false,5);}}
function drawEntitySelection(){if(pastePlacement)return;drawEntitySelectionRef(modelDocument.hover,true);drawEntitySelectionRef(modelDocument.selection,false);}
function drawOverlay(){if(!ctx)return;ctx.setTransform(dpr,0,0,dpr,0,0);ctx.clearRect(0,0,W,H);updateDebugStats();updateProfilerPanel();drawGuides();drawDimensions();drawTriangulation();drawBVH();drawPreviewSolidDebug();drawTopologyEdges();drawHalfEdges();drawLoops();drawFacesDebug();drawFacePlaneDebug();drawTopologyPoints();drawSketchPlaneDebug();drawPickingDebug();drawSnapCandidatesDebug();drawSurfaceTexturePreview();drawFaceTextPreview();drawCarveOpeningPreview();drawPrimitivePreview();drawSketchPreviewOverlay();drawGuidePreview();drawPushPreview();drawDeleteFeatureHover();drawChamferHover();drawRoundedChamferHover();drawThreadHover();drawEntitySelection();drawSketchStartSnap();drawMoveAnchor();drawMovePointPreview();drawRotatePlanePreview();drawMirrorPlanePreview();drawSketchEditorPlacement();drawSnap();drawObjectSelectionMarquee();if(measure.length===1&&measurePreview){path3([measure[0],measurePreview],'#276a61');const a=project(measure[0]),b=project(measurePreview);label(fmt(V.len(V.sub(measurePreview,measure[0])))+' mm',[(a[0]+b[0])/2,(a[1]+b[1])/2-14]);}}
const CAMERA_FIT_POLICY=Object.freeze({usableViewportFraction:.88,nearPlaneClearance:2,emptySceneDistance:30});
function fit(){
  const list=visibleObjects();
  if(!list.length){camera.target=[0,0,0];camera.distance=CAMERA_FIT_POLICY.emptySceneDistance;delete camera.orthographicEyeDistance;cameraBasis();requestRender();return;}
  cameraBasis();
  const meshes=list.map(o=>sceneGeometry.mesh(o)),bounds=sceneBounds(list),origin=V.mul(V.add(bounds.min,bounds.max),.5);
  const min:Vec3=[Infinity,Infinity,Infinity],max:Vec3=[-Infinity,-Infinity,-Infinity];
  // Fit the rendered model in camera space, rather than its world diagonal.
  // Center its oriented bounds so a rotated, slender object also fills the view.
  for(const mesh of meshes)for(const p of mesh.vertices){
    const delta=V.sub(p,origin),coordinates:Vec3=[V.dot(delta,basis.right),V.dot(delta,basis.up),V.dot(delta,basis.forward)];
    for(let i=0;i<3;i++){min[i]=Math.min(min[i],coordinates[i]);max[i]=Math.max(max[i],coordinates[i]);}
  }
  if(!Number.isFinite(min[0]))return;
  const center=V.mul(V.add(min,max),.5);
  camera.target=V.add(origin,V.add(V.mul(basis.right,center[0]),V.add(V.mul(basis.up,center[1]),V.mul(basis.forward,center[2]))));
  const availableY=CAMERA_FIT_POLICY.usableViewportFraction,availableX=availableY*W/H;
  const nearClearance=CAMERA_PROJECTION_POLICY.nearPlane*CAMERA_FIT_POLICY.nearPlaneClearance;
  let distance=CAMERA_NAVIGATION_POLICY.minimumDistance,eyeDistance=nearClearance;
  for(const mesh of meshes)for(const p of mesh.vertices){
    const delta=V.sub(p,camera.target),x=V.dot(delta,basis.right),y=V.dot(delta,basis.up),z=V.dot(delta,basis.forward);
    // Perspective depth is distance + z; each point must satisfy both screen
    // bounds and remain in front of the near plane. Orthographic scale ignores z.
    const projectedDistance=basis.focal*Math.max(Math.abs(x)/availableX,Math.abs(y)/availableY);
    distance=Math.max(distance,projectedDistance-(camera.orthographic?0:z),camera.orthographic?0:nearClearance-z);
    // Orthographic magnification and eye position are independent. Keep the
    // eye outside the model's bounding sphere even after orbiting; looking
    // along a long thin object must not force its on-screen size to shrink.
    eyeDistance=Math.max(eyeDistance,V.len(delta)+nearClearance);
  }
  camera.distance=distance;
  if(camera.orthographic)camera.orthographicEyeDistance=eyeDistance;else delete camera.orthographicEyeDistance;
  cameraBasis();requestRender();
}
function setView(name:string){camera.orthographic=name!=='iso';if(name==='top'){camera.yaw=-Math.PI/2;camera.pitch=Math.PI/2-.001;}else if(name==='front'){camera.yaw=-Math.PI/2;camera.pitch=.001;}else if(name==='right'){camera.yaw=0;camera.pitch=.001;}else{camera.orthographic=false;camera.yaw=-Math.PI/3;camera.pitch=Math.PI/5;}for(const b of qsa('[data-view]'))b.classList.toggle('active',b.dataset.view===(camera.orthographic?name:'iso'));requestRender();}
function resize(){const r=$('viewport').getBoundingClientRect();dpr=Math.min(2,devicePixelRatio||1);W=Math.max(1,r.width);H=Math.max(1,r.height);scene.width=Math.round(W*dpr);scene.height=Math.round(H*dpr);overlay.width=Math.round(W*dpr);overlay.height=Math.round(H*dpr);requestRender();}
new ResizeObserver(resize).observe($('viewport'));resize();
