// Build-only source ZIP packaging. No package or runtime dependencies.
import {readFile, readdir} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {deflateRawSync} from 'node:zlib';

const SOURCE_PACKAGE_POLICY=Object.freeze({
  // Explicit inputs exclude tests, examples, installed dependencies and output
  // directories, so an archive never embeds itself on a subsequent build.
  rootFiles:['AGENTS.md','LICENSE','THIRD_PARTY_NOTICES.md','RULES.md','SOURCE-README.md','docs/NATIVE_FILE_FORMAT.md','docs/PERFORMANCE.md','package-lock.json','tsconfig.json','tsconfig.edge-feature-worker.json','tsconfig.native-open-worker.json'],
  buildFiles:['scripts/build.mjs','scripts/source-package.mjs','scripts/format-docs.mjs'],
  excludedAssets:new Set(['src/assets/lamjacraft-logo-original.png']),
  compressionLevel:9,
});
const ZIP_POLICY=Object.freeze({localHeaderBytes:30,centralHeaderBytes:46,endHeaderBytes:22,utf8Flag:0x800,deflateMethod:8,version:20,dosDate:33,maximumEntries:0xffff,maximumSize:0xffffffff,crcPolynomial:0xedb88320,crcInitial:0xffffffff});
const crcTable=Array.from({length:256},(_,value)=>{
  let crc=value;for(let bit=0;bit<8;bit++)crc=(crc>>>1)^((crc&1)?ZIP_POLICY.crcPolynomial:0);return crc>>>0;
});
function crc32(bytes){let crc=ZIP_POLICY.crcInitial;for(const byte of bytes)crc=crcTable[(crc^byte)&0xff]^(crc>>>8);return (crc^ZIP_POLICY.crcInitial)>>>0;}

// ZIP32 with UTF-8 names, raw DEFLATE and a fixed 1980-01-01 timestamp. Stable
// ordering and timestamps make unchanged source produce byte-identical ZIPs.
export function createSourceZip(entries){
  if(entries.length>ZIP_POLICY.maximumEntries)throw Error('Source archive has too many files for ZIP32.');
  const locals=[],centrals=[],names=new Set();let offset=0;
  for(const entry of [...entries].sort((a,b)=>a.name<b.name?-1:a.name>b.name?1:0)){
    if(!entry.name||entry.name.startsWith('/')||entry.name.split('/').some(part=>part==='..'||!part)||entry.name.includes('\\')||names.has(entry.name))throw Error('Source archive entry has an unsafe or duplicate name.');
    names.add(entry.name);const name=Buffer.from(entry.name,'utf8'),data=Buffer.from(entry.bytes),compressed=deflateRawSync(data,{level:SOURCE_PACKAGE_POLICY.compressionLevel}),crc=crc32(data);
    if(name.length>ZIP_POLICY.maximumEntries||Math.max(data.length,compressed.length,offset)>ZIP_POLICY.maximumSize)throw Error('Source archive entry exceeds ZIP32 limits.');
    const local=Buffer.alloc(ZIP_POLICY.localHeaderBytes);
    local.writeUInt32LE(0x04034b50,0);local.writeUInt16LE(ZIP_POLICY.version,4);local.writeUInt16LE(ZIP_POLICY.utf8Flag,6);local.writeUInt16LE(ZIP_POLICY.deflateMethod,8);local.writeUInt16LE(ZIP_POLICY.dosDate,12);local.writeUInt32LE(crc,14);local.writeUInt32LE(compressed.length,18);local.writeUInt32LE(data.length,22);local.writeUInt16LE(name.length,26);
    locals.push(local,name,compressed);
    const central=Buffer.alloc(ZIP_POLICY.centralHeaderBytes);
    central.writeUInt32LE(0x02014b50,0);central.writeUInt16LE(ZIP_POLICY.version,4);central.writeUInt16LE(ZIP_POLICY.version,6);central.writeUInt16LE(ZIP_POLICY.utf8Flag,8);central.writeUInt16LE(ZIP_POLICY.deflateMethod,10);central.writeUInt16LE(ZIP_POLICY.dosDate,14);central.writeUInt32LE(crc,16);central.writeUInt32LE(compressed.length,20);central.writeUInt32LE(data.length,24);central.writeUInt16LE(name.length,28);central.writeUInt32LE(offset,42);centrals.push(central,name);
    offset+=local.length+name.length+compressed.length;
  }
  const directory=Buffer.concat(centrals);if(offset+directory.length>ZIP_POLICY.maximumSize)throw Error('Source archive exceeds ZIP32 size limits.');
  const end=Buffer.alloc(ZIP_POLICY.endHeaderBytes);end.writeUInt32LE(0x06054b50,0);end.writeUInt16LE(entries.length,8);end.writeUInt16LE(entries.length,10);end.writeUInt32LE(directory.length,12);end.writeUInt32LE(offset,16);
  return Buffer.concat([...locals,directory,end]);
}
async function sourceFiles(root,directory){
  const out=[];
  for(const entry of await readdir(resolve(root,directory),{withFileTypes:true})){
    const relative=`${directory}/${entry.name}`;
    if(SOURCE_PACKAGE_POLICY.excludedAssets.has(relative))continue;
    if(entry.isDirectory())out.push(...await sourceFiles(root,relative));
    else if(entry.isFile())out.push(relative);
    else throw Error(`Source package input must be a regular file or directory: ${relative}`);
  }
  return out;
}
export async function buildSourcePackage(root,packageInfo){
  const files=[...SOURCE_PACKAGE_POLICY.rootFiles,...SOURCE_PACKAGE_POLICY.buildFiles,...await sourceFiles(root,'src'),...await sourceFiles(root,'public')],entries=[];
  for(const file of files)entries.push({name:file,bytes:await readFile(resolve(root,file))});
  const sourcePackage={...packageInfo,scripts:{typecheck:packageInfo.scripts.typecheck,build:packageInfo.scripts.build}};
  entries.push({name:'package.json',bytes:Buffer.from(JSON.stringify(sourcePackage,null,2)+'\n')});
  entries.push({name:'README.md',bytes:await readFile(resolve(root,'SOURCE-README.md'))});
  // Missing configured source inputs must fail the build, rather than offer a
  // source ZIP that cannot compile the application or worker.
  for(const configName of ['tsconfig.json','tsconfig.edge-feature-worker.json','tsconfig.native-open-worker.json']){
    const config=JSON.parse(await readFile(resolve(root,configName),'utf8'));
    for(const file of config.files)if(!entries.some(entry=>entry.name===file))throw Error(`Source ZIP is missing configured TypeScript input: ${file}`);
  }
  const prefix=`LamjaCraft-3D-v${packageInfo.version}-source/`,bytes=createSourceZip(entries.map(entry=>({...entry,name:prefix+entry.name})));
  return {bytes,fileName:`LamjaCraft-3D-v${packageInfo.version}-source.zip`,sha256:createHash('sha256').update(bytes).digest('hex'),fileCount:entries.length};
}
