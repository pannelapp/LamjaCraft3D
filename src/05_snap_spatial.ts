// Broad-phase only: immutable input snapshots, original input order, exact
// downstream candidate math. World-space bounds survive camera changes.
const SNAP_SPATIAL_POLICY=Object.freeze({minimumItems:256,leafItems:16,roundoffFactor:64,screenPaddingPx:1e-6,minimumMembershipPoints:64,membershipNeighborCells:2,maximumBucketCoordinate:Number.MAX_SAFE_INTEGER/8});
interface SnapSpatialNode {min:Vec3;max:Vec3;start:number;end:number;left?:SnapSpatialNode;right?:SnapSpatialNode;}
interface SnapSpatialIndex {order:Uint32Array;root:SnapSpatialNode|null;fallback:number[];}
const snapEdgeSpatialCache=new WeakMap<SnapEdge[],SnapSpatialIndex>(),snapPointSpatialCache=new WeakMap<SnapPointCandidate[],SnapSpatialIndex>();
function buildSnapSpatialIndex(count:number,boundsAt:(i:number)=>{min:Vec3;max:Vec3}):SnapSpatialIndex {
  const bounds=new Float64Array(count*6),valid:number[]=[],fallback:number[]=[];
  for(let i=0;i<count;i++){
    const b=boundsAt(i);if(![...b.min,...b.max].every(Number.isFinite)){fallback.push(i);continue;}
    valid.push(i);for(let axis=0;axis<3;axis++){bounds[i*6+axis]=b.min[axis];bounds[i*6+3+axis]=b.max[axis];}
  }
  const order=Uint32Array.from(valid),center=(id:number,axis:number)=>bounds[id*6+axis]/2+bounds[id*6+3+axis]/2;
  const select=(start:number,end:number,middle:number,axis:number)=>{
    let lo=start,hi=end-1;
    while(lo<hi){
      const pivot=center(order[Math.floor((lo+hi)/2)],axis);let i=lo,j=hi;
      while(i<=j){while(center(order[i],axis)<pivot)i++;while(center(order[j],axis)>pivot)j--;if(i<=j){const temp=order[i];order[i]=order[j];order[j]=temp;i++;j--;}}
      if(middle<=j)hi=j;else if(middle>=i)lo=i;else return;
    }
  };
  const build=(start:number,end:number):SnapSpatialNode=>{
    const min:Vec3=[Infinity,Infinity,Infinity],max:Vec3=[-Infinity,-Infinity,-Infinity];
    for(let i=start;i<end;i++)for(let axis=0;axis<3;axis++){min[axis]=Math.min(min[axis],bounds[order[i]*6+axis]);max[axis]=Math.max(max[axis],bounds[order[i]*6+3+axis]);}
    const node:SnapSpatialNode={min,max,start,end};if(end-start<=SNAP_SPATIAL_POLICY.leafItems)return node;
    let axis=0;for(let i=1;i<3;i++)if(max[i]-min[i]>max[axis]-min[axis])axis=i;
    const middle=Math.floor((start+end)/2);select(start,end,middle,axis);node.left=build(start,middle);node.right=build(middle,end);return node;
  };
  return {order,root:order.length?build(0,order.length):null,fallback};
}
function snapSpatialNodeNear(node:SnapSpatialNode,q:SnapQuery,radius:number):boolean {
  let minX=Infinity,minY=Infinity,maxX=-Infinity,maxY=-Infinity,minDepth=Infinity,maxDepth=-Infinity;
  const scale=Math.max(1,...node.min.map(Math.abs),...node.max.map(Math.abs)),pad=scale*Number.EPSILON*SNAP_SPATIAL_POLICY.roundoffFactor;
  for(let corner=0;corner<8;corner++){
    const p:Vec3=[(corner&1)?node.max[0]+pad:node.min[0]-pad,(corner&2)?node.max[1]+pad:node.min[1]-pad,(corner&4)?node.max[2]+pad:node.min[2]-pad],s=q.project(p);
    // Unbounded/invalid projection or a perspective pole must fail open.
    if(!s.every(Number.isFinite))return true;
    minX=Math.min(minX,s[0]);maxX=Math.max(maxX,s[0]);minY=Math.min(minY,s[1]);maxY=Math.max(maxY,s[1]);minDepth=Math.min(minDepth,s[2]);maxDepth=Math.max(maxDepth,s[2]);
  }
  if(q.spatial?.projection==='perspective'&&minDepth<=0&&maxDepth>=0)return true;
  const screenPad=SNAP_SPATIAL_POLICY.screenPaddingPx+Math.max(Math.abs(minX),Math.abs(maxX),Math.abs(minY),Math.abs(maxY))*Number.EPSILON*SNAP_SPATIAL_POLICY.roundoffFactor;
  return !(maxX<q.x-radius-screenPad||minX>q.x+radius+screenPad||maxY<q.y-radius-screenPad||minY>q.y+radius+screenPad);
}
function querySnapSpatialIndex(index:SnapSpatialIndex,q:SnapQuery,radius:number):number[]{
  const out=[...index.fallback],visit=(node:SnapSpatialNode)=>{
    if(!snapSpatialNodeNear(node,q,radius))return;
    if(node.left&&node.right){visit(node.left);visit(node.right);return;}
    for(let i=node.start;i<node.end;i++)out.push(index.order[i]);
  };
  if(index.root)visit(index.root);return out.sort((a,b)=>a-b);
}
function snapSpatialEdgeIndices(q:SnapQuery,radius:number):number[]|null {
  if(!q.spatial?.edges||q.edges.length<SNAP_SPATIAL_POLICY.minimumItems||![q.x,q.y,radius].every(Number.isFinite)||radius<0)return null;
  let index=snapEdgeSpatialCache.get(q.edges);
  if(!index){index=buildSnapSpatialIndex(q.edges.length,i=>{const e=q.edges[i];return {min:[Math.min(e.a[0],e.b[0]),Math.min(e.a[1],e.b[1]),Math.min(e.a[2],e.b[2])],max:[Math.max(e.a[0],e.b[0]),Math.max(e.a[1],e.b[1]),Math.max(e.a[2],e.b[2])]};});snapEdgeSpatialCache.set(q.edges,index);}
  return querySnapSpatialIndex(index,q,radius);
}
function snapSpatialPointIndices(q:SnapQuery,radius:number):number[]|null {
  const points=q.points;if(!q.spatial?.points||!points||points.length<SNAP_SPATIAL_POLICY.minimumItems||![q.x,q.y,radius].every(Number.isFinite)||radius<0)return null;
  let index=snapPointSpatialCache.get(points);if(!index){index=buildSnapSpatialIndex(points.length,i=>({min:points[i].point,max:points[i].point}));snapPointSpatialCache.set(points,index);}
  return querySnapSpatialIndex(index,q,radius);
}
function snapPointMembership(points:Vec3[],tolerance:number):(world:Vec3)=>boolean {
  const linear=(world:Vec3)=>points.some(point=>V.len(V.sub(point,world))<=tolerance);
  if(points.length<SNAP_SPATIAL_POLICY.minimumMembershipPoints||!Number.isFinite(tolerance)||tolerance<=0)return linear;
  const buckets=new Map<string,Vec3[]>(),fallback:Vec3[]=[],min:Vec3=[Infinity,Infinity,Infinity],max:Vec3=[-Infinity,-Infinity,-Infinity];
  const cell=(p:Vec3):Vec3|null=>{
    const c=p.map(v=>Math.floor(v/tolerance)) as Vec3;
    return c.every(v=>Number.isFinite(v)&&Math.abs(v)<=SNAP_SPATIAL_POLICY.maximumBucketCoordinate)?c:null;
  };
  const key=(x:number,y:number,z:number)=>`${x}|${y}|${z}`;
  for(const point of points){if(point.every(Number.isFinite))for(let i=0;i<3;i++){min[i]=Math.min(min[i],point[i]);max[i]=Math.max(max[i],point[i]);}const c=cell(point);if(!c){fallback.push(point);continue;}const k=key(...c),list=buckets.get(k);if(list)list.push(point);else buckets.set(k,[point]);}
  return world=>{
    const c=cell(world);if(!c)return linear(world);
    for(let i=0;i<3;i++){
      const pad=tolerance+Math.max(1,Math.abs(min[i]),Math.abs(max[i]),Math.abs(world[i]))*Number.EPSILON*SNAP_SPATIAL_POLICY.roundoffFactor;
      if(world[i]<min[i]-pad||world[i]>max[i]+pad)return false;
    }
    const matches=(list:Vec3[]|undefined)=>!!list?.some(point=>V.len(V.sub(point,world))<=tolerance);
    if(matches(fallback)||matches(buckets.get(key(...c))))return true;
    // Two neighbor cells conservatively cover tolerance-boundary division
    // roundoff; unsafe large bucket coordinates use the exact linear path.
    const n=SNAP_SPATIAL_POLICY.membershipNeighborCells;
    for(let x=-n;x<=n;x++)for(let y=-n;y<=n;y++)for(let z=-n;z<=n;z++)if((x||y||z)&&matches(buckets.get(key(c[0]+x,c[1]+y,c[2]+z))))return true;
    return false;
  };
}
