# Kitchen Display System (KDS)

The kitchen screen for Restaurant Owner OS. It shows live order tickets from the sales counter, lets cooks move them through **Pending → Preparing → Ready → Picked up**, colours each ticket by how long it has waited, and runs in English, Amharic and Afaan Oromoo.

Same stack and structure as the other modules: Vite + vanilla TypeScript (strict), no UI framework, `t("English text")` translations.

## Run it

```bash
npm install
npm run dev        # demo feed: realistic board + a new order every 30–70 s
npm run build      # type-check, then build to dist/
```

To connect a real backend, copy `.env.example` to `.env.local` and set `VITE_KDS_WS_URL` (and optionally `VITE_KDS_API_URL`, `VITE_BRANCH_ID`). With no URL set, the built-in demo feed runs instead.

## How the kitchen uses it

| Action | What happens |
|---|---|
| **Start** | Pending → Preparing. Tapping the first dish on a new ticket also starts it. |
| **Tap a dish** | Marks that dish done (strike-through). The progress bar fills; "Mark ready" pulses when everything is done. |
| **Mark ready** | Preparing → Ready. All dishes are ticked, and the timer freezes at the prep time. |
| **Picked up** | The waiter or customer took it, so it leaves the board. **Recall** in the top bar brings back the last 10. |
| **Back** | Moves a ticket one step back (e.g. marked ready by mistake). Every change also gets an **Undo** toast. |

**Timers** count from when the order was placed: **green** under 10 min, **yellow** 10–20 min, **red and flashing** from 20 min. Thresholds are in `src/catalog.ts` (`URGENCY_MINUTES`). With *reduce motion* turned on in the OS, late tickets get a thick red border instead of flashing.

**Stations.** Pick Grill, Hot Kitchen, Salad or Bar to see only that station's dishes. Counts show open tickets per station. In a station view, a ticket can't be marked ready while another station still has dishes open; it shows "Waiting for Hot Kitchen, Bar" instead. "All stations" works as the expo/pass view and can always mark ready.

**Theme.** True-black dark by default; the sun/moon button switches to a light theme for bright kitchens. The choice is saved per screen, like language, station and sound.

**New orders** chime (three notes, made in code, no sound file), flash the top bar, show a toast and get a blue NEW badge for 12 s. Browsers only allow sound after a tap, so a banner asks for one tap at the start of the shift. The tab title shows the pending count, and the screen is kept awake (Wake Lock) while the board is open.

## Backend contract

Defined in `src/types.ts` (`FeedEvent`, `FeedCommand`) and implemented in `src/feed/live.ts`.

**Server → KDS** over WebSocket (`VITE_KDS_WS_URL?branch=<id>`), JSON messages:

```jsonc
{ "type": "snapshot", "tickets": [KitchenTicket, ...] }  // send on every (re)connect
{ "type": "upsert",   "ticket": KitchenTicket }           // new or changed ticket
{ "type": "remove",   "ticketId": "tk-145" }               // picked up or voided elsewhere
```

**KDS → Server** over REST (`VITE_KDS_API_URL`), each with an `Idempotency-Key` and `X-Branch-Id` header:

```
POST /kds/tickets/:id/status   { "status": "PREPARING", "at": "<iso>", "by": "<operator>" }
POST /kds/tickets/:id/item     { "itemId": "ln-3", "isCompleted": true, "at": "...", "by": "..." }
POST /kds/tickets/:id/bump     { "at": "...", "by": "..." }
POST /kds/tickets/:id/recall   { "at": "...", "by": "..." }
```

After accepting a command, the server should broadcast the result as an `upsert` (or `remove`) to every screen in the branch, so all kitchen screens stay in step.

**Ticket shape:** the spec's `KDSTicket`, extended as `KitchenTicket` with `branchId`, `startedAt` and `readyAt`. Each item is a `KitchenItem` with `menuItemId` (Admin price-book ID) and `station`.

**Behaviour you get without extra work:**
- **Optimistic updates.** The screen changes instantly. If the server refuses, the change is rolled back and a red toast says so.
- **Retries.** Network and 5xx errors retry 3 times with backoff; 4xx errors fail at once.
- **Reconnects.** The WebSocket reconnects with jittered backoff (up to 30 s) and retries right away when the device comes back online.
- **Validation.** Incoming tickets are checked at runtime; a malformed ticket is dropped and logged, so it can't break the board.
- **Escaping.** All ticket text is HTML-escaped.
- **Elapsed time.** It is always computed from `createdAt`; `elapsedMinutes` from the server is treated as a snapshot only. Keep device clocks synced (NTP).

## Files

```
src/types.ts        spec interfaces (unchanged) + extensions + feed contract
src/catalog.ts      stations, dishes (name in 3 languages + station), modifiers, staff, timing rules
src/locales.ts      UI strings in Amharic and Afaan Oromoo
src/i18n.ts         t() / tk() helpers (same as other modules)
src/store.ts        board state, filters, optimistic actions, derived values
src/feed/           demo feed, live WebSocket+REST feed, runtime validation
src/ui/             board + header, ticket card, toasts, icons
src/sound.ts        Web Audio chime
src/main.ts         rendering, per-second timer updates, tap handling, alerts
```

## Before going live

- Replace `KDS_OPERATOR` in `catalog.ts` with the signed-in user from your auth, so every status change is attributed to a person.
- Load dishes and stations from System Admin's price book and staff names from HR, instead of the static lists in `catalog.ts`. The shapes already match.
- Have native speakers on the kitchen team review the Amharic and Afaan Oromoo strings in `locales.ts` and `catalog.ts`.
- Fonts load from Google Fonts. For kitchens with unreliable internet, self-host Noto Sans Ethiopic so Amharic always renders well.
