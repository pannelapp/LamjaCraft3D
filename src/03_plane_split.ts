// Plane split geometry. The construction plane lives in world space; the
// geometry service receives an equivalent plane in the target solid's local
// coordinate system and returns two closed solids.

interface GeometryPlaneSplitResult { positive: Solid; negative: Solid; }

function planeSplitClipPolygons(origin:Vec3,basis:PlaneBasis,u0:number,u1:number,v0:number,v1:number,w0:number,w1:number):CSGPolygon[]{
  if(!(u1>u0&&v1>v0&&w1>w0))throw Error('The split clipping volume is invalid.');
  const prism=primitivePrism([[u0,v0],[u1,v0],[u1,v1],[u0,v1]],w1-w0);
  const mapPoint=(p:Vec3):Vec3=>V.add(origin,V.add(V.mul(basis.u,p[0]),V.add(V.mul(basis.v,p[1]),V.mul(basis.normal,p[2]+w0))));
  return solidToCsg(prism).map(poly=>csgPolygon(poly.vs.map(mapPoint),poly));
}

function splitSolidByPlane(s:Solid,origin0:Vec3,normal0:Vec3):GeometryPlaneSplitResult{
  const normal=V.unit(normal0);if(V.len(normal)<1e-9)throw Error('The split plane requires a valid normal.');
  if(!s.vertices.size)throw Error('The object has no geometry to split.');
  const origin=[...origin0] as Vec3,basis=planeBasis({normal,offset:V.dot(normal,origin)},origin),coords=[...s.vertices.values()].map(v=>{
    const d=V.sub(v.position,origin);return {u:V.dot(d,basis.u),v:V.dot(d,basis.v),w:V.dot(d,basis.normal)};
  });
  const minW=Math.min(...coords.map(p=>p.w)),maxW=Math.max(...coords.map(p=>p.w));
  const crossingTolerance=Math.max(TOL.csg*16,TOL.minimumEdge*.01);
  if(minW>=-crossingTolerance||maxW<=crossingTolerance)throw Error('The split plane must pass through the interior of the object.');
  const minU=Math.min(...coords.map(p=>p.u)),maxU=Math.max(...coords.map(p=>p.u)),minV=Math.min(...coords.map(p=>p.v)),maxV=Math.max(...coords.map(p=>p.v));
  const span=Math.max(maxU-minU,maxV-minV,maxW-minW,TOL.minimumEdge),margin=Math.max(1,span*.1,TOL.csg*1000),u0=minU-margin,u1=maxU+margin,v0=minV-margin,v1=maxV+margin;
  const positiveClip=planeSplitClipPolygons(origin,basis,u0,u1,v0,v1,0,maxW+margin),negativeClip=planeSplitClipPolygons(origin,basis,u0,u1,v0,v1,minW-margin,0);
  const source=solidToCsg(s),positivePolys=profiler.measure('geometry','Plane split positive half',()=>csgIntersect(source,positiveClip),{faces:s.faces.size}),negativePolys=profiler.measure('geometry','Plane split negative half',()=>csgIntersect(source,negativeClip),{faces:s.faces.size});
  if(!positivePolys.length||!negativePolys.length)throw Error('The plane did not produce two non-empty solids.');
  const provenance:FaceProvenance={kind:'split',label:'Plane Split'};
  const positive=profiler.measure('geometry','Plane split positive B-rep',()=>csgToSolid(positivePolys,s.id,provenance),{polygons:positivePolys.length});
  const negative=profiler.measure('geometry','Plane split negative B-rep',()=>csgToSolid(negativePolys,undefined,provenance),{polygons:negativePolys.length});
  const a=validateSolid(positive,false),b=validateSolid(negative,false);if(!a.ok||!b.ok)throw Error(`The split did not produce two valid closed solids. ${a.errors[0]||b.errors[0]||''}`.trim());
  return {positive,negative};
}
