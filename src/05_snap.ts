// Central snap candidate collection/ranking. The engine knows nothing about DOM,
// tools or B-rep internals: callers provide model edges, construction guides,
// the active drawing plane and a world->screen projector.

function gridSnapValue(value:number,enabled:boolean,step:number):number{const spacing=Number.isFinite(step)&&step>0?step:1;return enabled?Math.round(value/spacing)*spacing:clean(value);}

function pointPlaneDistance(p:Vec3,plane:SnapPlane):number{return Math.abs(V.dot(V.sub(p,plane.point),V.unit(plane.normal)));}
function pointOnSnapPlane(p:Vec3,plane?:SnapPlane,eps=TOL.snapGeometry*4):boolean{return !plane||pointPlaneDistance(p,plane)<=eps;}
function nearestPointOnLine(p:Vec3,origin:Vec3,dir:Vec3):Vec3{const d=V.unit(dir);return V.add(origin,V.mul(d,V.dot(V.sub(p,origin),d)));}
function linePlaneIntersection(origin:Vec3,dir:Vec3,plane:SnapPlane):Vec3|null{const d=V.unit(dir),n=V.unit(plane.normal),den=V.dot(d,n);if(Math.abs(den)<1e-10)return null;return V.add(origin,V.mul(d,V.dot(V.sub(plane.point,origin),n)/den));}
function guideLineInPlane(g:GuideLine,plane?:SnapPlane):boolean{if(!plane)return true;return pointOnSnapPlane(g.point,plane)&&Math.abs(V.dot(V.unit(g.direction),V.unit(plane.normal)))<=1e-7;}
function guideCircleInPlane(g:GuideCircle,plane?:SnapPlane):boolean{if(!plane)return true;return pointOnSnapPlane(g.center,plane)&&Math.abs(Math.abs(V.dot(V.unit(g.normal),V.unit(plane.normal)))-1)<=1e-7;}
function guideCircleBasis(normal0:Vec3):{u:Vec3;v:Vec3}{const n=V.unit(normal0),ref=Math.abs(n[2])<.9?([0,0,1] as Vec3):([0,1,0] as Vec3),u=V.unit(V.cross(ref,n)),v=V.unit(V.cross(n,u));return {u,v};}
function nearestPointOnGuideCircle(p:Vec3,g:GuideCircle):Vec3{const n=V.unit(g.normal),projected=V.sub(p,V.mul(n,V.dot(V.sub(p,g.center),n))),radial=V.sub(projected,g.center);if(V.len(radial)<1e-9){const {u}=guideCircleBasis(n);return V.add(g.center,V.mul(u,g.radius));}return V.add(g.center,V.mul(V.unit(radial),g.radius));}
function closestPointsOnLines(a0:Vec3,ad0:Vec3,b0:Vec3,bd0:Vec3):{a:Vec3;b:Vec3;distance:number}|null{
  const ad=V.unit(ad0),bd=V.unit(bd0),w0=V.sub(a0,b0),aa=V.dot(ad,ad),bb=V.dot(ad,bd),cc=V.dot(bd,bd),dd=V.dot(ad,w0),ee=V.dot(bd,w0),den=aa*cc-bb*bb;
  if(Math.abs(den)<1e-10)return null;
  const s=(bb*ee-cc*dd)/den,t=(aa*ee-bb*dd)/den,a=V.add(a0,V.mul(ad,s)),b=V.add(b0,V.mul(bd,t));return {a,b,distance:V.len(V.sub(a,b))};
}
interface GuideEdgeIntersection{world:Vec3;guideT:number;edgeT:number;}
function guideEdgeIntersection(g:GuideLine,e:SnapEdge,tolerance=TOL.snapGeometry*8):GuideEdgeIntersection|null{
  const gd=V.unit(g.direction),ed=V.sub(e.b,e.a),el2=V.dot(ed,ed);if(V.len(gd)<1e-10||el2<TOL.minimumEdge*TOL.minimumEdge)return null;
  const w0=V.sub(g.point,e.a),aa=V.dot(gd,gd),bb=V.dot(gd,ed),cc=el2,dd=V.dot(gd,w0),ee=V.dot(ed,w0),den=aa*cc-bb*bb;if(Math.abs(den)<1e-12)return null;
  const gt=(bb*ee-cc*dd)/den,et=(aa*ee-bb*dd)/den;if(et<-1e-7||et>1+1e-7)return null;
  const a=V.add(g.point,V.mul(gd,gt)),b=V.add(e.a,V.mul(ed,clamp(et,0,1)));if(V.len(V.sub(a,b))>tolerance)return null;
  return {world:V.mul(V.add(a,b),.5),guideT:gt,edgeT:clamp(et,0,1)};
}
function snapKindBias(kind:SnapKind):number{switch(kind){case'Corner':return 4;case'Intersection':return 3.8;case'Center':return 3.6;case'Guide point':return 3.2;case'Midpoint':return 2;case'On guide line':case'On guide circle':return .8;case'Parallel':case'Perpendicular':return -.45;case'On line':return -.3;default:return 0;}}
function canonicalDirectionKey(d0:Vec3):string{let d=V.unit(d0);if(V.len(d)<1e-9)return '';const first=Math.abs(d[0])>1e-8?d[0]:Math.abs(d[1])>1e-8?d[1]:d[2];if(first<0)d=V.mul(d,-1);return d.map(v=>Math.round(v*1e6)).join(',');}
function uniqueInferenceDirections(list:Vec3[],plane?:SnapPlane):Vec3[]{const out:Vec3[]=[],seen=new Set<string>(),n=plane?V.unit(plane.normal):null;for(const d0 of list){let d=V.unit(d0);if(V.len(d)<1e-9)continue;if(n){d=V.sub(d,V.mul(n,V.dot(d,n)));if(V.len(d)<1e-8)continue;d=V.unit(d);}const k=canonicalDirectionKey(d);if(!k||seen.has(k))continue;seen.add(k);out.push(d);if(out.length>=24)break;}return out;}
function collectSnapCandidates(q:SnapQuery):SnapResult[]{
  const radius=q.radiusPx*1.75,out:SnapResult[]=[],seen=new Set<string>();
  const add=(world:Vec3,kind:SnapKind,source?:SnapResult['source'])=>{if(!pointOnSnapPlane(world,q.plane))return;const s=q.project(world),d=Math.hypot(s[0]-q.x,s[1]-q.y);if(d>radius)return;if(q.acceptCandidate&&!q.acceptCandidate(world,kind,source))return;const key=kind+'|'+world.map(v=>Math.round(v/TOL.snapGeometry)).join(',');if(seen.has(key))return;seen.add(key);out.push({point:[0,0],world:[...world] as Vec3,kind,distance:d,source});};
  if(q.geometryEnabled){
    const points=q.points||[],pointIndices=snapSpatialPointIndices(q,radius),edgeIndices=snapSpatialEdgeIndices(q,radius);
    const addPoint=(p:SnapPointCandidate)=>add(p.point,p.kind,p.source);
    if(pointIndices)for(const i of pointIndices)addPoint(points[i]);else for(const p of points)addPoint(p);
    const addEdge=(e:SnapEdge)=>{if(q.acceptEdge&&!q.acceptEdge(e))return;add(e.a,'Corner',e.source);add(e.b,'Corner',e.source);add(V.mul(V.add(e.a,e.b),.5),'Midpoint',e.source);const ab=V.sub(e.b,e.a),l2=V.dot(ab,ab);if(l2>1e-12){const t=clamp(V.dot(V.sub(q.rawWorld,e.a),ab)/l2,0,1);add(V.add(e.a,V.mul(ab,t)),'On edge',e.source);}};
    if(edgeIndices)for(const i of edgeIndices)addEdge(q.edges[i]);else for(const e of q.edges)addEdge(e);
  }
  if(q.guideEnabled){
    const lines=q.guides.filter((g):g is GuideLine=>g.kind==='line');
    for(const g of q.guides){
      if(g.kind==='point')add(g.point,'Guide point',{kind:'guide',guideId:g.id});
      else if(g.kind==='line'){
        if(guideLineInPlane(g,q.plane))add(nearestPointOnLine(q.rawWorld,g.point,g.direction),'On guide line',{kind:'guide',guideId:g.id});
        else if(q.plane){const ip=linePlaneIntersection(g.point,g.direction,q.plane);if(ip)add(ip,'Intersection',{kind:'guide',guideId:g.id});}
      } else if(g.kind==='circle'){
        if(guideCircleInPlane(g,q.plane)){add(g.center,'Center',{kind:'guide',guideId:g.id});add(nearestPointOnGuideCircle(q.rawWorld,g),'On guide circle',{kind:'guide',guideId:g.id});}
      } else if(g.surface){
        for(const point of splitSurfaceWorldPoints(g.surface,{origin:g.origin,normal:g.normal,axis:g.axis||planeBasis({normal:g.normal,offset:V.dot(g.normal,g.origin)},g.origin).u}))add(point,'Guide point',{kind:'guide',guideId:g.id});
      } else if(q.plane){
        // Intersection of a guide plane and active sketch plane is itself a guide line.
        const n1=V.unit(g.normal),n2=V.unit(q.plane.normal),dir=V.cross(n1,n2);if(V.len(dir)>1e-8){
          // Find one point on both planes using the closed-form two-plane intersection.
          const d1=V.dot(n1,g.origin),d2=V.dot(n2,q.plane.point),d=V.dot(dir,dir),p=V.mul(V.add(V.mul(V.cross(n2,dir),d1),V.mul(V.cross(dir,n1),d2)),1/d);
          add(nearestPointOnLine(q.rawWorld,p,dir),'On guide line',{kind:'guide',guideId:g.id});
        }
      }
    }
    for(let i=0;i<lines.length;i++)for(let j=i+1;j<lines.length;j++){
      const a=lines[i],b=lines[j];if(q.plane&&(!guideLineInPlane(a,q.plane)||!guideLineInPlane(b,q.plane)))continue;const cp=closestPointsOnLines(a.point,a.direction,b.point,b.direction);if(cp&&cp.distance<=TOL.snapGeometry*8)add(V.mul(V.add(cp.a,cp.b),.5),'Intersection',{kind:'guide-intersection',guideIds:[a.id,b.id]});
    }
    if(q.geometryEnabled&&q.edges.length){
      // Guide/edge crossings are first-class endpoints. For an in-plane guide,
      // successive edge crossings also bound finite guide spans; expose the
      // midpoint of each such span without storing any extra guide metadata.
      for(const g of lines){
        if(q.plane&&!guideLineInPlane(g,q.plane))continue;
        const hits:{world:Vec3;t:number;edge?:EntityRef}[]=[];
        for(const e of q.edges){if(q.acceptEdge&&!q.acceptEdge(e))continue;const hit=guideEdgeIntersection(g,e);if(!hit)continue;add(hit.world,'Intersection',{kind:'guide-edge-intersection',guideId:g.id,edge:e.source});hits.push({world:hit.world,t:hit.guideT,edge:e.source});}
        hits.sort((a,b)=>a.t-b.t);
        const unique:{world:Vec3;t:number;edge?:EntityRef}[]=[];
        for(const h of hits){const prev=unique[unique.length-1];if(!prev||Math.abs(h.t-prev.t)>TOL.snapGeometry*4)unique.push(h);}
        for(let i=0;i+1<unique.length;i++){const a=unique[i],b=unique[i+1];if(V.len(V.sub(a.world,b.world))<TOL.minimumEdge*2)continue;const boundaryEdges=[a.edge,b.edge].filter((v):v is EntityRef=>!!v);add(V.mul(V.add(a.world,b.world),.5),'Midpoint',{kind:'guide-segment',guideId:g.id,boundaryEdges});}
      }
    }
  }
  if(q.inferenceEnabled&&q.inference){
    const inf=q.inference,origin=inf.origin;
    if(origin){
      const dirs=uniqueInferenceDirections(inf.referenceDirections||[],q.plane);
      for(const d of dirs){
        add(nearestPointOnLine(q.rawWorld,origin,d),'Parallel');
        if(q.plane){const pd=V.cross(V.unit(q.plane.normal),d);if(V.len(pd)>1e-8)add(nearestPointOnLine(q.rawWorld,origin,pd),'Perpendicular');}
      }
    }
    const axes=uniqueInferenceDirections(inf.axes||[],q.plane),pts=inf.alignmentPoints||[];
    for(let i=0;i<Math.min(pts.length,120);i++)for(const axis of axes)add(nearestPointOnLine(q.rawWorld,pts[i],axis),'On line');
  }
  return out.sort((a,b)=>a.distance-b.distance);
}
function isInferenceSnapKind(kind:SnapKind):boolean{return kind==='Parallel'||kind==='Perpendicular'||kind==='On line';}
function isLineSnapKind(kind:SnapKind):boolean{return kind==='On edge'||kind==='On guide line'||kind==='On guide circle';}
function bestSnapCandidate(q:SnapQuery):{best:SnapResult|null;candidates:SnapResult[]}{return profiler.measure('snap','SnapEngine',()=>{const candidates=collectSnapCandidates(q);let pointBest:SnapResult|null=null,pointScore=Infinity,lineBest:SnapResult|null=null,lineScore=Infinity,inferenceBest:SnapResult|null=null,inferenceScore=Infinity;for(const c of candidates){if(c.distance>q.radiusPx)continue;const score=c.distance-snapKindBias(c.kind);if(isInferenceSnapKind(c.kind)){if(score<inferenceScore-1e-6){inferenceScore=score;inferenceBest=c;}}else if(isLineSnapKind(c.kind)){if(score<lineScore-1e-6){lineScore=score;lineBest=c;}}else if(score<pointScore-1e-6){pointScore=score;pointBest=c;}}return {best:pointBest||inferenceBest||lineBest,candidates};},{edges:q.edges.length,guides:q.guides.length,inference:!!q.inferenceEnabled});}
