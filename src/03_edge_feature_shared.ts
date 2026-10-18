// Shared low-level helpers for circular-rim edge features.
const CHAMFER_CIRCULAR_RIM_POLICY=Object.freeze({minimumVertices:8,relativeRadiusTolerance:2e-3});

function approximatelyCircularPlanarLoop(points:Vec3[],plane:Plane):boolean{
  if(points.length<CHAMFER_CIRCULAR_RIM_POLICY.minimumVertices)return false;
  const basis=planeBasis(plane,points[0]),pts=points.map(p=>toPlane2(p,basis)),center:[number,number]=[pts.reduce((a,p)=>a+p[0],0)/pts.length,pts.reduce((a,p)=>a+p[1],0)/pts.length],radii=pts.map(p=>v2.dist(p,center)),radius=radii.reduce((a,b)=>a+b,0)/radii.length;
  if(radius<TOL.minimumEdge)return false;const tolerance=Math.max(TOL.snapGeometry*8,radius*CHAMFER_CIRCULAR_RIM_POLICY.relativeRadiusTolerance);return radii.every(r=>Math.abs(r-radius)<=tolerance);
}

function orientConvexFace(points:Vec3[],center:Vec3):CSGPolygon{
  let vs=points.map(p=>[...p] as Vec3),pl=planeFromPoints(vs),fc=V.mul(vs.reduce((a,p)=>V.add(a,p),[0,0,0] as Vec3),1/vs.length);
  if(V.dot(pl.normal,V.sub(fc,center))<0)vs.reverse();
  return csgPolygon(vs);
}
