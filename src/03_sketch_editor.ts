// Drafts are transient planar polylines. Only validated closed contours cross
// the geometry API boundary into the existing face subdivision operation.
interface SketchDraftPath { points:Vec2[]; kind:'line'|'rectangle'|'circle'|'arc'|'guide'|'measure'; }
type SketchContourValidation={ok:true;loops:Vec2[][]}|{ok:false;message:string;points:Vec2[]};
const SKETCH_CONTOUR_POLICY=Object.freeze({joinTolerance:TOL.snapGeometry,maximumSegments:4096});
function sketchPointOnSegment(p:Vec2,a:Vec2,b:Vec2):boolean {
  const dx=b[0]-a[0],dy=b[1]-a[1],length=Math.hypot(dx,dy);
  if(!length)return v2.dist(p,a)<=SKETCH_CONTOUR_POLICY.joinTolerance;
  const t=clamp(((p[0]-a[0])*(dx/length)+(p[1]-a[1])*(dy/length))/length,0,1);
  return v2.dist(p,[a[0]+dx*t,a[1]+dy*t])<=SKETCH_CONTOUR_POLICY.joinTolerance;
}
function sketchSegmentsContact(a:Vec2,b:Vec2,c:Vec2,d:Vec2):boolean {
  const o1=v2.cross(a,b,c),o2=v2.cross(a,b,d),o3=v2.cross(c,d,a),o4=v2.cross(c,d,b);
  const opposite=(x:number,y:number)=>(x<0&&y>0)||(x>0&&y<0);
  return opposite(o1,o2)&&opposite(o3,o4)||sketchPointOnSegment(a,c,d)||sketchPointOnSegment(b,c,d)||sketchPointOnSegment(c,a,b)||sketchPointOnSegment(d,a,b);
}
function validateSketchDraft(paths:readonly SketchDraftPath[]):SketchContourValidation {
  const fail=(message:string,points:Vec2[]=[]):SketchContourValidation=>({ok:false,message,points});
  const nodes:Vec2[]=[],edges:{a:number;b:number}[]=[],adj:number[][]=[];
  const node=(p:Vec2):number=>{const found=nodes.findIndex(q=>v2.dist(p,q)<=SKETCH_CONTOUR_POLICY.joinTolerance);if(found>=0)return found;nodes.push([...p]);adj.push([]);return nodes.length-1;};
  for(const path of paths){
    if(path.kind==='guide'||path.kind==='measure')continue;
    for(let i=1;i<path.points.length;i++){
      const p=path.points[i-1],q=path.points[i];
      if(![...p,...q].every(Number.isFinite))return fail('The sketch contains a non-finite coordinate.');
      if(!Number.isFinite(v2.dist(p,q))||v2.dist(p,q)<TOL.minimumEdge)return fail('Remove a zero-length, very short or out-of-range segment.',[p,q]);
      if(edges.length>=SKETCH_CONTOUR_POLICY.maximumSegments)return fail(`Use at most ${SKETCH_CONTOUR_POLICY.maximumSegments} sketch segments.`);
      const a=node(p),b=node(q);if(a===b)return fail('A segment is smaller than the endpoint joining tolerance.',[p,q]);
      const id=edges.length;edges.push({a,b});adj[a].push(id);adj[b].push(id);
    }
  }
  if(!edges.length)return fail('Draw at least one closed contour. Guides and measurements do not create regions.');
  const open=nodes.filter((_,i)=>adj[i].length!==2);
  if(open.length)return fail('Join every contour endpoint. Branches and overlapping endpoints are not closed contours.',open);
  // Shared endpoints are allowed only for consecutive, non-overlapping edges.
  // Other contacts, crossings and overlaps must be resolved explicitly.
  for(let i=0;i<edges.length;i++)for(let j=i+1;j<edges.length;j++){
    const a=edges[i],b=edges[j],shared=[a.a,a.b].find(n=>n===b.a||n===b.b);
    if(shared!==undefined){
      const p=nodes[shared],q=nodes[a.a===shared?a.b:a.a],r=nodes[b.a===shared?b.b:b.a];
      if(sketchPointOnSegment(q,p,r)||sketchPointOnSegment(r,p,q))return fail('Remove overlapping or duplicate contour segments.',[p,q,r]);
    }else if(sketchSegmentsContact(nodes[a.a],nodes[a.b],nodes[b.a],nodes[b.b]))return fail('Contours must not cross, overlap or touch each other.',[nodes[a.a],nodes[a.b],nodes[b.a],nodes[b.b]]);
  }
  const visited=new Set<number>(),loops:Vec2[][]=[];
  for(let first=0;first<edges.length;first++){
    if(visited.has(first))continue;
    const start=edges[first].a,loop:Vec2[]=[];let current=start,edge=first;
    do{
      loop.push([...nodes[current]]);visited.add(edge);const e=edges[edge];current=e.a===current?e.b:e.a;
      edge=adj[current].find(id=>!visited.has(id))??-1;
    }while(current!==start&&edge>=0);
    if(current!==start||loop.length<3||!Number.isFinite(v2.area(loop))||Math.abs(v2.area(loop))<=TOL.minimumFaceArea)return fail('A contour has no usable enclosed area.',loop);
    loops.push(v2.area(loop)>0?loop:loop.reverse());
  }
  // Outer contours first; nested contours then split the created region into
  // ordinary inner faces and annular faces, preserving normal Push/Pull rules.
  loops.sort((a,b)=>Math.abs(v2.area(b))-Math.abs(v2.area(a)));
  return {ok:true,loops};
}
