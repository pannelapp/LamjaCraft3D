// Parametric creation produces ordinary planar B-rep faces, not a second
// persistent shape representation. Curved forms share one oriented revolution.
type PrimitiveKind='box'|'cylinder'|'sphere'|'ellipsoid'|'cone'|'frustum'|'torus'|'capsule';
interface PrimitiveParameters {
  kind:PrimitiveKind;width:number;depth:number;height:number;radius:number;
  topRadius:number;majorRadius:number;tubeRadius:number;straightHeight:number;
  segments:number;profileSegments:number;
}
type PrimitiveField=Exclude<keyof PrimitiveParameters,'kind'>;
interface PrimitiveDefinition {kind:PrimitiveKind;label:string;fields:readonly PrimitiveField[];curved:boolean;profile:boolean;}
const PRIMITIVE_FIELD_INFO:Readonly<Record<PrimitiveField,{label:string;unit:'mm'|'count'}>>={
  width:{label:'Width',unit:'mm'},depth:{label:'Depth',unit:'mm'},height:{label:'Height',unit:'mm'},
  radius:{label:'Radius',unit:'mm'},topRadius:{label:'Top radius',unit:'mm'},
  majorRadius:{label:'Ring radius',unit:'mm'},tubeRadius:{label:'Tube radius',unit:'mm'},
  straightHeight:{label:'Straight height',unit:'mm'},segments:{label:'Around segments',unit:'count'},
  profileSegments:{label:'Profile segments',unit:'count'},
};
// The face budget fits the largest allowed capsule: 64 around × 33 bands.
const PRIMITIVE_POLICY=Object.freeze({minimumSize:.1,maximumSize:10000,minimumSegments:8,maximumSegments:64,minimumProfileSegments:4,maximumProfileSegments:32,maximumFaces:2112});
const PRIMITIVE_DEFINITIONS:readonly PrimitiveDefinition[]=[
  {kind:'sphere',label:'Sphere',fields:['radius'],curved:true,profile:true},
  {kind:'ellipsoid',label:'Ellipsoid',fields:['width','depth','height'],curved:true,profile:true},
  {kind:'cone',label:'Cone',fields:['radius','height'],curved:true,profile:false},
  {kind:'frustum',label:'Frustum',fields:['radius','topRadius','height'],curved:true,profile:false},
  {kind:'torus',label:'Torus',fields:['majorRadius','tubeRadius'],curved:true,profile:true},
  {kind:'capsule',label:'Capsule',fields:['radius','straightHeight'],curved:true,profile:true},
  {kind:'box',label:'Box',fields:['width','depth','height'],curved:false,profile:false},
  {kind:'cylinder',label:'Cylinder',fields:['radius','height'],curved:true,profile:false},
];
function primitiveDefinition(kind:PrimitiveKind):PrimitiveDefinition {
  const definition=PRIMITIVE_DEFINITIONS.find(d=>d.kind===kind);if(!definition)throw Error('Choose a supported shape.');return definition;
}
function defaultPrimitiveParameters(kind:PrimitiveKind):PrimitiveParameters {
  primitiveDefinition(kind);return {kind,width:40,depth:30,height:40,radius:15,topRadius:8,majorRadius:22,tubeRadius:6,straightHeight:25,segments:32,profileSegments:16};
}
function validatePrimitiveParameters(p:PrimitiveParameters):void {
  const definition=primitiveDefinition(p.kind);
  for(const key of definition.fields){const value=p[key],minimum=key==='straightHeight'||key==='topRadius'?0:PRIMITIVE_POLICY.minimumSize;if(!Number.isFinite(value)||value<minimum||value>PRIMITIVE_POLICY.maximumSize)throw Error(`${PRIMITIVE_FIELD_INFO[key].label} must be between ${minimum} and ${PRIMITIVE_POLICY.maximumSize} mm.`);}
  const count=(value:number,min:number,max:number,label:string)=>{if(!Number.isInteger(value)||value<min||value>max)throw Error(`${label} must be a whole number between ${min} and ${max}.`);};
  if(definition.curved)count(p.segments,PRIMITIVE_POLICY.minimumSegments,PRIMITIVE_POLICY.maximumSegments,'Around segments');
  if(definition.profile)count(p.profileSegments,PRIMITIVE_POLICY.minimumProfileSegments,PRIMITIVE_POLICY.maximumProfileSegments,'Profile segments');
  if(p.kind==='torus'&&p.majorRadius-p.tubeRadius<PRIMITIVE_POLICY.minimumSize)throw Error('Ring radius must exceed tube radius by at least 0.1 mm.');
  if(p.kind==='frustum'&&p.topRadius>0&&p.topRadius<PRIMITIVE_POLICY.minimumSize)throw Error('Top radius must be 0 or at least 0.1 mm.');
}
function primitiveRevolution(profile:readonly Vec2[],segments:number,closed:boolean,label:string,scaleXY:Vec2=[1,1]):PolyFaceInput[] {
  // Profile follows the outside from bottom to top; a closed torus profile
  // follows counterclockwise in radius/height space. Exact axis poles occur once.
  const rings=profile.map(([radius,z])=>radius===0?[[0,0,z] as Vec3]:Array.from({length:segments},(_,i)=>{const angle=2*Math.PI*i/segments;return [radius*Math.cos(angle)*scaleXY[0],radius*Math.sin(angle)*scaleXY[1],z] as Vec3;}));
  const faces:PolyFaceInput[]=[],add=(points:Vec3[])=>faces.push({points,provenance:{kind:'primitive',label}});
  for(let j=0;j<(closed?rings.length:rings.length-1);j++){
    const a=rings[j],b=rings[(j+1)%rings.length];
    for(let i=0;i<segments;i++){const next=(i+1)%segments;if(a.length===1)add([a[0],b[next],b[i]]);else if(b.length===1)add([a[i],a[next],b[0]]);else add([a[i],a[next],b[next],b[i]]);}
  }
  if(!closed){if(rings[0].length>1)add([...rings[0]].reverse());if(rings.at(-1)!.length>1)add([...rings.at(-1)!]);}
  return faces;
}
function createParametricPrimitive(p:PrimitiveParameters,id='primitive'):Solid {
  validatePrimitiveParameters(p);const definition=primitiveDefinition(p.kind);let solid:Solid;
  if(p.kind==='box')solid=primitivePrism([[-p.width/2,-p.depth/2],[p.width/2,-p.depth/2],[p.width/2,p.depth/2],[-p.width/2,p.depth/2]],p.height,id);
  else{
    let profile:Vec2[]=[],closed=false,scale:Vec2=[1,1];
    if(p.kind==='sphere'||p.kind==='ellipsoid'){
      const r=p.kind==='sphere'?p.radius:p.height/2;
      if(p.kind==='ellipsoid')scale=[p.width/p.height,p.depth/p.height];
      profile=Array.from({length:p.profileSegments+1},(_,i)=>{const angle=-Math.PI/2+Math.PI*i/p.profileSegments;return [i===0||i===p.profileSegments?0:r*Math.cos(angle),r+r*Math.sin(angle)] as Vec2;});
    }else if(p.kind==='capsule'){
      const half=Math.ceil(p.profileSegments/2);
      profile=Array.from({length:half+1},(_,i)=>{const angle=-Math.PI/2+Math.PI*i/(2*half);return [i===0?0:p.radius*Math.cos(angle),p.radius+p.radius*Math.sin(angle)] as Vec2;});
      for(let i=p.straightHeight===0?1:0;i<=half;i++){const angle=Math.PI*i/(2*half);profile.push([i===half?0:p.radius*Math.cos(angle),p.radius+p.straightHeight+p.radius*Math.sin(angle)]);}
    }else if(p.kind==='torus'){
      closed=true;profile=Array.from({length:p.profileSegments},(_,i)=>{const angle=2*Math.PI*i/p.profileSegments;return [p.majorRadius+p.tubeRadius*Math.sin(angle),p.tubeRadius-p.tubeRadius*Math.cos(angle)] as Vec2;});
    }else profile=[[p.radius,0],[p.kind==='cylinder'?p.radius:p.kind==='frustum'?p.topRadius:0,p.height]];
    const faces=primitiveRevolution(profile,p.segments,closed,definition.label,scale);
    if(faces.length>PRIMITIVE_POLICY.maximumFaces)throw Error('Reduce shape segments to stay within the 2112-face creation budget.');
    solid=buildSolidFromPolygons(faces,id);
  }
  for(const face of solid.faces.values())face.provenance={kind:'primitive',label:definition.label};solid.metadata={name:definition.label};validateSolid(solid);return solid;
}
