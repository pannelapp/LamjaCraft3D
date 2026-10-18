// Pointer-locked, free-fly camera navigation. The document and geometry are
// never modified. Flight remains independent of modeling tool controllers.
const EXPLORE_POLICY=Object.freeze({mouseRadiansPerPixel:.0025,sceneDiagonalsPerSecond:.3,initialMinimumSpeed:35,initialMaximumSpeed:25000,minimumSpeed:.5,maximumSpeed:1000000,speedFactor:1.25,speedHudMilliseconds:1800,maximumWheelSteps:4,maximumFrameSeconds:.05,pitchClearance:.02});
let exploreActive=false,exploreRequestPending=false,exploreFrame=0,exploreLastTimestamp:number|null=null;
let exploreSpeed=500;
let exploreSpeedTimer:ReturnType<typeof setTimeout>|null=null;
function exploreHideSpeed():void {
  if(exploreSpeedTimer!==null){clearTimeout(exploreSpeedTimer);exploreSpeedTimer=null;}
  $('exploreSpeedHud').classList.add('hidden');
}
function exploreShowSpeed():void {
  const hud=$('exploreSpeedHud');
  const formatted=exploreSpeed>=10?Math.round(exploreSpeed).toLocaleString('en-US'):exploreSpeed.toLocaleString('en-US',{maximumFractionDigits:2});
  hud.textContent=`Fly speed: ${formatted} mm/s`;
  hud.classList.remove('hidden');
  if(exploreSpeedTimer!==null)clearTimeout(exploreSpeedTimer);
  exploreSpeedTimer=setTimeout(()=>{exploreSpeedTimer=null;hud.classList.add('hidden');},EXPLORE_POLICY.speedHudMilliseconds);
}
function exploreAdjustSpeed(steps:number):void {
  if(!exploreActive||!Number.isFinite(steps)||steps===0)return;
  exploreSpeed=clamp(exploreSpeed*Math.pow(EXPLORE_POLICY.speedFactor,clamp(steps,-EXPLORE_POLICY.maximumWheelSteps,EXPLORE_POLICY.maximumWheelSteps)),EXPLORE_POLICY.minimumSpeed,EXPLORE_POLICY.maximumSpeed);
  exploreShowSpeed();
}
function exploreWheel(event:WheelEvent):boolean {
  if(!exploreActive)return false;
  event.preventDefault();
  // Wheel direction agrees with ArrowUp/ArrowDown. deltaMode is pixels/lines/pages.
  // Trackpads supply fractional increments; cap unusually large deltas per event.
  const unit=event.deltaMode===1?3:event.deltaMode===2?1:100;
  exploreAdjustSpeed(-event.deltaY/unit);
  return true;
}
const exploreHeld=new Set<string>();

function exploreKey(event:KeyboardEvent):string|null {
  switch(event.code){
    case 'KeyW':return 'forward';case 'KeyS':return 'back';
    case 'KeyA':return 'left';case 'KeyD':return 'right';
    case 'Space':return 'up';case 'ShiftLeft':return 'down';
  }
  // Synthetic keys and browsers without physical codes still work.
  const key=event.key.toLowerCase();
  if(key==='w')return 'forward';if(key==='s')return 'back';
  if(key==='a')return 'left';if(key==='d')return 'right';
  if(key===' ')return 'up';
  if(key==='shift'&&event.location===1)return 'down';
  return null;
}
function exploreMove(seconds:number):void {
  const forward=Number(exploreHeld.has('forward'))-Number(exploreHeld.has('back'));
  const sideways=Number(exploreHeld.has('right'))-Number(exploreHeld.has('left'));
  const vertical=Number(exploreHeld.has('up'))-Number(exploreHeld.has('down'));
  if(!forward&&!sideways&&!vertical)return;
  const frame=sceneCameraFrame(camera);
  const velocity=V.add(V.add(V.mul(frame.forward,forward),V.mul(frame.right,sideways)),[0,0,vertical]);
  const size=V.len(velocity);if(size<1e-9)return;
  camera.target=V.add(camera.target,V.mul(velocity,exploreSpeed*seconds/size));
  requestRender();
}
function exploreTick(timestamp:number):void {
  if(!exploreActive)return;
  if(exploreLastTimestamp!==null)exploreMove(Math.min(EXPLORE_POLICY.maximumFrameSeconds,Math.max(0,(timestamp-exploreLastTimestamp)/1000)));
  exploreLastTimestamp=timestamp;
  exploreFrame=requestAnimationFrame(exploreTick);
}
function exploreSetActive(active:boolean):void {
  if(exploreActive===active){if(!active)exploreRequestPending=false;return;}
  exploreActive=active;exploreRequestPending=false;exploreHeld.clear();
  exploreLastTimestamp=null;
  if(exploreFrame)cancelAnimationFrame(exploreFrame);
  exploreFrame=0;
  $('viewport').classList.toggle('explore-active',active);
  $('exploreHud').classList.toggle('hidden',!active);
  exploreHideSpeed();
  $('exploreBtn').classList.toggle('active',active);
  $('exploreBtn').setAttribute('aria-pressed',String(active));
  $('exploreBtn').textContent=active?'Exit Explore':'Explore';
  if(active){
    // Do not commit an unfinished modeling preview when switching to flight.
    setTool('select');
    camera.orthographic=false;
    camera.distance=Math.max(camera.distance,camera.orthographicEyeDistance??0);
    delete camera.orthographicEyeDistance;
    for(const button of qsa('[data-view]'))button.classList.toggle('active',button.dataset.view==='iso');
    const bounds=sceneBounds(visibleObjects());
    const size=V.len(V.sub(bounds.max,bounds.min));
    exploreSpeed=clamp(Number.isFinite(size)&&size>0?size*EXPLORE_POLICY.sceneDiagonalsPerSecond:500,EXPLORE_POLICY.initialMinimumSpeed,EXPLORE_POLICY.initialMaximumSpeed);
    scene.focus();
    exploreFrame=requestAnimationFrame(exploreTick);
  }
  requestRender();
}
function explorePointerLockChanged():void {
  if(document.pointerLockElement===scene){
    if(exploreRequestPending)exploreSetActive(true);
  }else exploreSetActive(false);
}
function exitExplore():void {
  exploreRequestPending=false;
  exploreSetActive(false);
  if(document.pointerLockElement===scene)document.exitPointerLock?.();
}
function toggleExplore():void {
  if(exploreActive||exploreRequestPending){exitExplore();return;}
  if(modelingOperationBusy||document.querySelector('dialog[open]')){toast('Finish the current operation or close the dialog before exploring.');return;}
  if(typeof scene.requestPointerLock!=='function'){toast('Explore requires mouse pointer lock, which this browser does not support.');return;}
  exploreRequestPending=true;
  try{
    const result=scene.requestPointerLock();
    if(result&&typeof result.catch==='function')result.catch(()=>{if(exploreRequestPending){exploreRequestPending=false;toast('Mouse pointer lock was not allowed. Explore was not started.');}});
  }catch(_){exploreRequestPending=false;toast('Mouse pointer lock was not allowed. Explore was not started.');}
}
function exploreMouseMove(event:MouseEvent):void {
  if(!exploreActive||document.pointerLockElement!==scene)return;
  // CameraState stores an orbit target, but mouse-look must rotate in place.
  // Keep the eye fixed, then derive the new target from the new look direction.
  const eye=sceneCameraFrame(camera).eye;
  camera.yaw-=event.movementX*EXPLORE_POLICY.mouseRadiansPerPixel;
  camera.pitch=clamp(camera.pitch+event.movementY*EXPLORE_POLICY.mouseRadiansPerPixel,-Math.PI/2+EXPLORE_POLICY.pitchClearance,Math.PI/2-EXPLORE_POLICY.pitchClearance);
  camera.target=V.add(eye,V.mul(sceneCameraFrame(camera).forward,camera.distance));
  requestRender();
}
function exploreKeyDown(event:KeyboardEvent):boolean {
  if(!exploreActive)return false;
  if(event.key==='Escape'){event.preventDefault();exitExplore();return true;}
  if(event.code==='ArrowUp'||event.key==='ArrowUp'){
    event.preventDefault();exploreAdjustSpeed(1);return true;
  }
  if(event.code==='ArrowDown'||event.key==='ArrowDown'){
    event.preventDefault();exploreAdjustSpeed(-1);return true;
  }
  const key=exploreKey(event);
  if(key){event.preventDefault();exploreHeld.add(key);}
  return true; // No modeling or tool shortcuts while navigating.
}
function exploreKeyUp(event:KeyboardEvent):boolean {
  if(!exploreActive)return false;
  const key=exploreKey(event);
  if(key){event.preventDefault();exploreHeld.delete(key);}
  return true;
}
