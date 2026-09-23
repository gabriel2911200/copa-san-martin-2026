import { test } from 'node:test'
import assert from 'node:assert/strict'
import { penaltySlots } from '../src/lib/penalties.ts'
import type { Shootout } from '../src/lib/penalties.ts'

const state = (home: number, away: number, completed = false): Shootout => ({
  first_team_id:'a',revision:0,completed_at:completed?'done':null,next_team_id:'a',winner_team_id:null,score:{home,away},
  attempts:[...Array.from({length:home},()=>({team_id:'a'})),...Array.from({length:away},()=>({team_id:'b'}))] as Shootout['attempts'],
})
test('cinco casillas iniciales y huecos conservados tras corte anticipado',()=>{
  assert.equal(penaltySlots(state(0,0),'a','b'),5)
  assert.equal(penaltySlots(state(3,3,true),'a','b'),5)
})
test('rondas adicionales alineadas sin adelantar otro par y sin fila vacía al finalizar',()=>{
  for(const [home,away,done,expected] of [[5,5,false,6],[6,5,false,6],[6,6,false,7],[10,10,false,11],[11,10,false,11],[11,11,true,11]] as const) {
    assert.equal(penaltySlots(state(home,away,done),'a','b'),expected)
  }
})
