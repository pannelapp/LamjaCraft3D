interface SceneGeometryCacheRecord extends MeshCacheEntry {
  solidRef: Solid;
  historyVersion?:HistorySolidVersion;
  transformKey: string;
  exportMesh?: Mesh;
}

// Bound retained derived work, not bytes: mesh/BVH layouts vary by geometry.
const SCENE_HISTORY_POLICY=Object.freeze({maximumTriangles:1_500_000,maximumEntries:2_000,maximumTransformsPerVersion:2});
interface SceneHistoryGeometry {mesh:Mesh;bounds:Bounds3;bvh:BVHNode|null;transformKey:string;exportMesh?:Mesh;}
function createSceneHistoryCache(policy:typeof SCENE_HISTORY_POLICY=SCENE_HISTORY_POLICY){
  interface Slot {entries:Record0[];}
  interface Record0 {scene:SceneHistoryGeometry;slot:Slot;triangles:number;}
  const versions=new WeakMap<HistorySolidVersion,Slot>(),lru=new Set<Record0>();let triangles=0;
  const remove=(record:Record0)=>{if(!lru.delete(record))return;triangles-=record.triangles;record.slot.entries.splice(record.slot.entries.indexOf(record),1);};
  const touch=(record:Record0)=>{lru.delete(record);lru.add(record);};
  return {
    remember(version:HistorySolidVersion,scene:SceneHistoryGeometry):void {
      let slot=versions.get(version);if(!slot){slot={entries:[]};versions.set(version,slot);}
      const old=slot.entries.find(e=>e.scene.transformKey===scene.transformKey);if(old)remove(old);
      const count=scene.mesh.triangles.length+(scene.exportMesh?.triangles.length||0);if(count>policy.maximumTriangles)return;
      // Deliberately omit live solids and version handles from retained records.
      const record:Record0={slot,triangles:count,scene:{mesh:scene.mesh,bounds:scene.bounds,bvh:scene.bvh,transformKey:scene.transformKey,exportMesh:scene.exportMesh}};
      slot.entries.push(record);lru.add(record);triangles+=count;
      while(slot.entries.length>policy.maximumTransformsPerVersion)remove(slot.entries[0]);
      while(triangles>policy.maximumTriangles||lru.size>policy.maximumEntries)remove(lru.values().next().value!);
    },
    get(version:HistorySolidVersion,transformKey:string):SceneHistoryGeometry|null {const record=versions.get(version)?.entries.find(e=>e.scene.transformKey===transformKey);if(!record)return null;touch(record);return record.scene;},
    stats(){return {entries:lru.size,triangles};},
  };
}

function derivedSolidTopologyCounts(s:Solid):SolidTopologyCounts {
  let edges=0,openEdges=0,holes=0;
  for(const he of s.halfEdges.values()){if(!he.twin)openEdges++;if(!he.twin||he.id<he.twin)edges++;}
  for(const loop of s.loops.values())if(loop.kind==='hole')holes++;
  return {vertices:s.vertices.size,halfEdges:s.halfEdges.size,edges,loops:s.loops.size,faces:s.faces.size,holes,openEdges};
}

function derivedMeshBounds(m:Mesh):Bounds3 {
  const min:[number,number,number]=[Infinity,Infinity,Infinity],max:[number,number,number]=[-Infinity,-Infinity,-Infinity];
  if(!m.vertices.length)return {min:[0,0,0],max:[0,0,0]};
  for(const p of m.vertices)for(let i=0;i<3;i++){
    min[i]=Math.min(min[i],p[i]);
    max[i]=Math.max(max[i],p[i]);
  }
  return {min,max};
}

function derivedTransformKey(t:Transform):string {
  return `${t.position[0]}|${t.position[1]}|${t.position[2]}|${t.rotation[0]}|${t.rotation[1]}|${t.rotation[2]}`;
}

function derivedRayBoundsDistance(r:Ray3,bounds:Bounds3,limit=Infinity):number {
  let tmin=0,tmax=limit;
  for(let i=0;i<3;i++){
    const o=r.origin[i],d=r.dir[i];
    if(Math.abs(d)<1e-12){if(o<bounds.min[i]||o>bounds.max[i])return Infinity;continue;}
    let a=(bounds.min[i]-o)/d,b=(bounds.max[i]-o)/d;
    if(a>b)[a,b]=[b,a];
    tmin=Math.max(tmin,a);tmax=Math.min(tmax,b);
    if(tmin>tmax)return Infinity;
  }
  return tmin;
}

function derivedTriangleRayDistance(r:Ray3,a:Vec3,b:Vec3,c:Vec3):number {
  const e1=V.sub(b,a),e2=V.sub(c,a),h=V.cross(r.dir,e2),det=V.dot(e1,h);
  if(Math.abs(det)<1e-10)return Infinity;
  const inv=1/det,s=V.sub(r.origin,a),u=inv*V.dot(s,h);
  if(u<0||u>1)return Infinity;
  const q=V.cross(s,e1),v=inv*V.dot(r.dir,q);
  if(v<0||u+v>1)return Infinity;
  const t=inv*V.dot(e2,q);
  return t>1e-7?t:Infinity;
}

function derivedBuildBVH(m:Mesh):BVHNode|null {
  if(!m.triangles.length)return null;
  const triBounds=m.triangles.map((t,i)=>{
    const ps=t.map(j=>m.vertices[j]);
    const min:[number,number,number]=[Infinity,Infinity,Infinity],max:[number,number,number]=[-Infinity,-Infinity,-Infinity];
    for(const p of ps)for(let k=0;k<3;k++){min[k]=Math.min(min[k],p[k]);max[k]=Math.max(max[k],p[k]);}
    return {i,min,max,center:V.mul(V.add(min,max),.5)};
  });
  const build=(items:typeof triBounds):BVHNode=>{
    const min:[number,number,number]=[Infinity,Infinity,Infinity],max:[number,number,number]=[-Infinity,-Infinity,-Infinity];
    for(const it of items)for(let k=0;k<3;k++){min[k]=Math.min(min[k],it.min[k]);max[k]=Math.max(max[k],it.max[k]);}
    if(items.length<=12)return {min,max,triangles:items.map(x=>x.i)};
    const ext=V.sub(max,min),axis=ext.indexOf(Math.max(...ext));
    items.sort((a,b)=>a.center[axis]-b.center[axis]);
    const mid=Math.floor(items.length/2);
    return {min,max,left:build(items.slice(0,mid)),right:build(items.slice(mid))};
  };
  return build(triBounds);
}

// Ignore only depth uncertainty at a surface, never an entire source object.
const SNAP_VISIBILITY_POLICY=Object.freeze({surfaceTolerance:TOL.snapGeometry,relativeDepthTolerance:1e-8});
const sceneGeometry:SceneGeometryService=(()=>{
  const cache=new Map<ObjectId,SceneGeometryCacheRecord>(),historyCache=createSceneHistoryCache();
  const appearanceCache=new WeakMap<Mesh,SceneAppearance>();
  const topologyCache=new WeakMap<Solid,SolidTopologyCounts>();
  const bvhCountCache=new WeakMap<BVHNode,number>();
  const countBvhNodes=(root:BVHNode|null):number=>{
    if(!root)return 0;const cached=bvhCountCache.get(root);if(cached!==undefined)return cached;
    let count=0;const stack=[root];while(stack.length){const n=stack.pop()!;count++;if(n.left)stack.push(n.left);if(n.right)stack.push(n.right);}
    bvhCountCache.set(root,count);return count;
  };
  const previewCache=new WeakMap<Solid,{transformKey:string;mesh:Mesh;bvh?:BVHNode|null}>();

  const rebuild=(o:ModelObject):SceneGeometryCacheRecord=>{
    const mesh=profiler.measure('scene','Scene mesh derive',()=>solidMeshWorld(o),{objectId:o.id,faces:o.solid.faces.size}),record:SceneGeometryCacheRecord={mesh,bounds:profiler.measure('scene','Mesh bounds',()=>derivedMeshBounds(mesh),{vertices:mesh.vertices.length}),bvh:null,solidRef:o.solid,transformKey:derivedTransformKey(o.transform)};
    cache.set(o.id,record);
    return record;
  };

  const entry=(o:ModelObject):SceneGeometryCacheRecord=>{
    const key=derivedTransformKey(o.transform),cached=cache.get(o.id);
    if(!cached||cached.solidRef!==o.solid||cached.transformKey!==key)return rebuild(o);
    return cached;
  };

  const bvh=(o:ModelObject):BVHNode|null=>{
    const e=entry(o);
    return e.bvh||(e.bvh=profiler.measure('scene','BVH build',()=>derivedBuildBVH(e.mesh),{triangles:e.mesh.triangles.length}));
  };

  const previewMesh=(o:ModelObject,solid:Solid):Mesh=>{const transformKey=derivedTransformKey(o.transform),cached=previewCache.get(solid);if(cached&&cached.transformKey===transformKey)return cached.mesh;const mesh=profiler.measure('scene','Live preview mesh',()=>solidMeshWorld({...o,solid}),{objectId:o.id,faces:solid.faces.size});previewCache.set(solid,{transformKey,mesh});return mesh;};

  const exportMesh=(o:ModelObject):Mesh=>{const e=entry(o);return e.exportMesh||(e.exportMesh=solidMeshExportWorld(o));};

  const pick=(list:readonly ModelObject[],r:Ray3):HitResult|null=>profiler.measure('scene','BVH picking',()=>{
    let bestT=Infinity,best:HitResult|null=null;
    for(const o of list){
      if(o.hidden===true)continue;
      const e=entry(o);
      if(derivedRayBoundsDistance(r,e.bounds,bestT)===Infinity)continue;
      const root=bvh(o);if(!root)continue;
      const stack=[root];
      while(stack.length){
        const node=stack.pop()!;
        if(derivedRayBoundsDistance(r,node,bestT)===Infinity)continue;
        if(node.triangles){
          for(const ti of node.triangles){
            const ids=e.mesh.triangles[ti],t=derivedTriangleRayDistance(r,e.mesh.vertices[ids[0]],e.mesh.vertices[ids[1]],e.mesh.vertices[ids[2]]);
            if(t<bestT){
              bestT=t;
              const p=V.add(r.origin,V.mul(r.dir,t));
              best={id:o.id,face:e.mesh.face[ti],point:p,localPoint:inverseTransformPoint(p,o.transform),t};
            }
          }
        }else{
          if(node.left)stack.push(node.left);
          if(node.right)stack.push(node.right);
        }
      }
    }
    return best;
  },{objects:list.length});

  const pointVisible=(list:readonly ModelObject[],r:Ray3,point:Vec3,preview?:(o:ModelObject)=>Solid|null):boolean=>{
    const distance=V.dot(V.sub(point,r.origin),r.dir),limit=distance-Math.max(SNAP_VISIBILITY_POLICY.surfaceTolerance,Math.abs(distance)*SNAP_VISIBILITY_POLICY.relativeDepthTolerance);
    if(distance<0)return false;
    for(const o of list){
      if(o.hidden===true)continue;
      const solid=preview?.(o);let mesh:Mesh,root:BVHNode|null;
      if(solid){mesh=previewMesh(o,solid);const record=previewCache.get(solid)!;root=record.bvh===undefined?(record.bvh=derivedBuildBVH(mesh)):record.bvh;}
      else {const e=entry(o);if(derivedRayBoundsDistance(r,e.bounds,limit)===Infinity)continue;mesh=e.mesh;root=bvh(o);}
      if(!root)continue;
      const stack=[root];while(stack.length){const node=stack.pop()!;if(derivedRayBoundsDistance(r,node,limit)===Infinity)continue;
        if(node.triangles){for(const ti of node.triangles){const ids=mesh.triangles[ti];if(derivedTriangleRayDistance(r,mesh.vertices[ids[0]],mesh.vertices[ids[1]],mesh.vertices[ids[2]])<limit)return false;}}
        else {if(node.left)stack.push(node.left);if(node.right)stack.push(node.right);}
      }
    }
    return true;
  };

  const sceneBounds=(list:readonly ModelObject[]):Bounds3=>{
    if(!list.length)return {min:[-20,-20,0],max:[20,20,30]};
    const min:[number,number,number]=[Infinity,Infinity,Infinity],max:[number,number,number]=[-Infinity,-Infinity,-Infinity];
    for(const o of list){const b=entry(o).bounds;for(let i=0;i<3;i++){min[i]=Math.min(min[i],b.min[i]);max[i]=Math.max(max[i],b.max[i]);}}
    return {min,max};
  };

  const bvhNodeCount=(list:readonly ModelObject[],buildMissing=false):number=>list.reduce((count,o)=>count+countBvhNodes(buildMissing?bvh(o):entry(o).bvh),0);
  const topologyStats=(list:readonly ModelObject[],buildMissingBvh=false):SceneTopologyStats=>{
    const total:SceneTopologyStats={vertices:0,halfEdges:0,edges:0,loops:0,faces:0,holes:0,openEdges:0,triangles:0,bvhNodes:0};
    for(const o of list){
      if(o.hidden===true)continue;
      let counts=topologyCache.get(o.solid);if(!counts){counts=derivedSolidTopologyCounts(o.solid);topologyCache.set(o.solid,counts);}
      total.vertices+=counts.vertices;total.halfEdges+=counts.halfEdges;total.edges+=counts.edges;total.loops+=counts.loops;total.faces+=counts.faces;total.holes+=counts.holes;total.openEdges+=counts.openEdges;
      const e=entry(o);total.triangles+=e.mesh.triangles.length;total.bvhNodes+=countBvhNodes(buildMissingBvh?bvh(o):e.bvh);
    }
    return total;
  };

  return {
    installLocalMesh(o,local){const mesh:Mesh={...local,vertices:local.vertices.map(p=>transformPoint(p,o.transform))};cache.set(o.id,{mesh,bounds:derivedMeshBounds(mesh),bvh:null,solidRef:o.solid,transformKey:derivedTransformKey(o.transform)});},
    rememberHistory(o,version){const record=cache.get(o.id);if(!record||record.solidRef!==o.solid||record.transformKey!==derivedTransformKey(o.transform)||record.historyVersion&&record.historyVersion!==version)return;record.historyVersion=version;historyCache.remember(version,record);},
    reuseHistory(o,version){const record=historyCache.get(version,derivedTransformKey(o.transform));if(!record)return false;cache.set(o.id,{...record,solidRef:o.solid,historyVersion:version});return true;},
    install(o,mesh,bounds,appearance){cache.set(o.id,{mesh,bounds,bvh:null,solidRef:o.solid,transformKey:derivedTransformKey(o.transform)});appearanceCache.set(mesh,appearance);},
    appearance(mesh){let result=appearanceCache.get(mesh);if(!result){result=deriveSceneAppearance(mesh);appearanceCache.set(mesh,result);}return result;},
    mesh:o=>entry(o).mesh,
    previewMesh,
    exportMesh,
    entry:o=>entry(o),
    bvh:o=>bvh(o),
    pick,
    pointVisible,
    sceneBounds,
    triangleCount:list=>list.reduce((n,o)=>n+entry(o).mesh.triangles.length,0),
    bvhNodeCount,
    topologyStats,
    invalidateObject(id){cache.delete(id);},
    invalidateAll(){cache.clear();},
    buildRequest(o){return {kind:'derive-object',objectId:o.id,solid:serializeSolid(o.solid),transform:{position:[...o.transform.position] as Vec3,rotation:[...o.transform.rotation] as Vec3}};},
    buildResult(o,includeBvh=false){const e=entry(o);return {kind:'derived-object',objectId:o.id,mesh:e.mesh,bounds:e.bounds,bvh:includeBvh?bvh(o):e.bvh};}
  };
})();
