/** Same masking as LimeTraderSdkExchange._masked_account_id. */
export function maskAccountId(value: string): string {
  if (value.length <= 4) return "****";
  return `${value.slice(0, 2)}***${value.slice(-2)}`;
}
