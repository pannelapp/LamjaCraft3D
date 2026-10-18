// Disposable snap geometry. Callers treat returned arrays, points and references as read-only.
const CIRCLE_CENTER_SNAP_POLICY=Object.freeze({minimumVertices:8,relativeRadiusTolerance:2e-3});
function circularLoopCenter(points:Vec3[]):Vec3|null{
  if(points.length<CIRCLE_CENTER_SNAP_POLICY.minimumVertices)return null;
  const center=V.mul(points.reduce((a,p)=>V.add(a,p),[0,0,0] as Vec3),1/points.length),radii=points.map(p=>V.len(V.sub(p,center))),radius=radii.reduce((a,b)=>a+b,0)/radii.length;
  if(radius<TOL.minimumEdge)return null;const tolerance=Math.max(TOL.snapGeometry*8,radius*CIRCLE_CENTER_SNAP_POLICY.relativeRadiusTolerance);
  if(radii.some(r=>Math.abs(r-radius)>tolerance))return null;return center;
}
const circleCenterSnapCache=new WeakMap<Solid,Map<FaceId,Vec3[]>>();
function faceLocalCircleCenters(s:Solid,faceId:FaceId):Vec3[]{
  let byFace=circleCenterSnapCache.get(s);if(!byFace){byFace=new Map();circleCenterSnapCache.set(s,byFace);}const cached=byFace.get(faceId);if(cached)return cached;
  if(!geometryApi.hasFace(s,faceId)){byFace.set(faceId,[]);return [];}const loops=geometryApi.faceLoops(s,faceId),centers:Vec3[]=[];for(const loop of [loops.outer,...loops.holes]){const center=circularLoopCenter(loop);if(center)centers.push(center);}byFace.set(faceId,centers);return centers;
}

interface ObjectSnapGeometry {
  solid:Solid;
  objectId:ObjectId;
  transformKey:string;
  faceEdges:Map<FaceId,SnapEdge[]>;
  faceCenters:Map<FaceId,SnapPointCandidate[]>;
  edges?:SnapEdge[];
  centers?:SnapPointCandidate[];
}
const objectSnapGeometryCache=new WeakMap<ModelObject,ObjectSnapGeometry>();
const reusableSnapEdgeArrays=new WeakSet<SnapEdge[]>(),reusableSnapPointArrays=new WeakSet<SnapPointCandidate[]>();
function retainSnapEdges(edges:SnapEdge[]):SnapEdge[]{reusableSnapEdgeArrays.add(edges);return edges;}
function retainSnapPoints(points:SnapPointCandidate[]):SnapPointCandidate[]{reusableSnapPointArrays.add(points);return points;}
const emptySnapEdges:SnapEdge[]=[],emptySnapCenters:SnapPointCandidate[]=[];
function objectSnapGeometry(o:ModelObject):ObjectSnapGeometry {
  const transformKey=derivedTransformKey(o.transform),cached=objectSnapGeometryCache.get(o);
  if(cached&&cached.solid===o.solid&&cached.objectId===o.id&&cached.transformKey===transformKey)return cached;
  const record:ObjectSnapGeometry={solid:o.solid,objectId:o.id,transformKey,faceEdges:new Map(),faceCenters:new Map()};
  objectSnapGeometryCache.set(o,record);return record;
}
function faceSnapEdges(o:ModelObject,faceId:FaceId):SnapEdge[]{
  if(!isObjectVisible(o))return emptySnapEdges;
  const record=objectSnapGeometry(o),cached=record.faceEdges.get(faceId);if(cached)return cached;
  const edges=geometryApi.faceTopologyEdges(o.solid,faceId).map(e=>({a:transformPoint(e.a,o.transform),b:transformPoint(e.b,o.transform),source:{kind:'edge' as const,objectId:o.id,halfEdgeId:e.id}}));
  record.faceEdges.set(faceId,edges);return retainSnapEdges(edges);
}
function faceSnapCenters(o:ModelObject,faceId:FaceId):SnapPointCandidate[]{
  if(!isObjectVisible(o))return emptySnapCenters;
  return cachedFaceSnapCenters(o,objectSnapGeometry(o),faceId);
}
function cachedFaceSnapCenters(o:ModelObject,record:ObjectSnapGeometry,faceId:FaceId):SnapPointCandidate[]{
  const cached=record.faceCenters.get(faceId);if(cached)return cached;
  const local=faceLocalCircleCenters(o.solid,faceId);if(!local.length)return emptySnapCenters;
  const centers=local.map(p=>({point:transformPoint(p,o.transform),kind:'Center' as const,source:{kind:'circle-center' as const,objectId:o.id,faceId}}));
  record.faceCenters.set(faceId,centers);return retainSnapPoints(centers);
}
function objectWorldCenters(o:ModelObject):SnapPointCandidate[]{
  if(!isObjectVisible(o))return emptySnapCenters;
  const record=objectSnapGeometry(o);if(record.centers)return record.centers;
  const out:SnapPointCandidate[]=[];for(const f of o.solid.faces.values())for(const center of cachedFaceSnapCenters(o,record,f.id))out.push(center);
  record.centers=retainSnapPoints(out);return out;
}
function objectWorldSnapEdges(o:ModelObject):SnapEdge[]{
  const record=objectSnapGeometry(o);if(record.edges)return record.edges;
  record.edges=retainSnapEdges(geometryApi.edges(o.solid).map(e=>({a:transformPoint(e.a,o.transform),b:transformPoint(e.b,o.transform),source:{kind:'edge',objectId:o.id,halfEdgeId:e.halfEdgeId}})));return record.edges;
}
interface SceneSnapGeometry<T> {records:ObjectSnapGeometry[];items:T[];}
let sceneSnapEdges:SceneSnapGeometry<SnapEdge>|null=null,sceneSnapCenters:SceneSnapGeometry<SnapPointCandidate>|null=null;
function sameSnapRecords<T>(cached:SceneSnapGeometry<T>|null,records:ObjectSnapGeometry[]):boolean {
  return !!cached&&cached.records.length===records.length&&records.every((record,i)=>record===cached.records[i]);
}
function allWorldEdges():SnapEdge[]{
  const visible=visibleObjects(),records=visible.map(objectSnapGeometry);if(sameSnapRecords(sceneSnapEdges,records))return sceneSnapEdges!.items;
  const items:SnapEdge[]=[];for(const o of visible)for(const edge of objectWorldSnapEdges(o))items.push(edge);
  sceneSnapEdges={records,items};return retainSnapEdges(items);
}
function allWorldCenters():SnapPointCandidate[]{
  const visible=visibleObjects(),records=visible.map(objectSnapGeometry);if(sameSnapRecords(sceneSnapCenters,records))return sceneSnapCenters!.items;
  const items:SnapPointCandidate[]=[];for(const o of visible)for(const center of objectWorldCenters(o))items.push(center);
  sceneSnapCenters={records,items};return retainSnapPoints(items);
}
let groundSnapGeometryCache:{sourceEdges:SnapEdge[];sourceCenters:SnapPointCandidate[];edges:SnapEdge[];centers:SnapPointCandidate[]}|null=null;
function groundSnapGeometry():{edges:SnapEdge[];centers:SnapPointCandidate[]} {
  const sourceEdges=allWorldEdges(),sourceCenters=allWorldCenters(),cached=groundSnapGeometryCache;
  if(cached?.sourceEdges===sourceEdges&&cached.sourceCenters===sourceCenters)return cached;
  const edges=sourceEdges.filter(e=>Math.abs(e.a[2])<TOL.snapGeometry&&Math.abs(e.b[2])<TOL.snapGeometry),centers=sourceCenters.filter(c=>Math.abs(c.point[2])<TOL.snapGeometry);
  groundSnapGeometryCache={sourceEdges,sourceCenters,edges:retainSnapEdges(edges),centers:retainSnapPoints(centers)};return groundSnapGeometryCache;
}

