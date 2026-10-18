import fs from 'node:fs';
import vm from 'node:vm';
import {resolve} from 'node:path';
export function createAppFixture(root,WorkerClass,overrides={}){
const noop=()=>{},classList=()=>{const names=new Set();return {add:name=>names.add(name),remove:name=>names.delete(name),contains:name=>names.has(name),toggle(name,force){const add=force===undefined?!names.has(name):force;if(add)names.add(name);else names.delete(name);return add;}};};
const shaderSources=[];
const gl=new Proxy({getShaderParameter:()=>true,getProgramParameter:()=>true,getAttribLocation:()=>0,shaderSource:(_shader,source)=>shaderSources.push(source)},{get:(target,key)=>key in target?target[key]:()=>({})});
class Element {
 constructor(id=''){Object.assign(this,{id,value:id==='projectName'?'Exchange':id==='snapStep'?'1':id==='circleSegments'?'48':'',checked:false,disabled:false,textContent:'',classList:classList(),style:{},dataset:{},children:[],open:false,width:800,height:600,tagName:'DIV'});}
 append(...items){this.children.push(...items);if(!this.value&&items[0]?.value)this.value=items[0].value;} appendChild(x){this.append(x);return x;} replaceChildren(...items){this.children=items;this.value='';} getBoundingClientRect(){return {left:0,top:0,width:800,height:600};} getContext(kind){return kind==='2d'?new Proxy({measureText:()=>({width:40})},{get:(t,k)=>t[k]||noop}):gl;}
 addEventListener(type,handler){(this.listeners??={})[type]??=[];this.listeners[type].push(handler);} removeEventListener(){} setAttribute(name,value){(this.attributes??={})[name]=String(value);} getAttribute(name){return this.attributes?.[name]??null;} focus(){} blur(){} click(){} remove(){} setPointerCapture(){} showModal(){this.open=true;} close(){this.open=false;for(const handler of this.listeners?.close||[])handler({target:this});}
}
const elements=new Map(),get=id=>{if(!elements.has(id))elements.set(id,new Element(id));return elements.get(id);};
const viewButtons=['iso','top','front','right'].map(view=>{const button=new Element();button.dataset.view=view;if(view==='iso')button.classList.add('active');return button;});
const downloads=[],document={getElementById:get,createElement:()=>new Element(),querySelectorAll:selector=>selector==='[data-view]'?viewButtons:[],querySelector:()=>null,addEventListener:noop,body:new Element(),activeElement:new Element()};
class ResizeObserver {constructor(callback){this.callback=callback;}observe(){this.callback();}}
const sandbox={console,performance,document,window:{addEventListener:noop},localStorage:{getItem:()=>null,setItem:noop},ResizeObserver,requestAnimationFrame:()=>1,cancelAnimationFrame:noop,setTimeout:(callback,delay)=>delay===0?setTimeout(callback,0):1,clearTimeout,devicePixelRatio:1,confirm:()=>true,URL:{createObjectURL:blob=>{if(blob.type!=='text/javascript')downloads.push(blob);return 'blob:test';},revokeObjectURL:noop},Blob,TextEncoder,TextDecoder,ArrayBuffer,DataView,Float32Array,structuredClone};
Object.assign(sandbox,overrides);
if(WorkerClass)sandbox.Worker=WorkerClass;
vm.createContext(sandbox);vm.runInContext('const NATIVE_OPEN_WORKER_SOURCE='+JSON.stringify(fs.readFileSync(resolve(root,'build/native-open-worker.js'),'utf8'))+';',sandbox);vm.runInContext("const EDGE_FEATURE_WORKER_SOURCE="+JSON.stringify(fs.readFileSync(resolve(root,'build/modeling-worker-bundle.js'),'utf8'))+";",sandbox);vm.runInContext(fs.readFileSync(resolve(root,'build/app.js'),'utf8'),sandbox);
return {sandbox,get,downloads,shaderSources,viewButtons};
}
