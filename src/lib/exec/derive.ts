import { createPublicClient, erc20Abi, http, parseUnits, type Address, type Hex, type WalletClient } from 'viem'
import { generatePrivateKey, privateKeyToAccount, type PrivateKeyAccount } from 'viem/accounts'
import { mainnet } from 'viem/chains'
import type { DeriveTicket, Quote } from '../venues/types'
import { USDC, usdcBalance } from './balances'
import {
  actionTypedData, encodeRfqExecute, encodeSetSessionKey, encodeTrade, encodeWithdrawal, inSeconds, MODULES, nonce, SCOPES, sortLegs,
  toPlain, type Action, type Direction, type RfqLeg,
} from './derive-codec'
import { bridgeToSelf } from './relay'
import type { Executor, Funding, FundingSource, FundingState, Position, SellQuote, SetupStep, Transfer, VenueSession, Withdrawal } from './types'

// Derive v3 account model: the account IS the user's wallet (no smart wallet, no Derive chain). Money sits in a
// numbered subaccount, created by the first deposit, which settles on Ethereum. One-time setup:
//   1. add money: USDC goes to a deposit address Derive gives for this wallet, on Ethereum (from Arbitrum, Base,
//      Optimism or Polygon it is moved there by Relay first); Derive sweeps it into the subaccount in minutes;
//   2. approve a session key that lives in this browser: it can place option bets, never withdraw or transfer.
// A bet buys a call spread. Small ones go on the order book as two fill-or-kill orders (the first is undone if the
// second misses); bigger than the top of book, it is one RFQ that market makers fill whole or not at all. Our
// broker code (`referral_code`) rides on every order and RFQ; it is public, not a key.

const REFERRAL = process.env.NEXT_PUBLIC_DERIVE_REFERRAL_CODE || undefined
const MANAGER = 1 // standard margin, the ETH/BTC options universe
const ETH_USDC: Address = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48'
const MIN_DEPOSIT = 10 // Derive keeps anything smaller (it goes to its security fund)
const WITHDRAW_FEE = 1 // the most Derive may charge per withdrawal, in USD
// The key lives in this browser's storage, so it is kept short-lived: a week, then one more approval.
const KEY_DAYS = 7
const LABEL = 'one sentence'
const SALE_LABEL = 'one sentence sale' // marks the two orders of a sale on the book, so My bets can pair them
const LINK = 'https://app.derive.xyz'

// Derive's REST API refuses browsers from other sites, so calls go through our pass-through route.
async function call<T>(method: string, params: object, auth?: Record<string, string>): Promise<T> {
  const r = await fetch(`/api/derive/${method}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...auth },
    body: JSON.stringify(params),
  })
  const j = await r.json().catch(() => null)
  if (!j) throw new Error(`Derive didn’t answer (${r.status})`)
  if (j.error) {
    const detail = typeof j.error.data === 'string' ? j.error.data : j.error.data ? JSON.stringify(j.error.data) : ''
    throw new Error(`Derive: ${j.error.message ?? 'error'}${detail ? ` (${detail})` : ''}`)
  }
  return j.result as T
}

// The session key this browser holds for a wallet, if any.
interface StoredKey { key: Hex; expiry: number }
const storageKey = (owner: string) => `derive-key:${owner.toLowerCase()}`
function loadKey(owner: string): StoredKey | null {
  try {
    const k = JSON.parse(localStorage.getItem(storageKey(owner)) ?? 'null') as StoredKey | null
    return k && k.expiry > Date.now() / 1000 + 3600 ? k : null
  } catch {
    return null
  }
}

// Requests signed in as someone: the timestamp, personal-signed. A session key may sign it for the wallet.
async function keyAuth(owner: string, key: PrivateKeyAccount) {
  const timestamp = Date.now().toString()
  return { 'X-DeriveWallet': owner, 'X-DeriveTimestamp': timestamp, 'X-DeriveSignature': await key.signMessage({ message: timestamp }) }
}

interface Collateral { asset_name: string; amount: string }
interface Subaccount { subaccount_id: number; manager_id: number; collaterals: Collateral[] }
interface DerivePosition {
  instrument_name: string; instrument_type: string; amount: string; average_price: string; mark_price: string; mark_value: string
}

const usdcIn = (s: Subaccount) => Number(s.collaterals.find((c) => c.asset_name === 'USDC')?.amount ?? 0)

// Read-only: the wallet's subaccounts in our margin universe, fullest first. Signed in with the stored session key,
// or with headers the wallet itself signed (when this browser has no key yet).
async function subaccounts(owner: string, auth: PrivateKeyAccount | Record<string, string>): Promise<Subaccount[]> {
  const headers = () => ('signMessage' in auth ? keyAuth(owner, auth as PrivateKeyAccount) : Promise.resolve(auth as Record<string, string>))
  const { subaccount_ids } = await call<{ subaccount_ids: number[] }>('public/get_subaccounts', { wallet: owner })
  const subs = await Promise.all(
    subaccount_ids.map(async (id) => call<Subaccount>('private/get_subaccount', { subaccount_id: id }, await headers()).catch(() => null)),
  )
  return subs.filter((s): s is Subaccount => !!s && s.manager_id === MANAGER).sort((a, b) => usdcIn(b) - usdcIn(a))
}

interface InstrumentInfo {
  base_asset_address: Address; base_asset_sub_id: string; tick_size: string; amount_step: string
  taker_fee_rate: string; base_fee: string; mark_price_fee_rate_cap: string
}
const instruments = new Map<string, Promise<InstrumentInfo>>()
function instrument(name: string) {
  let i = instruments.get(name)
  if (!i) {
    i = call('public/get_instrument', { instrument_name: name })
    i.catch(() => instruments.delete(name))
    instruments.set(name, i)
  }
  return i
}

const usd = (n: number) => `$${n.toFixed(2)}`
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))

async function open(wallet: WalletClient): Promise<VenueSession> {
  const user = wallet.account!.address
  let stored = loadKey(user)
  const sessionAccount = () => (stored ? privateKeyToAccount(stored.key) : null)

  // Typed data is only signed for the chain the wallet is on, and Derive's signing domain is Ethereum.
  async function onEthereum() {
    if ((await wallet.getChainId()) !== mainnet.id) await wallet.switchChain({ id: mainnet.id })
  }
  async function ownerAuth() {
    const timestamp = Date.now().toString()
    const signature = await wallet.signMessage({ account: wallet.account!, message: timestamp })
    return { 'X-DeriveWallet': user, 'X-DeriveTimestamp': timestamp, 'X-DeriveSignature': signature }
  }
  async function ownerSign(a: Omit<Action, 'owner' | 'signer'>) {
    const action: Action = { ...a, owner: user, signer: user }
    return { action, signature: await wallet.signTypedData({ account: wallet.account!, ...actionTypedData(action) }) }
  }

  async function state() {
    const { subaccount_ids } = await call<{ subaccount_ids: number[] }>('public/get_subaccounts', { wallet: user })
    const key = sessionAccount()
    let keyOk = false
    let subs: Subaccount[] = []
    if (key && subaccount_ids.length) {
      try {
        const { public_session_keys } = await call<{ public_session_keys: { public_session_key: string; expiry_sec: number }[] }>(
          'private/session_keys', { wallet: user }, await keyAuth(user, key),
        )
        keyOk = public_session_keys.some((k) => k.public_session_key.toLowerCase() === key.address.toLowerCase() && k.expiry_sec > Date.now() / 1000 + 3600)
        if (keyOk) subs = await subaccounts(user, key)
      } catch {
        keyOk = false
      }
    }
    return { fresh: subaccount_ids.length === 0, keyOk, sub: subs[0] ?? null, balance: subs[0] ? usdcIn(subs[0]) : null }
  }

  async function approveKey() {
    await onEthereum()
    const key = generatePrivateKey()
    const account = privateKeyToAccount(key)
    const expiry = inSeconds(KEY_DAYS * 86400)
    // Signing in first: Derive only takes the key from a signed-in wallet. Then the key itself, as a signed action.
    const auth = await ownerAuth()
    const { action, signature } = await ownerSign({
      subaccountId: 0,
      nonce: nonce(),
      module: MODULES.setSessionKey,
      data: encodeSetSessionKey(account.address, expiry, [SCOPES['trade:orderbook:option'], SCOPES['trade:rfq:option']], []),
      expiry: inSeconds(600),
    })
    await call('private/set_session_key', {
      wallet: user,
      public_session_key: account.address,
      expiry_sec: expiry,
      subaccount_ids: null,
      protocol_scopes: Object.keys(SCOPES),
      offchain_scopes: ['account_info'],
      label: LABEL,
      nonce: action.nonce,
      signer: user,
      signature,
      signature_expiry_sec: action.expiry,
    }, auth)
    stored = { key, expiry }
    localStorage.setItem(storageKey(user), JSON.stringify(stored))
  }

  const funding: Funding = {
    // Derive takes USDC on Ethereum. From the cheaper chains Relay moves it there first, straight to the deposit
    // address, so the user pays no Ethereum gas.
    async sources() {
      const relayed = await Promise.all(
        USDC.map(async ({ chainId, chainName, token }): Promise<FundingSource> => ({
          chainId, chainName, token, symbol: 'USDC', decimals: 6,
          balance: await usdcBalance(user, chainId, token),
          min: MIN_DEPOSIT + 2, // Relay's fee for delivering on Ethereum comes off first
          eta: 'about 5 minutes',
          via: 'Moved to Ethereum first',
          note: 'Derive takes USDC on Ethereum, so Relay moves it there and hands it straight to your Derive deposit address (its fee is usually under $1). You confirm twice in your wallet; no Ethereum gas needed.',
        })),
      )
      const direct: FundingSource = {
        chainId: 1, chainName: 'Ethereum', token: ETH_USDC, symbol: 'USDC', decimals: 6,
        balance: await usdcBalance(user, 1, ETH_USDC),
        min: MIN_DEPOSIT,
        eta: 'about 5 minutes',
      }
      return [direct, ...relayed].sort((x, y) => y.balance - x.balance)
    },
    async deposit(source, amount, w, progress = () => {}) {
      if (amount < source.min) throw new Error(`Derive needs at least $${MIN_DEPOSIT}; less would be lost`)
      const s = await state()
      // An existing subaccount gets topped up; otherwise the deposit opens one. Without a key in this browser the
      // account is read by signing in with the wallet, so a top-up never opens a second subaccount by mistake.
      let sub = s.sub
      if (!s.fresh && !sub) {
        progress('Sign in to Derive in your wallet, so the money goes to your existing account (no gas)')
        sub = (await subaccounts(user, await ownerAuth()))[0] ?? null
      }
      const { deposit_address } = await call<{ deposit_address: Address }>('public/register_deposit_address', {
        wallet: user,
        subaccount_id: sub?.subaccount_id ?? 0,
        manager_id: sub ? null : MANAGER,
      })
      const before = await call<{ subaccount_ids: number[] }>('public/get_subaccounts', { wallet: user })
      const since = Date.now() - 120_000
      const units = parseUnits(amount.toFixed(6), 6)
      if (source.chainId === 1) {
        progress('Confirm sending it to your Derive deposit address in your wallet')
        await w.switchChain({ id: 1 })
        const hash = await w.writeContract({
          address: ETH_USDC, abi: erc20Abi, functionName: 'transfer', args: [deposit_address, units], chain: mainnet, account: w.account!,
        })
        progress('Waiting for Ethereum to confirm…')
        const receipt = await createPublicClient({ chain: mainnet, transport: http() }).waitForTransactionReceipt({ hash })
        if (receipt.status !== 'success') throw new Error('The transfer failed on Ethereum; nothing was moved')
      } else {
        await bridgeToSelf(w, source, { chainId: 1, token: ETH_USDC }, units, progress, {
          recipient: deposit_address,
          toName: 'Ethereum',
          minOut: parseUnits(String(MIN_DEPOSIT), 6),
          of: 2,
        })
      }
      return JSON.stringify({ since, amount, subs: before.subaccount_ids.length })
    },
    // Done when Derive has credited it: a new subaccount for a first deposit, otherwise its deposit history.
    async status(id): Promise<FundingState> {
      const { since, amount, subs } = JSON.parse(id)
      const { pending_deposits } = await call<{ pending_deposits: { status: string; timestamp: number }[] }>('public/get_pending_deposits', { wallet: user })
      if (pending_deposits.some((d) => d.timestamp >= since && /fail|error|reject/i.test(d.status))) return 'failed'
      const now = await call<{ subaccount_ids: number[] }>('public/get_subaccounts', { wallet: user })
      if (now.subaccount_ids.length > subs) return 'done'
      const key = sessionAccount()
      if (!key) return 'processing'
      const { deposits } = await call<{ deposits: { amount: string; timestamp: number; batch_status: string }[] }>(
        'private/get_deposit_history', { wallet: user, start_timestamp: since }, await keyAuth(user, key),
      ).catch(() => ({ deposits: [] }))
      // A relayed deposit arrives a little short of what left the wallet.
      return deposits.some((d) => Number(d.amount) > amount * 0.9 && Number(d.amount) <= amount + 0.01 && !/error/i.test(d.batch_status)) ? 'done' : 'processing'
    },
  }

  // Withdrawals pay out to the wallet on Ethereum once Derive's next batch is proven. The wallet itself signs:
  // the session key in this browser can't withdraw.
  const withdrawal: Withdrawal = {
    targets: [{ chainId: 1, chainName: 'Ethereum', token: ETH_USDC, symbol: 'USDC' }],
    fee: WITHDRAW_FEE,
    min: WITHDRAW_FEE + 1,
    eta: 'usually under an hour',
    async withdraw(amount) {
      await onEthereum()
      const auth = await ownerAuth()
      // The wallet signs this anyway, so its sign-in reads the account even when this browser has no key.
      const sub = (await subaccounts(user, auth))[0]
      if (!sub) throw new Error('No Derive account with money in it was found')
      const s = { sub }
      const value = amount.toFixed(6)
      const { action, signature } = await ownerSign({
        subaccountId: s.sub.subaccount_id,
        nonce: nonce(),
        module: MODULES.withdrawal,
        data: encodeWithdrawal(user, value, String(WITHDRAW_FEE)),
        expiry: inSeconds(600),
      })
      const since = Date.now() - 60_000
      const { operation_id } = await call<{ operation_id?: string }>('private/withdraw', {
        subaccount_id: s.sub.subaccount_id,
        asset_name: 'USDC',
        amount_in_underlying: parseUnits(value, 6).toString(),
        max_fee_usd: String(WITHDRAW_FEE),
        force_batch: false,
        recipient: user,
        nonce: action.nonce,
        signer: user,
        signature,
        signature_expiry_sec: action.expiry,
      }, auth)
      return JSON.stringify({ since, amount, op: operation_id })
    },
    async status(id) {
      const { since, amount, op } = JSON.parse(id)
      const key = sessionAccount()
      if (!key) return 'processing'
      const { withdrawals } = await call<{ withdrawals: { operation_id: string; amount: string; fee: string; timestamp: number; batch_status: string }[] }>(
        'private/get_withdrawal_history', { wallet: user, start_timestamp: since }, await keyAuth(user, key),
      )
      // By its operation id; by amount (gross or net of the fee) only if Derive didn't return one.
      const w = op
        ? withdrawals.find((x) => x.operation_id === op)
        : withdrawals.find((x) => Math.abs(Number(x.amount) - amount) < 0.01 || Math.abs(Number(x.amount) + Number(x.fee || 0) - amount) < 0.01)
      if (!w) return 'processing'
      return /error/i.test(w.batch_status) ? 'failed' : w.batch_status === 'Settled' ? 'done' : 'processing'
    },
  }

  return {
    funding,
    withdrawal,

    async account() {
      const s = await state()
      const funds: SetupStep = {
        id: 'funds',
        label: s.fresh ? 'Add money to open your account' : 'Add money',
        detail: s.balance ? `${usd(s.balance)} available` : 'USDC from Ethereum, Arbitrum, Base, Optimism or Polygon',
        done: !s.fresh && (s.balance ?? 0) > 0,
        runnable: false,
      }
      const steps: SetupStep[] = [
        { id: 'wallet', label: 'Derive account', detail: s.fresh ? 'Opens with your first deposit' : user, done: true, runnable: false },
        ...(s.fresh ? [funds] : []),
        {
          id: 'agent',
          label: 'Allow betting from here',
          detail: 'Two signatures, no gas. It can place bets, never withdraw.',
          done: s.keyOk,
          runnable: true,
          prompt: 'Your wallet asks twice: to sign in to Derive, then to let One sentence place option bets on your Derive account for 7 days. It can’t withdraw. This doesn’t move money.',
        },
        ...(s.fresh ? [] : [funds]),
      ]
      return { address: user, balance: s.balance, steps, link: LINK }
    },

    async runStep(id) {
      if (id === 'agent') await approveKey()
    },

    async trade(q: Quote) {
      const t = q.ticket
      if (t?.venue !== 'derive') return { ok: false, message: 'This quote cannot be traded here' }
      const key = sessionAccount()
      if (!key) return { ok: false, message: 'Allow betting from here first' }
      const s = await state()
      if (!s.sub) return { ok: false, message: 'Add money to your Derive account first' }
      return placeSpread(user, key, s.sub.subaccount_id, t, s.balance ?? 0)
    },

    async sell(p, q) {
      return sellSpread(user, p, q)
    },
  }
}

// The spread as RFQ legs, always from the buyer's side: long the lower call, short the upper one. Buying it opens a
// bet; selling the same package closes it.
const spreadLegs = (lower: string, upper: string, amount: string) =>
  sortLegs([
    { instrument_name: lower, amount, direction: 'buy' as Direction },
    { instrument_name: upper, amount, direction: 'sell' as Direction },
  ])

type QuoteLeg = { instrument_name: string; amount: string; direction: Direction; price: string }
type Best = {
  best_quote: { quote_id: string; rfq_id: string; direction: Direction; legs: QuoteLeg[] } | null
  is_valid: boolean
  invalid_reason?: string | null
  estimated_fee: string
  suggested_max_fee: string
}
// What a maker's quote costs us for the package: bought legs cost, sold legs pay us. Negative when we sell.
const premiumOf = (legs: QuoteLeg[]) => legs.reduce((sum, l) => sum + (l.direction === 'buy' ? 1 : -1) * Number(l.price) * Number(l.amount), 0)

interface Priced { rfqId: string; best: Best; premium: number; fee: number }
// Why no quote was taken, in plain words: what the makers did offer, or what Derive said was wrong.
interface Missed { why: string }
const isPriced = (r: Priced | Missed): r is Priced => 'rfqId' in r

// Opens an RFQ for the package and polls for the best maker price on our side until `fits` accepts one or time
// runs out. When nothing fits, the RFQ is cancelled and the reason comes back. Nothing is traded here.
// No cost limit is sent: Derive would hide quotes over it, and we want to say what makers asked. `fits` is the limit.
async function askMakers(
  owner: Address, key: PrivateKeyAccount, sub: number, legs: ReturnType<typeof spreadLegs>, direction: Direction,
  fits: (premium: number, fee: number) => boolean, ms: number,
): Promise<Priced | Missed> {
  const rfq = await call<{ rfq_id: string }>('private/send_rfq', {
    subaccount_id: sub,
    legs,
    partial_fill_step: legs[0].amount, // the whole spread or nothing
    label: LABEL,
    ...(REFERRAL ? { referral_code: REFERRAL } : {}),
  }, await keyAuth(owner, key))
  const deadline = Date.now() + ms
  let invalid = ''
  let error = ''
  let closest: number | null = null // what we'd pay (buy) or get (sell), fees included, at the best price seen
  while (Date.now() < deadline) {
    await wait(1500)
    const b = await call<Best>('private/rfq_get_best_quote', { subaccount_id: sub, rfq_id: rfq.rfq_id, direction, legs }, await keyAuth(owner, key))
      .catch((e: Error) => { error = e.message; return null })
    // The maker takes the other side: when we buy, their quote is a "sell", and the other way round.
    if (!b?.best_quote || b.best_quote.direction === direction) continue
    if (!b.is_valid) {
      invalid = b.invalid_reason || 'Derive won’t accept it from this account'
      continue
    }
    const premium = premiumOf(b.best_quote.legs)
    const fee = Number(b.estimated_fee)
    if (fits(premium, fee)) return { rfqId: rfq.rfq_id, best: b, premium, fee }
    closest = direction === 'buy' ? premium + fee : premium - fee
  }
  await cancelRfq(owner, key, sub, rfq.rfq_id)
  const why = invalid
    ? `Derive turned the best offer down: ${invalid}.`
    : closest != null
      ? `The best offer was ${usd(closest)} with fees.`
      : error
        ? `Couldn’t read the offers (${error}).`
        : `No market maker answered in ${ms / 1000} seconds.`
  return { why }
}

const cancelRfq = async (owner: Address, key: PrivateKeyAccount, sub: number, rfqId: string) =>
  call('private/cancel_rfq', { subaccount_id: sub, rfq_id: rfqId }, await keyAuth(owner, key)).catch(() => {})

// Takes a maker's quote, signed by the session key. Returns the share of the package that filled (0 to 1).
async function takeQuote(owner: Address, key: PrivateKeyAccount, sub: number, direction: Direction, p: Priced) {
  const quote = p.best.best_quote!
  const priced: RfqLeg[] = await Promise.all(
    quote.legs.map(async (l) => {
      const i = await instrument(l.instrument_name)
      return { ...l, asset: i.base_asset_address, subId: i.base_asset_sub_id }
    }),
  )
  // The fee cap we sign, rounded up to a millionth so it always encodes (the exchange takes at most 12 places).
  const maxFee = toPlain(Math.ceil(Number(p.best.suggested_max_fee) * 1e6) / 1e6)
  const action: Action = {
    subaccountId: sub,
    nonce: nonce(),
    module: MODULES.rfq,
    data: encodeRfqExecute(direction, priced, maxFee),
    expiry: inSeconds(3600),
    owner,
    signer: key.address,
  }
  const signature = await key.signTypedData(actionTypedData(action))
  const r = await call<{ status: string; fill_pct: string; fee: string }>('private/execute_quote', {
    subaccount_id: sub,
    rfq_id: quote.rfq_id,
    quote_id: quote.quote_id,
    direction,
    legs: sortLegs(quote.legs).map(({ instrument_name, amount, direction, price }) => ({ instrument_name, amount, direction, price })),
    max_fee: maxFee,
    nonce: action.nonce,
    signer: key.address,
    signature,
    signature_expiry_sec: action.expiry,
    label: LABEL,
    ...(REFERRAL ? { referral_code: REFERRAL } : {}),
  }, await keyAuth(owner, key))
  const filled = Number(r.fill_pct)
  return { share: filled > 1 ? filled / 100 : Math.max(0, filled), fee: Number(r.fee) }
}

// ---- Orderbook path ----
// Market makers don't answer RFQs this small, but the order book often holds far more than a small bet needs.
// When both calls' top of book covers the whole amount, the spread trades there as two fill-or-kill orders: the
// leg that can be held alone goes first (the bought call), and if the second one misses, the first is undone.

interface Ticker { a: string | null; A: string | null; b: string | null; B: string | null; I: string } // ask, ask size, bid, bid size, index
const ticker = (name: string) => call<Ticker>('public/get_ticker', { instrument_name: name })

interface Book { ask: number; askSize: number; bid: number; bidSize: number; index: number }
const bookOf = (t: Ticker): Book => ({ ask: Number(t.a ?? 0), askSize: Number(t.A ?? 0), bid: Number(t.b ?? 0), bidSize: Number(t.B ?? 0), index: Number(t.I) })

// Derive's taker fee for one order: the base fee plus min(rate × index, cap × price) per contract.
const orderFee = (i: InstrumentInfo, index: number, price: number, amount: number) =>
  Number(i.base_fee) + amount * Math.min(Number(i.taker_fee_rate) * index, Number(i.mark_price_fee_rate_cap) * price)
// The per-contract fee cap we sign, the way Derive's SDK sets it (generous: the exchange charges the real fee).
function maxFeePerUnit(i: InstrumentInfo, index: number, price: number, amount: number) {
  const per = 3 * Math.max(index, price) * Number(i.taker_fee_rate) + Number(i.base_fee) / Math.max(Number(i.amount_step), amount / 1000)
  return toPlain(Math.ceil(per * 1e6) / 1e6)
}
// A price on the instrument's tick grid, rounded in the direction that keeps the order safe.
function onTick(price: number, tick: string, up: boolean) {
  const t = Number(tick)
  const n = up ? Math.ceil(price / t - 1e-9) : Math.floor(price / t + 1e-9)
  return toPlain(Math.max(t, n * t))
}

interface Fill { value: number; fee: number } // price × amount, and fees, of what traded

// One fill-or-kill limit order signed by the session key: all of `amount` at `limit` or better, or nothing.
async function fok(owner: Address, key: PrivateKeyAccount, sub: number, name: string, direction: Direction, amount: string, limit: string, index: number, label = LABEL): Promise<Fill | { error: string }> {
  const i = await instrument(name)
  const maxFee = maxFeePerUnit(i, index, Number(limit), Number(amount))
  const action: Action = {
    subaccountId: sub,
    nonce: nonce(),
    module: MODULES.trade,
    data: encodeTrade({ asset: i.base_asset_address, subId: i.base_asset_sub_id, limitPrice: limit, amount, maxFee, subaccountId: sub, isBid: direction === 'buy' }),
    expiry: inSeconds(600),
    owner,
    signer: key.address,
  }
  const signature = await key.signTypedData(actionTypedData(action))
  try {
    const r = await call<{ order: { filled_amount: string }; trades: { trade_amount: string; trade_price: string; trade_fee: string }[] }>('private/order', {
      subaccount_id: sub,
      instrument_name: name,
      direction,
      limit_price: limit,
      amount,
      max_fee: maxFee,
      nonce: action.nonce,
      signer: key.address,
      signature,
      signature_expiry_sec: action.expiry,
      order_type: 'limit',
      time_in_force: 'fok',
      label,
      ...(REFERRAL ? { referral_code: REFERRAL } : {}),
    }, await keyAuth(owner, key))
    if (Number(r.order.filled_amount) < Number(amount) - 1e-9) return { error: 'the price moved' }
    return r.trades.reduce((s, t) => ({ value: s.value + Number(t.trade_price) * Number(t.trade_amount), fee: s.fee + Number(t.trade_fee) }), { value: 0, fee: 0 })
  } catch (e) {
    return { error: (e as Error).message }
  }
}
const filled = (f: Fill | { error: string }): f is Fill => !('error' in f)

// Both calls' top of book, when each covers the whole amount; null when the spread is too big for the book.
async function bookFor(lower: string, upper: string, amount: number) {
  const [lo, hi] = (await Promise.all([ticker(lower), ticker(upper)])).map(bookOf)
  return { lo, hi, deepToBuy: lo.ask > 0 && lo.askSize >= amount && hi.bid > 0 && hi.bidSize >= amount, deepToSell: lo.bid > 0 && lo.bidSize >= amount && hi.ask > 0 && hi.askSize >= amount }
}

type Outcome = { ok: true; spent: number } | { ok: false; message: string }

// Buys the lower call at the ask, then sells the upper one no cheaper than keeps the total within `maxCost`.
async function buyOnBook(owner: Address, key: PrivateKeyAccount, sub: number, t: DeriveTicket, lo: Book, hi: Book): Promise<Outcome> {
  const n = Number(t.amount)
  const [li, ui] = await Promise.all([instrument(t.lower), instrument(t.upper)])
  const leg1 = await fok(owner, key, sub, t.lower, 'buy', t.amount, onTick(lo.ask, li.tick_size, true), lo.index)
  if (!filled(leg1)) return { ok: false, message: `The ${t.lower.split('-')[2]} call didn’t fill (${leg1.error}). Nothing was spent. Try again.` }
  // The upper call fills at the best bid; the limit only stops it selling for less than the stake allows.
  const paid = leg1.value + leg1.fee
  const least = Math.max(hi.bid * 0.9, (paid + orderFee(ui, hi.index, hi.bid, n) - t.maxCost) / n)
  const leg2 = await fok(owner, key, sub, t.upper, 'sell', t.amount, onTick(least, ui.tick_size, true), hi.index)
  if (filled(leg2)) return { ok: true, spent: paid - leg2.value + leg2.fee }
  // Undo the first leg so the user isn't left holding half a spread.
  const now = bookOf(await ticker(t.lower))
  const back = await fok(owner, key, sub, t.lower, 'sell', t.amount, onTick(Math.max(now.bid * 0.9, Number(li.tick_size)), li.tick_size, false), now.index)
  return filled(back)
    ? { ok: false, message: `The ${t.upper.split('-')[2]} call didn’t sell (${leg2.error}), so the bet was undone. Undoing it cost ${usd(paid - back.value + back.fee)}. Try again.` }
    : { ok: false, message: `The ${t.upper.split('-')[2]} call didn’t sell (${leg2.error}) and undoing the first part failed too. You hold ${t.amount} × ${t.lower} on Derive; it pays if ETH ends above $${t.lower.split('-')[2]}. Close it on app.derive.xyz if you don't want it.` }
}

// Buys back the upper call, then sells the lower one for at least what keeps the sale above `floor`.
async function sellOnBook(owner: Address, key: PrivateKeyAccount, sub: number, lower: string, upper: string, amount: string, floor: number, lo: Book, hi: Book): Promise<{ ok: true; got: number } | { ok: false; message: string }> {
  const n = Number(amount)
  const [li, ui] = await Promise.all([instrument(lower), instrument(upper)])
  const leg1 = await fok(owner, key, sub, upper, 'buy', amount, onTick(hi.ask, ui.tick_size, true), hi.index, SALE_LABEL)
  if (!filled(leg1)) return { ok: false, message: `Buying back the ${upper.split('-')[2]} call didn’t fill (${leg1.error}). Nothing was sold. Try again.` }
  const owed = leg1.value + leg1.fee
  const least = Math.max(lo.bid * 0.9, (floor + owed + orderFee(li, lo.index, lo.bid, n)) / n)
  const leg2 = await fok(owner, key, sub, lower, 'sell', amount, onTick(least, li.tick_size, true), lo.index, SALE_LABEL)
  if (filled(leg2)) return { ok: true, got: leg2.value - leg2.fee - owed }
  // Put the upper call back so the bet is whole again.
  const now = bookOf(await ticker(upper))
  const back = await fok(owner, key, sub, upper, 'sell', amount, onTick(Math.max(now.bid * 0.9, Number(ui.tick_size)), ui.tick_size, false), now.index)
  return filled(back)
    ? { ok: false, message: `The ${lower.split('-')[2]} call didn’t sell for enough (${leg2.error}), so the bet was put back as it was. That cost ${usd(owed - back.value + back.fee)}. Try again.` }
    : { ok: false, message: `The ${lower.split('-')[2]} call didn’t sell (${leg2.error}). You now hold ${amount} × ${lower} without the ${upper.split('-')[2]} cap; it still pays if ETH ends higher. Sell it on app.derive.xyz if you want out.` }
}

// A bet: on the order book when it covers the whole amount and fits the stake, otherwise one RFQ to market makers.
async function placeSpread(owner: Address, key: PrivateKeyAccount, sub: number, t: DeriveTicket, balance: number) {
  const n = Number(t.amount)
  const { lo, hi, deepToBuy } = await bookFor(t.lower, t.upper, n)
  const done = (spent: number) => ({
    ok: true,
    message: `Bought ${t.amount} × the ${t.lower.split('-')[2]}/${t.upper.split('-')[2]} call spread for ${usd(spent)}`,
    filled: { spent, payout: n * t.width },
    link: LINK,
  })
  if (deepToBuy) {
    const [li, ui] = await Promise.all([instrument(t.lower), instrument(t.upper)])
    const cost = n * (lo.ask - hi.bid) + orderFee(li, lo.index, lo.ask, n) + orderFee(ui, hi.index, hi.bid, n)
    if (cost > t.maxCost + 0.005) return { ok: false, message: `Prices moved: it costs ${usd(cost)} now, above your ${usd(t.maxCost)}. Nothing was spent. Go back for a fresh quote.` }
    // The lower call is paid in full before the upper one is sold, so the account has to cover it for a moment.
    const upfront = n * lo.ask + orderFee(li, lo.index, lo.ask, n)
    if (balance < upfront * 1.01) {
      return { ok: false, message: `This needs ${usd(upfront * 1.01)} in your Derive account for a moment (the ${t.lower.split('-')[2]} call is bought before the ${t.upper.split('-')[2]} one is sold, and the difference comes back seconds later). You have ${usd(balance)}. Add the rest or bet less. Nothing was spent.` }
    }
    const r = await buyOnBook(owner, key, sub, t, lo, hi)
    return r.ok ? done(r.spent) : r
  }
  const legs = spreadLegs(t.lower, t.upper, t.amount)
  const p = await askMakers(owner, key, sub, legs, 'buy', (premium, fee) => premium + fee <= t.maxCost + 0.005, 20_000)
  if (!isPriced(p)) return { ok: false, message: `No offer fit your ${usd(t.maxCost)}. ${p.why} Nothing was spent.` }
  const { share, fee } = await takeQuote(owner, key, sub, 'buy', p)
  if (!(share > 0)) return { ok: false, message: 'The price moved before it filled. Nothing was spent. Try again.' }
  const contracts = n * share
  return {
    ok: true,
    message: `Bought ${toPlain(contracts)} × the ${t.lower.split('-')[2]}/${t.upper.split('-')[2]} call spread for ${usd(p.premium * share + fee)}`,
    filled: { spent: p.premium * share + fee, payout: contracts * t.width },
    link: LINK,
  }
}

// A Derive bet's id carries what selling it needs: owner, subaccount and the two calls.
const betId = (owner: string, sub: number, lower: string, upper: string) => [owner, sub, lower, upper].join('|')
function parseBetId(id: string) {
  const [owner, sub, lower, upper] = id.split('|')
  return { owner: owner as Address, sub: Number(sub), lower, upper }
}

// Sales take a price no worse than this share of the one shown, since prices move before the sale is sent.
const SELL_FLOOR = 0.97

// Read-only: what selling the whole spread pays right now, after fees: from the order book when it's deep enough,
// otherwise from market makers (the RFQ it opens is cancelled again).
async function sellQuote(p: Position): Promise<SellQuote> {
  const { owner, sub, lower, upper } = parseBetId(p.id)
  const stored = loadKey(owner)
  if (!stored) throw new Error('Allow betting from here first (on the bet screen), so this browser can reach your Derive account')
  const key = privateKeyToAccount(stored.key)
  const n = p.shares
  const { lo, hi, deepToSell } = await bookFor(lower, upper, n)
  let premium: number
  let fee: number
  if (deepToSell) {
    const [li, ui] = await Promise.all([instrument(lower), instrument(upper)])
    premium = n * (lo.bid - hi.ask)
    fee = orderFee(li, lo.index, lo.bid, n) + orderFee(ui, hi.index, hi.ask, n)
  } else {
    const got = await askMakers(owner, key, sub, spreadLegs(lower, upper, toPlain(n)), 'sell', (x) => x > 0, 15_000)
    if (!isPriced(got)) throw new Error(`No one is buying this spread right now. ${got.why} Try again in a minute.`)
    await cancelRfq(owner, key, sub, got.rfqId)
    premium = got.premium
    fee = got.fee
  }
  if (premium - fee <= 0) throw new Error('Right now selling would pay nothing after fees. You can keep it until it settles.')
  const proceeds = premium - fee
  const floor = proceeds * SELL_FLOOR
  return {
    shares: n,
    proceeds,
    fees: fee,
    avgPrice: premium / n,
    limit: toPlain(Math.floor(floor * 1e6) / 1e6),
    detail: `${toPlain(n)} contracts at about ${usd(premium / n)} each`,
    note: `Prices are checked again when you confirm. It sells only if you get at least ${usd(floor)}; otherwise nothing changes.`,
  }
}

// Sells the whole spread, no lower than the floor priced in `q`: on the book when it's deep enough, else by RFQ.
async function sellSpread(owner: Address, p: Position, q: SellQuote) {
  const { owner: holder, sub, lower, upper } = parseBetId(p.id)
  if (holder.toLowerCase() !== owner.toLowerCase()) return { ok: false, message: 'This bet belongs to another wallet' }
  const stored = loadKey(owner)
  if (!stored) return { ok: false, message: 'Allow betting from here first' }
  const key = privateKeyToAccount(stored.key)
  const floor = Number(q.limit)
  const amount = toPlain(p.shares)
  const { lo, hi, deepToSell } = await bookFor(lower, upper, p.shares)
  if (deepToSell) {
    const [li, ui] = await Promise.all([instrument(lower), instrument(upper)])
    const now = p.shares * (lo.bid - hi.ask) - orderFee(li, lo.index, lo.bid, p.shares) - orderFee(ui, hi.index, hi.ask, p.shares)
    if (now < floor - 0.005) return { ok: false, message: `Prices moved: it would pay ${usd(now)} now, under ${usd(floor)}. Nothing was sold.` }
    const r = await sellOnBook(owner, key, sub, lower, upper, amount, floor, lo, hi)
    return r.ok ? { ok: true, message: `Sold for ${usd(r.got)}`, link: LINK } : r
  }
  const legs = spreadLegs(lower, upper, amount)
  const got = await askMakers(owner, key, sub, legs, 'sell', (premium, fee) => premium - fee >= floor - 0.005, 20_000)
  if (!isPriced(got)) return { ok: false, message: `No one paid at least ${usd(floor)}. ${got.why} Nothing was sold.` }
  const { share, fee } = await takeQuote(owner, key, sub, 'sell', got)
  if (!(share > 0)) return { ok: false, message: 'The price moved before it filled. Nothing was sold. Try again.' }
  return { ok: true, message: `Sold for ${usd(got.premium * share - fee)}`, link: LINK }
}

// "ETH-20261127-2500-C" → its parts.
function parseName(name: string) {
  const [asset, date, strike, kind] = name.split('-')
  return { asset, date: `${date.slice(0, 4)}-${date.slice(4, 6)}-${date.slice(6, 8)}`, strike: Number(strike), kind }
}

// A long call paired with a short call of the same subaccount, expiry and size is one bet; anything else in the
// account is left out, it wasn't placed here.
interface Leg { sub: number; name: string; amount: number }
function pairSpreads<T extends Leg>(legs: T[]): [T, T][] {
  const calls = legs.filter((l) => l.name.endsWith('-C'))
  const shorts = calls.filter((l) => l.amount < 0)
  const pairs: [T, T][] = []
  for (const l of calls.filter((x) => x.amount > 0)) {
    const lp = parseName(l.name)
    const s = shorts.find((x) => {
      const sp = parseName(x.name)
      return x.sub === l.sub && sp.asset === lp.asset && sp.date === lp.date && sp.strike > lp.strike && Math.abs(x.amount + l.amount) < 1e-9
    })
    if (!s) continue
    shorts.splice(shorts.indexOf(s), 1)
    pairs.push([l, s])
  }
  return pairs
}

function asBet(owner: string, l: Leg, s: Leg, rest: Pick<Position, 'cost' | 'value' | 'pnl' | 'status'>): Position {
  const lp = parseName(l.name)
  const sp = parseName(s.name)
  const when = new Date(`${lp.date}T08:00:00Z`).toLocaleDateString('en-US', { month: 'long', day: 'numeric', timeZone: 'UTC' })
  return {
    venue: 'derive',
    id: betId(owner, l.sub, l.name, s.name),
    title: `${lp.asset} above $${sp.strike.toLocaleString('en-US')} on ${when}`,
    outcome: 'Yes',
    shares: l.amount,
    payoutIfRight: l.amount * (sp.strike - lp.strike),
    ends: `${lp.date}T08:00:00Z`,
    link: LINK,
    ...rest,
  }
}

interface Settlement {
  subaccount_id: number; instrument_name: string; amount: string; settlement_value: string; option_settlement_pnl: string | null
}

// Read-only (with this browser's session key): open spreads, and the ones Derive has settled at expiry, as bets.
async function positions(owner: `0x${string}`): Promise<Position[]> {
  const stored = loadKey(owner)
  if (!stored) return []
  const key = privateKeyToAccount(stored.key)
  const subs = await subaccounts(owner, key)
  const [held, settled] = await Promise.all([
    Promise.all(subs.map(async (s) => (await call<{ positions: DerivePosition[] }>('private/get_positions', { subaccount_id: s.subaccount_id }, await keyAuth(owner, key)))
      .positions.filter((p) => p.instrument_type === 'option').map((p) => ({ ...p, sub: s.subaccount_id, name: p.instrument_name, amount: Number(p.amount) })))),
    call<{ settlements: Settlement[] }>('private/get_option_settlement_history', { wallet: owner }, await keyAuth(owner, key))
      .then((r) => r.settlements.map((x) => ({ ...x, sub: x.subaccount_id, name: x.instrument_name, amount: Number(x.amount) })))
      .catch(() => []),
  ])

  const live = pairSpreads(held.flat()).map(([l, s]) => {
    const cost = l.amount * (Number(l.average_price) - Number(s.average_price))
    const value = Number(l.mark_value) + Number(s.mark_value)
    return asBet(owner, l, s, { cost, value, pnl: value - cost, status: 'live' })
  })
  // At expiry each call pays its value in cash; the spread paid the sum. Derive's settlement P&L includes fees.
  const done = pairSpreads(settled).map(([l, s]) => {
    const value = Number(l.settlement_value) + Number(s.settlement_value)
    const known = l.option_settlement_pnl != null && s.option_settlement_pnl != null
    const pnl = known ? Number(l.option_settlement_pnl) + Number(s.option_settlement_pnl) : 0
    return asBet(owner, l, s, { cost: value - pnl, value, pnl, status: value > 0.005 ? 'won' : 'lost' })
  })
  return [...live, ...done, ...(await soldEarly(owner, key))]
}

interface Trade {
  rfq_id: string | null; order_id: string; label: string | null; subaccount_id: number; instrument_name: string; direction: Direction
  trade_amount: string; trade_price: string; trade_fee: string; realized_pnl: string; timestamp: number
}
// One order's (or one RFQ leg's) trades added up.
interface LegFill { id: string; rfq: string | null; label: string | null; sub: number; name: string; direction: Direction; amount: number; value: number; fee: number; pnl: number; time: number }

// Spreads sold back before expiry: the lower call sold and the upper one bought back, the same size. A sale made
// by RFQ is one RFQ with both legs; one made on the order book is two orders placed moments apart. Derive's
// realized P&L on those trades (fees included) says how it went.
async function soldEarly(owner: Address, key: PrivateKeyAccount): Promise<Position[]> {
  const trades: Trade[] = []
  for (let page = 1; page <= 5; page++) {
    const r = await call<{ trades: Trade[]; pagination: { num_pages: number } }>(
      'private/get_trade_history', { wallet: owner, from_timestamp: 0, page, page_size: 500 }, await keyAuth(owner, key),
    ).catch(() => null)
    if (!r) break
    trades.push(...r.trades)
    if (page >= r.pagination.num_pages) break
  }
  const fills = new Map<string, LegFill>()
  for (const t of trades) {
    if (!t.instrument_name.endsWith('-C')) continue
    const id = t.rfq_id ? `${t.rfq_id}:${t.instrument_name}` : t.order_id
    const f = fills.get(id) ?? { id, rfq: t.rfq_id, label: t.label, sub: t.subaccount_id, name: t.instrument_name, direction: t.direction, amount: 0, value: 0, fee: 0, pnl: 0, time: t.timestamp }
    const n = Math.abs(Number(t.trade_amount))
    f.amount += n
    f.value += n * Number(t.trade_price)
    f.fee += Number(t.trade_fee)
    f.pnl += Number(t.realized_pnl)
    f.time = Math.max(f.time, t.timestamp)
    fills.set(id, f)
  }

  // The lower call sold and a higher one of the same expiry bought back, same size and subaccount.
  const closes = (lo: LegFill, hi: LegFill) => {
    const lp = parseName(lo.name)
    const hp = parseName(hi.name)
    return lo.direction === 'sell' && hi.direction === 'buy' && lp.asset === hp.asset && lp.date === hp.date
      && lp.strike < hp.strike && lo.sub === hi.sub && Math.abs(lo.amount - hi.amount) < 1e-9
  }
  const pairs: [LegFill, LegFill][] = []
  const all = [...fills.values()]
  const byRfq = new Map<string, LegFill[]>()
  for (const f of all) if (f.rfq) byRfq.set(f.rfq, [...(byRfq.get(f.rfq) ?? []), f])
  for (const legs of byRfq.values()) {
    if (legs.length !== 2) continue
    const [lo, hi] = [...legs].sort((a, b) => parseName(a.name).strike - parseName(b.name).strike)
    if (closes(lo, hi)) pairs.push([lo, hi])
  }
  // Orderbook sales: both orders carry the sale label; the upper call is bought back first, the lower sold seconds later.
  const book = all.filter((f) => !f.rfq && f.label === SALE_LABEL).sort((a, b) => a.time - b.time)
  const used = new Set<string>()
  for (const lo of book) {
    if (lo.direction !== 'sell' || used.has(lo.id)) continue
    const hi = book.find((x) => !used.has(x.id) && x.id !== lo.id && x.time <= lo.time && lo.time - x.time < 60_000 && closes(lo, x))
    if (!hi) continue
    used.add(lo.id).add(hi.id)
    pairs.push([lo, hi])
  }

  return pairs.map(([lo, hi]) => {
    const value = lo.value - hi.value - lo.fee - hi.fee
    const pnl = lo.pnl + hi.pnl
    const bet = asBet(owner, { sub: lo.sub, name: lo.name, amount: lo.amount }, { sub: hi.sub, name: hi.name, amount: -hi.amount }, {
      cost: value - pnl, value, pnl, status: 'sold',
    })
    return { ...bet, id: `${bet.id}|sold|${lo.id}` } // the same spread can be bought and sold more than once
  })
}

// Read-only (with the session key): USDC in the user's Derive subaccounts.
async function cash(owner: `0x${string}`): Promise<number> {
  const stored = loadKey(owner)
  if (!stored) return 0
  const subs = await subaccounts(owner, privateKeyToAccount(stored.key))
  return subs.reduce((sum, s) => sum + usdcIn(s), 0)
}

// Read-only (with the session key): deposits and withdrawals, from Derive's own history.
async function history(owner: `0x${string}`): Promise<Transfer[]> {
  const stored = loadKey(owner)
  if (!stored) return []
  const key = privateKeyToAccount(stored.key)
  type Row = { operation_id: string; amount: string; fee: string; timestamp: number; batch_status: string }
  const [d, w] = await Promise.all([
    call<{ deposits: Row[] }>('private/get_deposit_history', { wallet: owner }, await keyAuth(owner, key)),
    call<{ withdrawals: Row[] }>('private/get_withdrawal_history', { wallet: owner }, await keyAuth(owner, key)),
  ])
  const state = (s: string): Transfer['status'] => (/error/i.test(s) ? 'failed' : s === 'Settled' ? 'done' : 'processing')
  return [
    ...d.deposits.map((x) => ({ kind: 'deposit' as const, x })),
    ...w.withdrawals.map((x) => ({ kind: 'withdrawal' as const, x })),
  ]
    .map(({ kind, x }): Transfer => ({
      venue: 'derive', id: x.operation_id, kind, amount: Number(x.amount), chain: 'Ethereum',
      // Deposits count once Derive credits them; withdrawals once they're paid out on Ethereum.
      status: kind === 'deposit' && !/error/i.test(x.batch_status) ? 'done' : state(x.batch_status),
      time: x.timestamp, fee: Number(x.fee) || undefined,
    }))
    .sort((a, b) => b.time - a.time)
}

export const deriveExecutor: Executor = {
  venue: 'derive',
  chainId: 1,
  open,
  positions,
  sellQuote,
  sellNote: 'Selling is signed by the key in this browser, so your wallet won’t ask anything.',
  cash,
  history,
}
