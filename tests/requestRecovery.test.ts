import { test } from 'node:test'
import assert from 'node:assert/strict'
import { loadShootoutRequest } from '../src/lib/shootoutRequest.ts'
import { loadFriendlyRequest } from '../src/lib/friendlyRequest.ts'
import { isConfirmedRejection } from '../src/lib/rpcErrors.ts'

const storage=(value:unknown)=>({getItem:()=>JSON.stringify(value)})
test('errores SQL de datos se distinguen de respuestas perdidas',()=>{
  for(const code of ['22P02','22003','23505','42501','P0001']) assert.equal(isConfirmedRejection(code),true)
  for(const code of [undefined,'','PGRST202','FETCH_ERROR','08006'])assert.equal(isConfirmedRejection(code),false)
})
test('penales: rechaza caché corrupta, RPC ajena, otro partido y revisión inválida',()=>{
  const valid={rpc:'manage_penalty_shootout',args:{p_match_id:'m',p_action:'FINISH_MANUAL',p_request_id:'r',p_expected_revision:6}}
  assert.deepEqual(loadShootoutRequest(storage(valid),'m'),valid)
  for(const invalid of [null,true,[],{rpc:'reset_tournament',args:valid.args},{...valid,args:{...valid.args,p_match_id:'other'}},{...valid,args:{...valid.args,p_expected_revision:-1}},{...valid,args:{...valid.args,p_action:'DELETE'}}]){
    assert.throws(()=>loadShootoutRequest(storage(invalid),'m'))
  }
})
test('amistoso: recupera ID y configuración; rechaza duración, equipos y agenda inválidos',()=>{
  const valid={id:'request',args:{p_category_id:'c',p_home:'h',p_away:'a',p_date:null,p_time:null,p_seconds:420,p_penalties:true}}
  assert.deepEqual(loadFriendlyRequest(storage(valid)),valid)
  for(const change of [{p_seconds:0},{p_seconds:61},{p_home:'a'},{p_time:'18:00'},{p_penalties:null}]){
    assert.throws(()=>loadFriendlyRequest(storage({...valid,args:{...valid.args,...change}})))
  }
})
