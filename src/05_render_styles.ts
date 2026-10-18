const MODEL_KEY_LIGHT=V.unit(MODEL_APPEARANCE_POLICY.keyDirection),MODEL_FILL_LIGHT=V.unit(MODEL_APPEARANCE_POLICY.fillDirection);
// World-fixed studio accents affect Presentation gloss only. Keep the diffuse
// key/fill and the existing single shadow pass independent of these lights.
const PRESENTATION_GLOSS_POLICY=Object.freeze({
  strength:.8,minimumPower:8,powerRange:120,halfVectorMinimumSquared:1e-6,
  lights:[
    {direction:MODEL_KEY_LIGHT,strength:1},
    {direction:MODEL_FILL_LIGHT,strength:.3},
    {direction:V.unit([-1,.25,.4]),strength:.65},
    {direction:V.unit([.15,1,.35]),strength:.65},
    {direction:V.unit([1,-.4,.3]),strength:.5},
    {direction:V.unit([-.2,.35,-1]),strength:.35},
  ],
});
function modelViewStyle(value:unknown):ModelViewStyle{return value==='illustration'||value==='presentation'?value:'modeling';}
function activeModelViewStyle():ModelViewStyle{return modelViewStyle($('viewStyle').value);}
function sceneCameraFrame(state:CameraState):RenderCameraFrame {
  const direction:Vec3=[Math.cos(state.pitch)*Math.cos(state.yaw),Math.cos(state.pitch)*Math.sin(state.yaw),Math.sin(state.pitch)],distance=state.orthographic?Math.max(state.distance,state.orthographicEyeDistance??0):state.distance,forward=V.mul(direction,-1),right=V.unit(V.cross(forward,[0,0,1])),focal=1/Math.tan(Math.PI/8);
  return {eye:V.add(state.target,V.mul(direction,distance)),forward,right,up:V.cross(right,forward),span:state.distance/focal,focal};
}
// Use a conservative world-space AABB so model depth stays within the rendered
// frustum while zooming/orbiting. The near plane grows only if the full visible
// bounds are safely in front of the camera, avoiding unnecessary depth z-fighting.
function sceneCameraClipRange(state:CameraState,frame:RenderCameraFrame,bounds:Bounds3):CameraClipRange {
  const p=CAMERA_PROJECTION_POLICY,eyeDistance=V.len(V.sub(state.target,frame.eye)),center=V.mul(V.add(bounds.min,bounds.max),.5),half=V.mul(V.sub(bounds.max,bounds.min),.5),z=V.dot(V.sub(center,frame.eye),frame.forward),span=Math.abs(frame.forward[0])*half[0]+Math.abs(frame.forward[1])*half[1]+Math.abs(frame.forward[2])*half[2],nearest=z-span,farthest=z+span;
  const nearPlane=eyeDistance>p.adaptiveNearStart?Math.max(p.nearPlane,Math.min(eyeDistance*p.nearDistanceRatio,Math.max(p.nearPlane,nearest*p.nearBoundsFraction))):p.nearPlane;
  const farPlane=Math.max(p.farPlane,eyeDistance*p.farDistanceFactor,farthest*p.farBoundsFactor+p.farPadding,nearPlane*2);
  return {nearPlane,farPlane};
}
function sceneProjectPoint(point:Vec3,state:CameraState,frame:RenderCameraFrame,width:number,height:number):[number,number,number]{const d=V.sub(point,frame.eye),z=V.dot(d,frame.forward),scale=state.orthographic?height/(2*frame.span):height*frame.focal/(2*z);return [width/2+V.dot(d,frame.right)*scale,height/2-V.dot(d,frame.up)*scale,z];}
function sceneStyleEdges(mesh:Mesh,appearance:SceneAppearance,style:ModelViewStyle,state:CameraState,frame:RenderCameraFrame):[number,number][] {
  if(style==='modeling')return mesh.edges;if(style==='presentation')return [];
  return appearance.edges.filter(edge=>{
    if(edge.sharp)return true;if(edge.normals.length!==2)return true;
    const midpoint=V.mul(V.add(mesh.vertices[edge.a],mesh.vertices[edge.b]),.5),view=state.orthographic?V.mul(frame.forward,-1):V.unit(V.sub(frame.eye,midpoint)),a=V.dot(edge.normals[0],view),b=V.dot(edge.normals[1],view),epsilon=MODEL_APPEARANCE_POLICY.facingEpsilon;
    return a*b<=0&&(Math.abs(a)>epsilon||Math.abs(b)>epsilon);
  }).map(edge=>[edge.a,edge.b]);
}
function sceneLitColor(color:number[],normal:Vec3,style:ModelViewStyle,ambientOverride?:number,view?:Vec3,shininess=0):number[] {
  const policy=MODEL_APPEARANCE_POLICY,key=MODEL_KEY_LIGHT;
  if(style==='modeling'){const ambient=ambientOverride??SELECTION_VISUAL_POLICY.ordinaryAmbient,shade=ambient+(1-ambient)*Math.max(0,V.dot(normal,key));return color.map(v=>v*shade);}
  const diffuse=policy.ambient+policy.keyStrength*Math.max(0,V.dot(normal,key))+policy.fillStrength*Math.max(0,V.dot(normal,MODEL_FILL_LIGHT)),half=V.unit(V.add(key,view||key)),highlight=policy.highlightStrength*Math.pow(Math.max(0,V.dot(normal,half)),policy.highlightPower)*Math.max(0,V.dot(normal,key));
  return color.map(v=>clamp(v*diffuse+(style==='presentation'?sceneSpecularHighlight(normal,view||key,shininess):highlight),0,1));
}
// CPU reference for tests and non-GPU consumers; the renderer evaluates this
// additional white highlight per fragment to resolve broad planar faces.
function sceneSpecularHighlight(normal:Vec3,view:Vec3,shininess:number):number {
  const p=PRESENTATION_GLOSS_POLICY,s=shininess/100;if(s<=0)return 0;const power=p.minimumPower+p.powerRange*s*s;
  return p.strength*s*p.lights.reduce((sum,light)=>{
    const half=V.add(light.direction,view),lengthSquared=V.dot(half,half);
    if(lengthSquared<p.halfVectorMinimumSquared)return sum;
    return sum+light.strength*Math.pow(Math.max(0,V.dot(normal,V.mul(half,1/Math.sqrt(lengthSquared)))),power)*Math.max(0,V.dot(normal,light.direction));
  },0);
}
function modelVertexShaderSource():string{
  const p=MODEL_APPEARANCE_POLICY,key=MODEL_KEY_LIGHT.map(v=>v.toFixed(10)).join(','),fill=MODEL_FILL_LIGHT.map(v=>v.toFixed(10)).join(',');
  return `attribute vec3 position;attribute vec3 color;attribute vec4 material;attribute vec2 faceKey;
uniform vec3 eye,right,up,forward;uniform float aspect,focal,ortho,span,nearPlane,farPlane;
uniform vec2 faceHighlightKey;uniform float faceHighlightEnabled,faceHighlightStyle,faceHighlightAmbient;
varying vec3 vColor;varying vec3 vWorld;varying vec4 vMaterial;
vec3 faceHighlightColor(){
  vec3 n=normalize(material.xyz),key=vec3(${key}),fill=vec3(${fill}),amber=vec3(.96,.70,.32);
  float keyFacing=max(0.0,dot(n,key));
  if(faceHighlightStyle<.5)return amber*(faceHighlightAmbient+(1.0-faceHighlightAmbient)*keyFacing);
  vec3 view=ortho>.5?-forward:normalize(eye-position),halfVector=key+view;
  float halfLength=dot(halfVector,halfVector),alignment=halfLength>0.0?max(0.0,dot(n,halfVector*inversesqrt(halfLength))):0.0;
  float diffuse=${p.ambient.toFixed(10)}+${p.keyStrength.toFixed(10)}*keyFacing+${p.fillStrength.toFixed(10)}*max(0.0,dot(n,fill));
  float highlight=faceHighlightStyle>1.5?0.0:${p.highlightStrength.toFixed(10)}*pow(alignment,${p.highlightPower.toFixed(1)})*keyFacing;
  return clamp(amber*diffuse+vec3(highlight),0.0,1.0);
}
void main(){vec3 d=position-eye;float z=dot(d,forward);float x=dot(d,right),y=dot(d,up);if(ortho>.5){gl_Position=vec4(x/span/aspect,y/span,(2.0*z-nearPlane-farPlane)/(farPlane-nearPlane),1.0);}else{float A=(farPlane+nearPlane)/(farPlane-nearPlane);float B=(-2.0*farPlane*nearPlane)/(farPlane-nearPlane);gl_Position=vec4(x*focal/aspect,y*focal,A*z+B,z);}vColor=color;
if(faceHighlightEnabled>.5&&all(lessThan(abs(faceKey-faceHighlightKey),vec2(.5))))vColor=faceHighlightColor();
vWorld=position;vMaterial=material;}`;
}
function modelFragmentShaderSource():string{
  const p=PRESENTATION_GLOSS_POLICY;
  // Generate unrolled constants from the CPU policy: no dynamic WebGL1 array
  // indexing, extra passes, uniforms or per-frame geometry work is required.
  const lights=p.lights.map(light=>`${light.strength.toFixed(10)}*specularLight(n,view,vec3(${light.direction.map(v=>v.toFixed(10)).join(',')}),power)`).join('+');
  return `
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif
uniform float opacity,shadowEnabled,shadowOnly,shadowSpan,shadowNear,shadowRange,shadowTexel,shadowBias;
uniform vec3 shadowOrigin,shadowRight,shadowUp,shadowForward;
uniform sampler2D shadowMap;
uniform vec3 materialEye,materialForward;
uniform float materialOrtho;
varying vec3 vColor,vWorld;
varying vec4 vMaterial;
float specularLight(vec3 n,vec3 view,vec3 light,float power){vec3 halfVector=light+view;float lengthSquared=dot(halfVector,halfVector);if(lengthSquared<${p.halfVectorMinimumSquared.toFixed(10)})return 0.0;return pow(max(0.0,dot(n,halfVector*inversesqrt(lengthSquared))),power)*max(0.0,dot(n,light));}
vec3 materialColor(){
  float s=vMaterial.w;if(s<=0.0)return vColor;
  vec3 n=normalize(vMaterial.xyz),view=materialOrtho>.5?-materialForward:normalize(materialEye-vWorld);
  float power=${p.minimumPower.toFixed(1)}+${p.powerRange.toFixed(1)}*s*s;
  float highlight=${p.strength.toFixed(10)}*s*(${lights});
  return clamp(vColor+vec3(highlight),0.0,1.0);
}
float shadowVisibility(){
  vec3 d=vWorld-shadowOrigin;
  vec2 uv=vec2(dot(d,shadowRight),dot(d,shadowUp))/shadowSpan*.5+.5;
  float depth=(dot(d,shadowForward)-shadowNear)/shadowRange;
  if(uv.x<0.0||uv.x>1.0||uv.y<0.0||uv.y>1.0||depth<0.0||depth>1.0)return 1.0;
  float visible=0.0;
  for(int y=-1;y<=1;y++)for(int x=-1;x<=1;x++){
    vec3 depthSample=texture2D(shadowMap,uv+vec2(float(x),float(y))*shadowTexel).rgb;
    float stored=dot(depthSample,vec3(1.0,1.0/255.0,1.0/65025.0));
    visible+=step(depth-shadowBias,stored);
  }
  return visible/9.0;
}
void main(){
  vec3 lit=materialColor();
  if(shadowEnabled<.5&&shadowOnly<.5){gl_FragColor=vec4(lit,opacity);return;}
  float visible=shadowEnabled>.5?shadowVisibility():1.0;
  if(shadowOnly>.5){float alpha=(1.0-visible)*opacity;if(alpha<.001)discard;gl_FragColor=vec4(vColor,alpha);}
  else gl_FragColor=vec4(lit*(1.0-${MODEL_SHADOW_POLICY.objectDarkness.toFixed(2)}*(1.0-visible)),opacity);
}`;}
$('viewShadows').checked=false;
$('viewShadows').addEventListener('change',()=>{if(!$('viewShadows').checked)viewportShadows.release();requestRender();});
$('viewStyle').value='modeling';
$('viewStyle').addEventListener('change',()=>{sceneKey='';requestRender();});
