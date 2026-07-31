import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..')
const backend=process.env.BACKEND_DIR?path.resolve(process.env.BACKEND_DIR):path.resolve(root,'../backend')
const routeFiles=['src/routes-core.js','src/routes-football.js','src/routes-competitions.js','src/routes-world-cup.js','src/routes-stadiums.js','src/routes-stadium-compliance.js','src/routes-performance.js','src/routes-influence.js'].map(f=>path.join(backend,f))
if(!routeFiles.every(fs.existsSync)){console.error('SYNC_CHECK_SKIPPED: Không tìm thấy backend ở',backend);process.exit(0)}
const backendRoutes=new Set()
for(const file of routeFiles){const text=fs.readFileSync(file,'utf8');for(const m of text.matchAll(/router\.(get|post|put|patch|delete)\(\s*['"]([^'"]+)['"]/g)){backendRoutes.add(`${m[1].toUpperCase()} ${m[2]}`)}}
const source=[]
function walk(d){for(const e of fs.readdirSync(d,{withFileTypes:true})){const f=path.join(d,e.name);e.isDirectory()?walk(f):/\.(vue|js)$/.test(e.name)&&source.push(f)}}walk(path.join(root,'src'))
const calls=[]
for(const file of source){const text=fs.readFileSync(file,'utf8');for(const m of text.matchAll(/api\.(get|post|put|patch|delete)\(\s*([`'"])([^`'"]+)/g)){let p=m[3].replace(/\$\{[^}]+\}/g,':id');p=p.replace(/\/\d+/g,'/:id');calls.push({method:m[1].toUpperCase(),path:p,file:path.relative(root,file)})}}
function normalize(p){return p.replace(/:[^/]+/g,':id')}
const normalizedBackend=new Set([...backendRoutes].map(x=>{const [m,...rest]=x.split(' ');return `${m} ${normalize(rest.join(' '))}`}))
const missing=[]
for(const c of calls){const key=`${c.method} ${normalize(c.path)}`;if(!normalizedBackend.has(key)&&!['GET /health','GET /diagnostics/integration'].includes(key))missing.push(`${key} (${c.file})`)}
if(missing.length){console.error('BACKEND_SYNC_FAILED');[...new Set(missing)].forEach(x=>console.error('-',x));process.exit(1)}
console.log(`BACKEND_SYNC_OK: ${new Set(calls.map(c=>`${c.method} ${c.path}`)).size} lệnh gọi API Frontend khớp route Backend.`)
