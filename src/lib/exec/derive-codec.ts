import { encodeAbiParameters, getAddress, keccak256, parseUnits, type Address, type Hex } from 'viem'

// Derive v3 signed actions (docs.derive.xyz/authentication/action-signing). Every state change (a session key,
// an RFQ execution, a withdrawal) is one EIP-712 `Action` whose `data` is ABI-encoded per module. Ported from
// Derive's own SDK (@derivexyz/derive-ts, codecs/*) so the bytes match what the exchange re-verifies.

export const CHAIN_ID = 1 // the signing domain is Ethereum mainnet; no Derive chain any more

export const MODULES = {
  trade: '0xB8D20c2B7a1Ad2EE33Bc50eF10876eD3035b5e7b',
  rfq: '0x9371352CCef6f5b36EfDFE90942fFE622Ab77F1D',
  withdrawal: '0x9d0E8f5b25384C7310CB8C6aE32C8fbeb645d083',
  setSessionKey: '0xe330CF64ff6EbF41699aad344Cb21d78db1D2bb6',
} as const satisfies Record<string, Address>

// USDC inside Derive (the protocol asset, the same on mainnet and testnet), not the ERC-20 on Ethereum.
export const PROTOCOL_USDC: Address = '0x57B03E14d409ADC7fAb6CFc44b5886CAD2D5f02b'

export const DOMAIN = {
  name: 'Matching',
  version: '1.0',
  chainId: CHAIN_ID,
  verifyingContract: '0xeB8d770ec18DB98Db922E9D83260A585b9F0DeAD',
} as const

export const ACTION_TYPES = {
  Action: [
    { name: 'subaccountId', type: 'uint256' },
    { name: 'nonce', type: 'uint256' },
    { name: 'module', type: 'address' },
    { name: 'data', type: 'bytes' },
    { name: 'expiry', type: 'uint256' },
    { name: 'owner', type: 'address' },
    { name: 'signer', type: 'address' },
  ],
} as const

export interface Action {
  subaccountId: number
  nonce: string
  module: Address
  data: Hex
  expiry: number
  owner: Address
  signer: Address
}

// What a wallet (eth_signTypedData_v4) or a local key signs for an action.
export const actionTypedData = (a: Action) => ({
  domain: DOMAIN,
  types: ACTION_TYPES,
  primaryType: 'Action' as const,
  message: {
    subaccountId: BigInt(a.subaccountId),
    nonce: BigInt(a.nonce),
    module: getAddress(a.module),
    data: a.data,
    expiry: BigInt(a.expiry),
    owner: getAddress(a.owner),
    signer: getAddress(a.signer),
  },
})

// UTC nanoseconds as a decimal string, with random sub-millisecond digits so two actions never collide.
export const nonce = (now = Date.now()) => (BigInt(now) * BigInt(1_000_000) + BigInt(Math.floor(Math.random() * 1_000_000))).toString()
export const inSeconds = (s: number) => Math.floor(Date.now() / 1000) + s

// Decimal string → e18. The exchange works at 1e12 and rejects (never rounds) finer values.
export function e18(value: string | number): bigint {
  const text = typeof value === 'number' ? toPlain(value) : value.trim()
  const n = parseUnits(text, 18)
  if (n % BigInt(1_000_000) !== BigInt(0)) throw new Error(`${value} has more than 12 decimal places`)
  return n
}
// A number as plain decimals (no 1e-7 notation), at most 12 places.
export const toPlain = (n: number) => n.toFixed(12).replace(/\.?0+$/, '')

// Protocol scope codes (SDK auth/scopes.ts) and their wire names.
export const SCOPES = { 'trade:orderbook:option': 6, 'trade:rfq:option': 10 } as const

export function encodeSetSessionKey(key: Address, expirySec: number, scopes: number[], subaccountIds: number[]): Hex {
  return encodeAbiParameters(
    [{ type: 'address' }, { type: 'uint256' }, { type: 'uint256[]' }, { type: 'uint256[]' }],
    [getAddress(key), BigInt(expirySec), scopes.map(BigInt), subaccountIds.map(BigInt)],
  )
}

export type Direction = 'buy' | 'sell'
export interface RfqLeg {
  instrument_name: string
  amount: string
  direction: Direction
  price: string
  asset: Address // base_asset_address from public/get_instrument
  subId: string // base_asset_sub_id
}

// Both sides hash the legs sorted by instrument name.
export const sortLegs = <T extends { instrument_name: string }>(legs: readonly T[]) =>
  [...legs].sort((a, b) => (a.instrument_name < b.instrument_name ? -1 : a.instrument_name > b.instrument_name ? 1 : 0))

// Taker execution: abi.encode(keccak256(abi.encode(trades[])), maxFee). `direction` is the taker's own (the
// opposite of the maker quote's); each leg's signed amount is amount × leg sign × direction sign × −1, which
// rebuilds exactly the legs the maker signed.
export function encodeRfqExecute(direction: Direction, legs: RfqLeg[], maxFee: string): Hex {
  const dir = direction === 'buy' ? BigInt(1) : BigInt(-1)
  const trades = sortLegs(legs).map((l) => {
    const amount = e18(l.amount)
    if (amount <= BigInt(0)) throw new Error(`leg amount must be positive: ${l.instrument_name}`)
    const legSign = l.direction === 'buy' ? BigInt(1) : BigInt(-1)
    return { asset: getAddress(l.asset), subId: BigInt(l.subId), price: e18(l.price), amount: amount * legSign * dir * BigInt(-1) }
  })
  const tradesAbi = [{
    type: 'tuple[]',
    components: [{ name: 'asset', type: 'address' }, { name: 'subId', type: 'uint256' }, { name: 'price', type: 'uint256' }, { name: 'amount', type: 'int256' }],
  }] as const
  const orderHash = keccak256(encodeAbiParameters(tradesAbi, [trades]))
  return encodeAbiParameters([{ type: 'bytes32' }, { type: 'uint256' }], [orderHash, e18(maxFee)])
}

// An orderbook order: seven static words (asset, subId, limitPrice, amount, maxFee per unit, recipient subaccount,
// isBid), the decimals e18-scaled. Same bytes as abi.encode of those types.
export function encodeTrade(o: { asset: Address; subId: string; limitPrice: string; amount: string; maxFee: string; subaccountId: number; isBid: boolean }): Hex {
  const amount = e18(o.amount)
  if (amount <= BigInt(0)) throw new Error('order amount must be positive')
  return encodeAbiParameters(
    [{ type: 'address' }, { type: 'uint256' }, { type: 'int256' }, { type: 'int256' }, { type: 'uint256' }, { type: 'uint256' }, { type: 'bool' }],
    [getAddress(o.asset), BigInt(o.subId), e18(o.limitPrice), amount, e18(o.maxFee), BigInt(o.subaccountId), o.isBid],
  )
}

// abi.encode(protocolAsset, maxFeeUsd e18, recipient, amount in the token's own decimals, forceBatch).
export function encodeWithdrawal(recipient: Address, amount: string, maxFeeUsd: string, forceBatch = false): Hex {
  const units = parseUnits(amount, 6)
  if (units <= BigInt(0)) throw new Error('withdrawal amount must be positive')
  return encodeAbiParameters(
    [{ type: 'address' }, { type: 'uint256' }, { type: 'address' }, { type: 'uint256' }, { type: 'bool' }],
    [PROTOCOL_USDC, e18(maxFeeUsd), getAddress(recipient), units, forceBatch],
  )
}
