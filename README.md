# One sentence

**Bet on crypto prices. Get the best payout.**

Type what you think as one sentence:

> I think **ETH** will be above **$2,400** on **Sun 1 Nov**, and I'll put in **$10**.

One sentence asks every venue that sells that bet, translates each answer into plain words
("if you're right you get $347.86, if not you lose $10"), shows which one pays most, and lets you
place the bet from your own wallet.

It is an aggregator, not a venue. We never hold anyone's money and never take the other side of a bet:
the venues do. Your wallet signs everything, and the positions live in your own account on each venue,
so you can always see and manage them on the venue's own site too.

## Venues

| Venue | What "above X" is there | Pays | Trade from this app |
|---|---|---|---|
| [Polymarket](https://polymarket.com) | YES share in "Ethereum above ___ on <date>?" | $1 per share if right | Yes |
| [Derive](https://derive.xyz) | Call spread: buy the call below X, sell the X call | Full width above X, part of it just below | Link out (RFQ next) |
| [Hyperliquid](https://hyperliquid.xyz) (HIP-4) | YES outcome token | $1 per token if right | Yes |

Each venue decides at its own time from its own price source. Every quote shows both under **Details**,
and only quotes on the same level are compared.

## How a quote is priced

Quotes are only shown when they can actually be filled:

- **Polymarket**: we walk the live order book from the cheapest ask upwards with your stake, taker fee
  included at every price. The summary feed's "best ask" is only used to find the market, never to price it.
  If the server can't reach the order book, the browser walks it instead; if neither can, the quote is
  withdrawn rather than shown with a number we don't trust.
- **Derive**: priced from the top of the book. When the book is thinner than the bet, the quote is marked
  **Estimate** and can't be crowned "Pays most"; a real order goes through Derive's RFQ.
- **Hyperliquid**: we walk the outcome token's book. Markets that only hold placeholder quotes are skipped.

A quote that pays back no more than it costs is dropped: the market already treats the belief as true.

## Placing a bet (Polymarket)

1. **Connect** a browser wallet (MetaMask, Rabby, …).
2. **Open your Polymarket account.** It is derived from your wallet and deployed without gas through
   Polymarket's relayer. Logging into polymarket.com with the same wallet shows the same account.
3. **Allow trading.** One signature, no gas, no money moves.
4. **Add money** from your wallet: USDC on Polygon, Arbitrum, Base, Optimism or Ethereum goes through
   Polymarket's bridge and arrives as pUSD in your account, usually within minutes.
5. **Confirm the bet.** A market order that spends at most your stake and never pays more than the quoted
   price allows. Orders carry our builder code, which is how the app can earn a fee.

## Placing a bet (Hyperliquid)

Your Hyperliquid account is your wallet address. One-time setup, each step signed by your wallet on
Arbitrum and none of them moving money:

1. **Allow betting from here.** Approves a key that lives in your browser and signs orders. It can place
   bets, never withdraw. It is a named key, so it doesn't replace the one Hyperliquid's own app uses.
2. **Approve our fee.** Hyperliquid charges builder fees on outcome markets only when you sell, never when
   you buy.
3. **Add money**: USDC from Arbitrum goes through Hyperliquid's bridge and arrives in under a minute
   (minimum $5; the bridge loses anything smaller). In a standard account deposits land in perps, so the
   app offers to move what the bet needs to your spot balance.

The bet itself is an immediate-or-cancel buy of whole YES shares, capped at the last price the quote used.
Hyperliquid's minimum order is $10. Winning shares pay out automatically at settlement.

**Selling early**: any live bet in My bets can be sold before it is decided, priced against the live bids
with fees shown. On Hyperliquid this is also when our builder fee applies; if the bet was bought elsewhere,
the sale first asks for the two one-time approvals.

**My bets** reads your open and resolved positions straight from each venue with your wallet address.
Read-only, no signature.

## Architecture

```
src/
  app/
    page.tsx                  New bet / My bets
    components/               Sentence, quote cards, bet flow, My bets
    api/quotes/route.ts       GET /api/quotes?asset=ETH&level=2400&date=2026-11-01&stake=10
    api/polymarket/sign/      Signs relayer requests with the builder secret, server-side only
  lib/
    venues/                   One quote adapter per venue (server)
    exec/                     One executor per venue (browser): account, setup, funding, trade, positions
    compare.ts                Same-level comparison and the "Pays most" choice
    wallet.tsx                Injected wallet connection (viem)
```

Every venue plugs into two interfaces, so adding a venue never touches the UI:

```ts
interface Venue {                       // src/lib/venues/types.ts
  quote(belief: Belief): Promise<Quote | Unavailable>
}

interface Executor {                    // src/lib/exec/types.ts
  open(wallet: WalletClient): Promise<VenueSession>   // account, setup steps, funding, trade
  positions(owner: Address): Promise<Position[]>
  refine?(quote: Quote): Promise<VenueResult>         // re-price in the browser when needed
}
```

## Running it locally

Requires Node 20+.

```bash
npm install
cp .env.example .env.local   # then fill in your own values
npm run dev
```

Open http://localhost:3000. Quotes work without any configuration. Placing Polymarket bets needs:

| Variable | Where it comes from | Exposed to the browser |
|---|---|---|
| `NEXT_PUBLIC_POLY_BUILDER_CODE` | polymarket.com → Settings → Builder | Yes. It is public by design: it is written into every order |
| `POLY_BUILDER_API_KEY` | Builder → API keys → Create New | No |
| `POLY_BUILDER_SECRET` | same | No |
| `POLY_BUILDER_PASSPHRASE` | same | No |
| `NEXT_PUBLIC_HL_BUILDER` | Your builder address: any wallet with at least 100 USDC in Hyperliquid perps, standard mode | Yes. An address, nothing secret |
| `NEXT_PUBLIC_HL_BUILDER_FEE_PERCENT` | Your choice, up to 1 (defaults to 0.1) | Yes |

The builder secret only ever lives on the server. The browser asks `/api/polymarket/sign` to sign its
relayer requests and never sees the secret. Never prefix those three with `NEXT_PUBLIC_`, and never commit
`.env.local`.

## Deploying

The app needs a server: `/api/quotes` talks to the venues and `/api/polymarket/sign` holds the builder
secret. Any host that runs Next.js works (Vercel, Netlify, a Node server). A static host such as GitHub
Pages can't run those routes on its own.

## Status

Early and moving fast.

- Polymarket: quotes, account setup, funding, betting and My bets work.
- Derive: quotes; betting from the app (RFQ) is next.
- Hyperliquid: quotes, setup, funding from Arbitrum, betting and My bets work.
- Selling a live bet early from My bets works on Polymarket and Hyperliquid.
- Withdrawing to your own wallet from My bets: Polymarket to Base, Arbitrum, Polygon, Optimism or Ethereum (free), Hyperliquid to Arbitrum ($1 fee).
- Not yet: WalletConnect for mobile wallets,
  a light theme.

Polymarket blocks orders from some countries. The app doesn't help anyone get around a venue's
restrictions.

Built by [goodmorning](https://goodmorning.dev).
