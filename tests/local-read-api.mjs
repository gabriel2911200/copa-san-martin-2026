// Read-only HTTP adapter over an ephemeral local database for existing browser
// smoke tests. No credentials, .env, Supabase client or remote connections.
import { createServer } from 'node:http'
import { readFile, readdir } from 'node:fs/promises'
import { PGlite } from '../.tmp-sql-check/node_modules/@electric-sql/pglite/dist/index.js'

const db = new PGlite()
await db.exec('create role anon; create role authenticated;')
await db.exec(await readFile('supabase/schema.sql','utf8'))
for (const file of (await readdir('supabase/migrations')).filter(f=>f.endsWith('.sql')).sort()) {
  await db.exec(await readFile('supabase/migrations/'+file,'utf8'))
}
await db.exec('set role anon')
const tables = new Set(['categories','teams','matchdays','matches','players'])
const columns = new Set(['id','name','category_id','matchday_id','home_team_id','away_team_id','stage','active','deleted_at','team_id','full_name','number'])
const query = async (sql,params=[]) => (await db.query(sql,params)).rows
const server=createServer(async(req,res)=>{
  res.setHeader('Access-Control-Allow-Origin','http://127.0.0.1:5175')
  res.setHeader('Access-Control-Allow-Headers','apikey,authorization,content-type,x-client-info,prefer,accept,accept-profile,content-profile')
  res.setHeader('Access-Control-Allow-Methods','GET,POST,OPTIONS')
  res.setHeader('Content-Type','application/json')
  if(req.method==='OPTIONS'){res.writeHead(204);res.end();return}
  try {
    const url=new URL(req.url,'http://127.0.0.1:59999')
    if(url.pathname==='/health'){res.end('{"local":true}');return}
    let result
    if(req.method==='GET' && url.pathname.startsWith('/rest/v1/')){
      const table=url.pathname.split('/').at(-1)
      if(!tables.has(table))throw Error('Read not allowed')
      const where=[],params=[]
      for(const [key,value] of url.searchParams){
        if(!columns.has(key))continue
        if(value==='is.null')where.push('"'+key+'" is null')
        else if(value.startsWith('eq.')){params.push(value.slice(3));where.push('"'+key+'"=$'+params.length)}
        else if(value.startsWith('in.(')){
          const slots=value.slice(4,-1).split(',').map(v=>{params.push(v.replace(/^"|"$/g,''));return '$'+params.length})
          where.push('"'+key+'" in ('+slots.join(',')+')')
        } else throw Error('Filter not supported')
      }
      const [order,direction]=(url.searchParams.get('order')??'id.asc').split('.')
      if(!columns.has(order))throw Error('Order not allowed')
      result=await query('select * from public.'+table+(where.length?' where '+where.join(' and '):'')+' order by "'+order+'" '+(direction==='desc'?'desc':'asc'),params)
      if(url.searchParams.has('limit'))result=result.slice(0,Number(url.searchParams.get('limit')))
    } else if(req.method==='POST' && url.pathname.startsWith('/rest/v1/rpc/')){
      let raw='';for await(const part of req){raw+=part;if(raw.length>10000)throw Error('Body too large')}
      const body=JSON.parse(raw||'{}'),rpc=url.pathname.split('/').at(-1)
      if(rpc==='get_tournament')result=(await query('select public.get_tournament() data'))[0].data
      else if(rpc==='get_match_control')result=(await query('select public.get_match_control($1) data',[body.p_match_id]))[0].data
      else if(rpc==='get_standings')result=await query('select * from public.get_standings($1,$2)',[body.p_category_id,body.p_include_live??true])
      else if(rpc==='get_top_scorers')result=await query('select * from public.get_top_scorers($1)',[body.p_category_id??null])
      else throw Error('Writes are disabled in the local browser API')
    } else throw Error('Writes are disabled in the local browser API')
    res.end(JSON.stringify(result))
  } catch(error){res.writeHead(400);res.end(JSON.stringify({message:error.message}))}
})
server.listen(59999,'127.0.0.1',()=>console.log('Local read-only PGlite API ready'))
server.on('upgrade',(_req,socket)=>socket.destroy()) // No remote Realtime transport.
process.on('SIGTERM',()=>{server.close();void db.close().then(()=>process.exit(0))})
