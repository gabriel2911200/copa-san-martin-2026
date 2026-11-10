export type ShootoutOperation = { rpc: 'open_penalty_shootout' | 'manage_penalty_shootout'; args: Record<string, unknown> }
const actions = ['RECORD','CORRECT','VOID','FINISH','FINISH_MANUAL','SET_THREE','SET_FIVE']

export function loadShootoutRequest(storage: Pick<Storage,'getItem'>, matchId: string): ShootoutOperation | null {
  const raw = storage.getItem(`pending-shootout:${matchId}`)
  if (!raw) return null
  const value: unknown = JSON.parse(raw)
  if (!value || typeof value !== 'object') throw Error('Solicitud de penales inválida')
  const operation = value as ShootoutOperation
  const args = operation.args
  if (!args || typeof args !== 'object' || args.p_match_id !== matchId || typeof args.p_request_id !== 'string' || !args.p_request_id) throw Error('Solicitud de penales inválida')
  if (operation.rpc === 'open_penalty_shootout') {
    if (typeof args.p_expected_updated_at !== 'string' || !Number.isFinite(Date.parse(args.p_expected_updated_at))) throw Error('Versión de penales inválida')
  } else if (operation.rpc === 'manage_penalty_shootout') {
    if (!actions.includes(String(args.p_action)) || !Number.isInteger(args.p_expected_revision) || Number(args.p_expected_revision) < 0) throw Error('Operación de penales inválida')
  } else throw Error('Operación de penales inválida')
  return operation
}
