// PostgreSQL data, constraint, business-rule and permission rejections are
// confirmed rollbacks. Transport failures retain the original retry intention.
export function isConfirmedRejection(code?:string) {
  return code==='P0001'||code==='42501'||!!code?.startsWith('22')||!!code?.startsWith('23')
}
