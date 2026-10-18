// The source archive stays inert at startup. Decode only on an explicit About
// download, using the same local Blob downloader as other application exports.
function downloadEmbeddedSourceProject():void{
  try{
    const element=document.getElementById('embeddedSourceProject');
    if(!element)throw Error('This HTML file does not include its source archive.');
    const fileName=element.getAttribute('data-filename')||'',expectedBytes=Number(element.getAttribute('data-byte-length')),base64=(element.textContent||'').trim();
    if(!/^LamjaCraft-3D-v\d+\.\d+\.\d+-source\.zip$/.test(fileName)||!Number.isSafeInteger(expectedBytes)||expectedBytes<=0||!base64)throw Error('The embedded source archive metadata is invalid.');
    const binary=atob(base64);
    if(binary.length!==expectedBytes)throw Error('The embedded source archive is incomplete.');
    const bytes=Uint8Array.from(binary,character=>character.charCodeAt(0));
    download(new Blob([bytes],{type:'application/zip'}),fileName);
    toast('Source code downloaded. Tests and example models are excluded.');
  }catch(error){toast(errorMessage(error));}
}
