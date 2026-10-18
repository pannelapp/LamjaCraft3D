// Screen-area queries use disposable SceneGeometry meshes, never edit the B-rep,
// and deliberately do not perform occlusion tests (through selection).
interface ScreenSelectionRect {left:number;top:number;right:number;bottom:number;}
interface SelectionProjectedVertex {world:Vec3;screen:Vec3;}
function selectionClipDepth(polygon:SelectionProjectedVertex[],depth:number,keepGreater:boolean,projection:(point:Vec3)=>Vec3):SelectionProjectedVertex[]{
  const result:SelectionProjectedVertex[]=[];
  for(let i=0;i<polygon.length;i++){
    const a=polygon[i],b=polygon[(i+1)%polygon.length],aInside=keepGreater?a.screen[2]>=depth:a.screen[2]<=depth,bInside=keepGreater?b.screen[2]>=depth:b.screen[2]<=depth;
    if(aInside)result.push(a);
    if(aInside!==bInside){const t=(depth-a.screen[2])/(b.screen[2]-a.screen[2]),world=V.add(a.world,V.mul(V.sub(b.world,a.world),t));result.push({world,screen:projection(world)});}
  }
  return result;
}
function selectionPolygonIntersectsRect(points:Vec2[],rect:ScreenSelectionRect):boolean{
  if(!points.length)return false;
  if(Math.max(...points.map(p=>p[0]))<rect.left||Math.min(...points.map(p=>p[0]))>rect.right||Math.max(...points.map(p=>p[1]))<rect.top||Math.min(...points.map(p=>p[1]))>rect.bottom)return false;
  // Clip the convex projected triangle against all four sides. This also finds
  // triangles containing the entire rectangle, and thin edge crossings.
  let polygon=points;
  const sides:[0|1,number,boolean][]=[[0,rect.left,true],[0,rect.right,false],[1,rect.top,true],[1,rect.bottom,false]];
  for(const [axis,boundary,keepGreater] of sides){
    const result:Vec2[]=[];
    for(let i=0;i<polygon.length;i++){
      const a=polygon[i],b=polygon[(i+1)%polygon.length],aInside=keepGreater?a[axis]>=boundary:a[axis]<=boundary,bInside=keepGreater?b[axis]>=boundary:b[axis]<=boundary;
      if(aInside)result.push(a);
      if(aInside!==bInside){const t=(boundary-a[axis])/(b[axis]-a[axis]);result.push([a[0]+t*(b[0]-a[0]),a[1]+t*(b[1]-a[1])]);}
    }
    polygon=result;if(!polygon.length)return false;
  }
  return true;
}
function sceneObjectsInScreenRect(list:readonly ModelObject[],rect:ScreenSelectionRect,projection:(point:Vec3)=>Vec3,near:number,far:number):ObjectId[]{
  if(rect.right<=rect.left||rect.bottom<=rect.top)return [];
  const ids:ObjectId[]=[];
  for(const object of list){
    if(!isObjectVisible(object))continue;
    const mesh=sceneGeometry.mesh(object),projected=mesh.vertices.map(world=>({world,screen:projection(world)}));
    for(const triangle of mesh.triangles){
      let polygon=triangle.map(index=>projected[index]);
      if(polygon.every(p=>p.screen[2]<near)||polygon.every(p=>p.screen[2]>far))continue;
      if(polygon.some(p=>p.screen[2]<near))polygon=selectionClipDepth(polygon,near,true,projection);
      if(polygon.some(p=>p.screen[2]>far))polygon=selectionClipDepth(polygon,far,false,projection);
      if(selectionPolygonIntersectsRect(polygon.map(p=>[p.screen[0],p.screen[1]]),rect)){ids.push(object.id);break;}
    }
  }
  return ids;
}
