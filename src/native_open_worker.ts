// This worker belongs exclusively to native Open; it never mutates the document.
const nativeOpenWorkerScope=globalThis as unknown as {onmessage:((event:{data:{type:'start';file:Blob}|{type:'next';index:number}})=>void)|null;postMessage:(message:NativeOpenResponse)=>void};
let nativeOpenWorkerData:ProjectData|null=null;
nativeOpenWorkerScope.onmessage=async event=>{
  try{
    const request=event.data;
    if(request.type==='start'){
      nativeOpenWorkerScope.postMessage({type:'progress',progress:1,message:'Reading project file…'});
      const text=await request.file.text();nativeOpenWorkerScope.postMessage({type:'progress',progress:5,message:'Reading project structure…'});
      const data:unknown=JSON.parse(text);validateProjectHeader(data);nativeOpenWorkerData=data;
      const metadata={...nativeOpenWorkerData,objects:nativeOpenWorkerData.objects.map(x=>({kind:x?.kind,...(x?.shininess===undefined?{}:{shininess:x.shininess})}))};
      nativeOpenWorkerScope.postMessage({type:'ready',metadata});return;
    }
    const data=nativeOpenWorkerData;
    if(!data||!Number.isInteger(request.index)||request.index<0||request.index>=data.objects.length)throw Error('Invalid native Open object request.');
    const index=request.index,total=data.objects.length,label=`${index+1} of ${total}`;
    nativeOpenWorkerScope.postMessage({type:'progress',progress:10+60*index/total,message:`Checking geometry · object ${label}…`});
    const object=validateProjectObject(data.objects[index],index);
    nativeOpenWorkerScope.postMessage({type:'progress',progress:10+60*(index+.5)/total,message:`Preparing display · object ${label} · ${object.name}`});
    const mesh=solidMeshWorld(object),bounds=derivedMeshBounds(mesh),appearance=deriveSceneAppearance(mesh),snapshot=serializeObject(object);
    nativeOpenWorkerScope.postMessage({type:'object',index,prepared:{object,snapshot,mesh,bounds,appearance}});
  }catch(error){nativeOpenWorkerScope.postMessage({type:'error',message:error instanceof Error?error.message:String(error)});}
};
