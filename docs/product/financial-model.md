# Financial model specification

Implementation: `services/api/app/finance/engine.py` (pure, `Decimal`, deterministic).
Tests: `services/api/tests/test_finance.py`.

## Inputs (sale)
| Field | Meaning |
|---|---|
| `payment_mode` | `cash` (fully paid unit) or `installments` (buyer takes over remaining developer installments). |
| `owner_cash_price` | **Total amount the buyer pays the seller directly.** For installment resales this is what the seller has paid plus their premium. Never includes amounts the buyer will pay the developer. Required, known. |
| `paid_to_developer` | Informational: what the seller has paid so far. Used only to derive `owner_premium`. |
| `original_contract_price` | Informational. |
| `installments[]` | Remaining unpaid developer installments: `due_date`, `amount`, `schedule` (e.g. unit, garage, club), `provenance`. Due before `as_of` ⇒ **overdue**. Cash mode must have none; installment mode must have some. |
| `overdue_payer` | `seller` (default), `buyer`, or `included_in_price`. |
| `maintenance_deposit_due` | Unpaid maintenance deposit still owed to the developer; `maintenance_payer` as above. |
| `fees[]` | `code`, `value` (Amount), `payer` (`buyer`/`seller`/`split`/`included_in_price`), `buyer_share` for split. e.g. `transfer_fee`, `registration_tax`. |

Every monetary value is an **Amount** with `provenance`:
`verified` (reviewer checked a document) · `seller_provided` · `estimate` (requires `assumption` text) ·
`unknown` (no amount; listed as *unconfirmed*).

## Rules
1. `initial_cash_required` = `owner_cash_price` + buyer-borne overdue + buyer-borne known (non-estimate) maintenance and fees.
2. `future_liabilities` = sum of non-overdue installments.
3. `known_total_cost` = initial cash + future liabilities. **Estimates and unknowns are never inside it.**
4. `estimated_extra` = buyer share of estimate-provenance items; `total_with_estimates` = known + estimated; each estimate's assumption is returned in `assumptions[]`.
5. `included_in_price` items are shown, marked `excluded`, and **never added again** (double-count prevention); they reduce the seller's net and the derived premium.
6. `owner_premium` = `owner_cash_price` − included amounts − `paid_to_developer` (warning `price_below_amount_paid` if negative).
7. `price_per_sqm` = known total ÷ area.
8. `seller_net_known` = owner cash price − seller-borne known obligations.
9. `verified_share` = share of known total backed by verified amounts.
10. Rounding: half-up to 0.01 EGP on outputs only; intermediate sums are exact.

## Rentals
`move_in_cash_required` = advance months × rent + deposit (+ known buyer fees). `min_term_rent_total` applies
the stated annual increase (flagged as an assumption). Deposits are reported as refundable *per lease terms*.

## Scenario tools
`present_value()` discounts future installments at a **user-supplied** rate (ACT/365) and returns its assumption
text; exposed at `GET /listings/{id}/financials?discount_rate=`. Planned: cash-vs-installment comparison,
historical price and price/m² analytics (needs a price-history table; see backlog).

## What the platform never does
Invent developer fees, tax rates or schedules. Unknown fees appear as "not yet confirmed".
