// Execute the shipped browser-worker bundle on a real separate thread.
// VM-only transports cannot demonstrate responsiveness during synchronous kernel work.
import fs from 'node:fs';
import {resolve} from 'node:path';
import {Worker as ThreadWorker} from 'node:worker_threads';
const source=fs.readFileSync(resolve(import.meta.dirname,'../build/modeling-worker-bundle.js'),'utf8');
const bootstrap=`const {parentPort,workerData}=require('node:worker_threads');const vm=require('node:vm');
const context={console,performance,structuredClone,TextEncoder,TextDecoder,postMessage:(message,transfer)=>parentPort.postMessage(message,transfer)};
vm.createContext(context);vm.runInContext(workerData,context);parentPort.on('message',data=>context.onmessage({data}));`;
export class ModelingWorker {
 static instances=[];
 constructor(){this.onmessage=null;this.onerror=null;this.terminated=false;this.messages=[];this.thread=new ThreadWorker(bootstrap,{eval:true,workerData:source});ModelingWorker.instances.push(this);this.thread.on('message',data=>{this.messages.push(data);this.onmessage?.({data});});this.thread.on('error',error=>this.onerror?.({message:error.message}));}
 postMessage(request){this.request=request;this.thread.postMessage(request);}
 terminate(){this.terminated=true;this.closed=this.thread.terminate();}
 static async closeAll(){for(const worker of this.instances)if(!worker.terminated)worker.terminate();await Promise.all(this.instances.map(worker=>worker.closed));}
}
