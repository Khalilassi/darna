"""Property financial engine (pure, deterministic, Decimal-based).

Specification: docs/product/financial-model.md. Summary of definitions:

owner_cash_price
    Total amount the buyer pays the SELLER directly (cash resale price, or for installment resale the
    seller's paid amount plus premium). It never includes amounts paid to the developer by the buyer.
installments
    Remaining unpaid developer installments (possibly several schedules: unit, garage, club...).
    An installment whose due date is before ``as_of`` is *overdue*.
overdue_payer / maintenance_payer / fee payer
    ``buyer``           -> added to the buyer's initial cash.
    ``seller``          -> seller settles separately; deducted from seller net, not added for buyer.
    ``included_in_price`` -> already inside owner_cash_price; NEVER added again (prevents double counting).
    ``split``           -> buyer_share (0..1) to buyer, rest to seller.
Provenance
    verified / seller_provided amounts are "known". ``estimate`` amounts are reported separately and must
    carry an assumption. ``unknown`` amounts are listed as unconfirmed and excluded from all totals.

The engine never fabricates developer figures: anything not supplied is reported as unknown.
"""
from __future__ import annotations

from collections import defaultdict
from datetime import date
from decimal import ROUND_HALF_UP, Decimal
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator

from app.models.enums import Payer, PaymentMode, Provenance

CENT = Decimal("0.01")
ZERO = Decimal("0")


def q(v: Decimal) -> Decimal:
    return v.quantize(CENT, rounding=ROUND_HALF_UP)


class Amount(BaseModel):
    """A monetary value with explicit provenance."""

    model_config = ConfigDict(frozen=True)
    amount: Decimal | None = Field(default=None, ge=0, max_digits=14, decimal_places=2)
    provenance: Provenance = Provenance.seller_provided
    assumption: str | None = Field(default=None, max_length=300)

    @model_validator(mode="after")
    def _check(self) -> Amount:
        if self.provenance == Provenance.unknown and self.amount is not None:
            raise ValueError("unknown provenance must not carry an amount")
        if self.provenance != Provenance.unknown and self.amount is None:
            raise ValueError("amount is required unless provenance is 'unknown'")
        if self.provenance == Provenance.estimate and not self.assumption:
            raise ValueError("estimates must state their assumption")
        return self

    @property
    def known(self) -> bool:
        return self.provenance in (Provenance.verified, Provenance.seller_provided)


class Installment(BaseModel):
    model_config = ConfigDict(frozen=True)
    due_date: date
    amount: Decimal = Field(gt=0, max_digits=14, decimal_places=2)
    schedule: str = Field(default="unit", min_length=1, max_length=40)
    provenance: Provenance = Provenance.seller_provided


class Fee(BaseModel):
    model_config = ConfigDict(frozen=True)
    code: str = Field(min_length=1, max_length=40)  # e.g. transfer_fee, registration_tax, club_fee
    value: Amount
    payer: Payer = Payer.buyer
    buyer_share: Decimal = Field(default=Decimal("0.5"), ge=0, le=1)


class SaleInput(BaseModel):
    payment_mode: PaymentMode
    area_sqm: Decimal = Field(gt=0, max_digits=8, decimal_places=2)
    owner_cash_price: Amount
    original_contract_price: Amount | None = None
    paid_to_developer: Amount | None = None
    installments: list[Installment] = Field(default_factory=list, max_length=600)
    overdue_payer: Payer = Payer.seller
    maintenance_deposit_due: Amount | None = None  # unpaid balance owed to developer
    maintenance_payer: Payer = Payer.buyer
    fees: list[Fee] = Field(default_factory=list, max_length=30)

    @model_validator(mode="after")
    def _check(self) -> SaleInput:
        if self.owner_cash_price.amount is None:
            raise ValueError("owner_cash_price must be a known amount")
        if self.payment_mode == PaymentMode.cash and self.installments:
            raise ValueError("cash resale must not have remaining developer installments")
        if self.payment_mode == PaymentMode.installments and not self.installments:
            raise ValueError("installment resale requires the remaining installment schedule")
        codes = [f.code for f in self.fees]
        if len(codes) != len(set(codes)):
            raise ValueError("fee codes must be unique")
        if self.overdue_payer == Payer.split or self.maintenance_payer == Payer.split:
            raise ValueError("overdue and maintenance payers must be buyer, seller or included_in_price")
        return self


Timing = Literal["at_signing", "future", "unconfirmed"]


class LineItem(BaseModel):
    code: str
    amount: Decimal | None
    payer: Payer | Literal["buyer", "seller"]
    timing: Timing
    provenance: Provenance
    counted_in: Literal["known_total", "estimates", "excluded"]
    assumption: str | None = None
    note: str | None = None


class ScheduleBucket(BaseModel):
    schedule: str
    year: int
    count: int
    total: Decimal


class SaleBreakdown(BaseModel):
    payment_mode: PaymentMode
    as_of: date
    owner_cash_price: Decimal
    initial_cash_required: Decimal
    future_liabilities: Decimal
    known_total_cost: Decimal
    estimated_extra: Decimal
    total_with_estimates: Decimal
    price_per_sqm: Decimal
    overdue_total: Decimal
    owner_premium: Decimal | None
    next_installment: Installment | None
    final_installment_date: date | None
    seller_net_known: Decimal
    verified_share: Decimal  # share (0..1) of the known total backed by verified amounts
    line_items: list[LineItem]
    seller_items: list[LineItem]
    schedule_summary: list[ScheduleBucket]
    unconfirmed: list[str]
    warnings: list[str]
    assumptions: list[str]


def _share(amount: Decimal, payer: Payer, buyer_share: Decimal) -> tuple[Decimal, Decimal]:
    """Return (buyer_part, seller_part) for a payer rule."""
    if payer == Payer.buyer:
        return amount, ZERO
    if payer == Payer.split:
        b = q(amount * buyer_share)
        return b, amount - b
    return ZERO, amount  # seller or included_in_price -> borne by seller


def compute_sale(inp: SaleInput, as_of: date) -> SaleBreakdown:
    items: list[LineItem] = []
    seller_items: list[LineItem] = []
    warnings: list[str] = []
    assumptions: list[str] = []
    unconfirmed: list[str] = []

    price = inp.owner_cash_price.amount
    assert price is not None
    initial = price
    verified_known = price if inp.owner_cash_price.provenance == Provenance.verified else ZERO
    estimated = ZERO
    items.append(
        LineItem(code="owner_cash_price", amount=price, payer=Payer.buyer, timing="at_signing",
                 provenance=inp.owner_cash_price.provenance, counted_in="known_total")
    )

    overdue = [i for i in inp.installments if i.due_date < as_of]
    upcoming = sorted((i for i in inp.installments if i.due_date >= as_of), key=lambda i: i.due_date)
    overdue_total = sum((i.amount for i in overdue), ZERO)

    if overdue:
        warnings.append("overdue_installments")
        if inp.overdue_payer == Payer.buyer:
            initial += overdue_total
            verified_known += sum((i.amount for i in overdue if i.provenance == Provenance.verified), ZERO)
            items.append(LineItem(code="overdue_installments", amount=overdue_total, payer=Payer.buyer,
                                  timing="at_signing", provenance=_worst(overdue), counted_in="known_total"))
        else:
            note = "included_in_owner_cash_price" if inp.overdue_payer == Payer.included_in_price else "seller_settles_before_transfer"
            items.append(LineItem(code="overdue_installments", amount=overdue_total, payer=inp.overdue_payer,
                                  timing="at_signing", provenance=_worst(overdue), counted_in="excluded", note=note))
            seller_items.append(LineItem(code="overdue_installments", amount=overdue_total, payer="seller",
                                         timing="at_signing", provenance=_worst(overdue), counted_in="known_total"))

    future = sum((i.amount for i in upcoming), ZERO)
    if upcoming:
        verified_known += sum((i.amount for i in upcoming if i.provenance == Provenance.verified), ZERO)
        items.append(LineItem(code="future_installments", amount=future, payer=Payer.buyer, timing="future",
                              provenance=_worst(upcoming), counted_in="known_total"))

    def handle(code: str, value: Amount, payer: Payer, buyer_share: Decimal, timing: Timing = "at_signing") -> None:
        nonlocal initial, estimated, verified_known
        if value.provenance == Provenance.unknown:
            unconfirmed.append(code)
            items.append(LineItem(code=code, amount=None, payer=payer, timing="unconfirmed",
                                  provenance=value.provenance, counted_in="excluded"))
            return
        amount = value.amount
        assert amount is not None
        if payer == Payer.included_in_price:
            items.append(LineItem(code=code, amount=amount, payer=payer, timing=timing, provenance=value.provenance,
                                  counted_in="excluded", note="included_in_owner_cash_price",
                                  assumption=value.assumption))
            seller_items.append(LineItem(code=code, amount=amount, payer="seller", timing=timing,
                                         provenance=value.provenance, counted_in="known_total"))
            return
        b, s = _share(amount, payer, buyer_share)
        if value.provenance == Provenance.estimate:
            estimated += b
            assumptions.append(f"{code}: {value.assumption}")
            bucket: Literal["known_total", "estimates", "excluded"] = "estimates"
        else:
            initial += b
            if value.provenance == Provenance.verified:
                verified_known += b
            bucket = "known_total"
        if b:
            items.append(LineItem(code=code, amount=b, payer=Payer.buyer, timing=timing, provenance=value.provenance,
                                  counted_in=bucket, assumption=value.assumption))
        if s:
            seller_items.append(LineItem(code=code, amount=s, payer="seller", timing=timing,
                                         provenance=value.provenance,
                                         counted_in="estimates" if value.provenance == Provenance.estimate else "known_total",
                                         assumption=value.assumption))

    if inp.maintenance_deposit_due is not None:
        handle("maintenance_deposit", inp.maintenance_deposit_due, inp.maintenance_payer, Decimal("1"))
    for fee in inp.fees:
        handle(fee.code, fee.value, fee.payer, fee.buyer_share)

    if unconfirmed:
        warnings.append("unconfirmed_fees")
    if estimated:
        warnings.append("contains_estimates")

    known_total = initial + future
    seller_known_obligations = sum((i.amount or ZERO for i in seller_items if i.counted_in == "known_total"), ZERO)

    premium = None
    if inp.paid_to_developer and inp.paid_to_developer.amount is not None:
        included = sum((i.amount or ZERO for i in items if i.note == "included_in_owner_cash_price"), ZERO)
        premium = price - included - inp.paid_to_developer.amount
        if premium < 0:
            warnings.append("price_below_amount_paid")

    buckets: dict[tuple[str, int], list[Decimal]] = defaultdict(list)
    for i in upcoming:
        buckets[(i.schedule, i.due_date.year)].append(i.amount)
    summary = [ScheduleBucket(schedule=s, year=y, count=len(v), total=sum(v, ZERO)) for (s, y), v in sorted(buckets.items())]

    return SaleBreakdown(
        payment_mode=inp.payment_mode,
        as_of=as_of,
        owner_cash_price=q(price),
        initial_cash_required=q(initial),
        future_liabilities=q(future),
        known_total_cost=q(known_total),
        estimated_extra=q(estimated),
        total_with_estimates=q(known_total + estimated),
        price_per_sqm=q(known_total / inp.area_sqm),
        overdue_total=q(overdue_total),
        owner_premium=q(premium) if premium is not None else None,
        next_installment=upcoming[0] if upcoming else None,
        final_installment_date=upcoming[-1].due_date if upcoming else None,
        seller_net_known=q(price - seller_known_obligations),
        verified_share=(verified_known / known_total).quantize(Decimal("0.0001")) if known_total else ZERO,
        line_items=items,
        seller_items=seller_items,
        schedule_summary=summary,
        unconfirmed=unconfirmed,
        warnings=warnings,
        assumptions=assumptions,
    )


def _worst(insts: list[Installment]) -> Provenance:
    order = [Provenance.unknown, Provenance.estimate, Provenance.seller_provided, Provenance.verified]
    return min((i.provenance for i in insts), key=order.index)


# --------------------------------------------------------------------------- present value (scenario tool)
class PresentValue(BaseModel):
    annual_discount_rate: Decimal
    nominal_future: Decimal
    present_value: Decimal
    saving_vs_nominal: Decimal
    assumption: str


def present_value(installments: list[Installment], as_of: date, annual_rate: Decimal, lang: str = "en") -> PresentValue:
    """Discount future installments at a user-supplied annual rate (daily compounding, ACT/365).

    This is a scenario estimate, never a statement of fact; the assumption is returned with it.
    """
    if annual_rate < 0 or annual_rate > 1:
        raise ValueError("annual_rate must be between 0 and 1")
    nominal = ZERO
    pv = ZERO
    for i in installments:
        if i.due_date < as_of:
            continue
        nominal += i.amount
        years = Decimal((i.due_date - as_of).days) / Decimal(365)
        factor = (Decimal(1) + annual_rate) ** years if years else Decimal(1)
        pv += i.amount / factor
    return PresentValue(
        annual_discount_rate=annual_rate,
        nominal_future=q(nominal),
        present_value=q(pv),
        saving_vs_nominal=q(nominal - pv),
        assumption=(
            f"الأقساط المستقبلية مخصومة بمعدل {annual_rate * 100:.2f}% سنويًا (معدل اخترته أنت)، بحساب الأيام على أساس 365 يومًا. "
            "الأقساط المتأخرة غير مشمولة."
            if lang == "ar" else
            f"Future installments discounted at {annual_rate * 100:.2f}% per year (user-supplied rate), "
            "annual compounding by day count/365. Overdue installments are excluded."
        ),
    )


# --------------------------------------------------------------------------- rentals
class RentInput(BaseModel):
    monthly_rent: Decimal = Field(gt=0, max_digits=12, decimal_places=2)
    security_deposit_months: Decimal = Field(default=Decimal("1"), ge=0, le=12)
    advance_months: int = Field(default=1, ge=1, le=12)
    min_lease_months: int = Field(default=12, ge=1, le=120)
    furnished: bool = False
    utilities_included: bool = False
    annual_increase_pct: Decimal | None = Field(default=None, ge=0, le=100)
    available_from: date | None = None
    fees: list[Fee] = Field(default_factory=list, max_length=10)


class RentBreakdown(BaseModel):
    monthly_rent: Decimal
    security_deposit: Decimal
    advance_rent: Decimal
    move_in_cash_required: Decimal
    min_term_rent_total: Decimal
    min_term_rent_assumes_increase: bool
    refundable: Decimal
    line_items: list[LineItem]
    unconfirmed: list[str]
    assumptions: list[str]
    warnings: list[str]


def compute_rent(inp: RentInput) -> RentBreakdown:
    rent = inp.monthly_rent
    deposit = q(rent * inp.security_deposit_months)
    advance = q(rent * inp.advance_months)
    items = [
        LineItem(code="advance_rent", amount=advance, payer=Payer.buyer, timing="at_signing",
                 provenance=Provenance.seller_provided, counted_in="known_total"),
        LineItem(code="security_deposit", amount=deposit, payer=Payer.buyer, timing="at_signing",
                 provenance=Provenance.seller_provided, counted_in="known_total", note="refundable_per_lease_terms"),
    ]
    move_in = advance + deposit
    assumptions: list[str] = []
    unconfirmed: list[str] = []
    for fee in inp.fees:
        if fee.value.provenance == Provenance.unknown:
            unconfirmed.append(fee.code)
            items.append(LineItem(code=fee.code, amount=None, payer=fee.payer, timing="unconfirmed",
                                  provenance=fee.value.provenance, counted_in="excluded"))
            continue
        b, _ = _share(fee.value.amount or ZERO, fee.payer, fee.buyer_share)
        if fee.value.provenance == Provenance.estimate:
            assumptions.append(f"{fee.code}: {fee.value.assumption}")
            items.append(LineItem(code=fee.code, amount=b, payer=Payer.buyer, timing="at_signing",
                                  provenance=fee.value.provenance, counted_in="estimates", assumption=fee.value.assumption))
        elif b:
            move_in += b
            items.append(LineItem(code=fee.code, amount=b, payer=Payer.buyer, timing="at_signing",
                                  provenance=fee.value.provenance, counted_in="known_total"))

    total = ZERO
    current = rent
    for m in range(inp.min_lease_months):
        if m and m % 12 == 0 and inp.annual_increase_pct:
            current = q(current * (Decimal(1) + inp.annual_increase_pct / Decimal(100)))
        total += current
    increases = bool(inp.annual_increase_pct) and inp.min_lease_months > 12
    if increases:
        assumptions.append(f"min_term_rent_total applies the stated {inp.annual_increase_pct}% annual increase")
    return RentBreakdown(
        monthly_rent=q(rent),
        security_deposit=deposit,
        advance_rent=advance,
        move_in_cash_required=q(move_in),
        min_term_rent_total=q(total),
        min_term_rent_assumes_increase=increases,
        refundable=deposit,
        line_items=items,
        unconfirmed=unconfirmed,
        assumptions=assumptions,
        warnings=["unconfirmed_fees"] if unconfirmed else [],
    )


# --------------------------------------------------------------------------- cash vs installments
class CashComparison(BaseModel):
    annual_discount_rate: Decimal
    initial_cash: Decimal
    future_nominal: Decimal
    future_present_value: Decimal
    nominal_total: Decimal
    present_value_total: Decimal
    # The all-cash price that would cost the same as this installment plan in today's money.
    break_even_cash_price: Decimal
    cash_alternative: Decimal | None
    cheaper_option: Literal["installments", "cash", "equal"] | None
    present_value_difference: Decimal | None  # cash_alternative - present_value_total
    excludes_estimates_and_unknowns: bool
    assumption: str


def compare_cash_vs_installments(
    inp: SaleInput, as_of: date, annual_rate: Decimal, cash_alternative: Decimal | None = None, lang: str = "en"
) -> CashComparison:
    """Compare paying this listing's installment plan with paying a single cash amount today.

    Uses known amounts only (estimates and unconfirmed fees are excluded on both sides, so they do not
    change which option is cheaper unless they differ between options — they don't here).
    """
    breakdown = compute_sale(inp, as_of)
    pv = present_value(inp.installments, as_of, annual_rate, lang)
    pv_total = breakdown.initial_cash_required + pv.present_value
    cheaper = diff = None
    if cash_alternative is not None:
        diff = q(cash_alternative - pv_total)
        cheaper = "equal" if diff == 0 else ("installments" if diff > 0 else "cash")
    return CashComparison(
        annual_discount_rate=annual_rate,
        initial_cash=breakdown.initial_cash_required,
        future_nominal=pv.nominal_future,
        future_present_value=pv.present_value,
        nominal_total=breakdown.known_total_cost,
        present_value_total=q(pv_total),
        break_even_cash_price=q(pv_total),
        cash_alternative=q(cash_alternative) if cash_alternative is not None else None,
        cheaper_option=cheaper,
        present_value_difference=diff,
        excludes_estimates_and_unknowns=bool(breakdown.estimated_extra or breakdown.unconfirmed),
        assumption=(
            f"الأقساط المستقبلية مخصومة بمعدل {annual_rate * 100:.2f}% سنويًا (معدل اخترته أنت، مثل ما يمكن أن تكسبه أموالك "
            "أو تكلفة الاقتراض). دفع سعر التعادل نقدًا اليوم يكلف نفس تكلفة خطة الأقساط بقيمة أموال اليوم. "
            "المبالغ المعروفة فقط؛ التقديرات والرسوم غير المؤكدة غير مشمولة."
            if lang == "ar" else
            f"Future installments are discounted at {annual_rate * 100:.2f}% per year (a rate you chose, e.g. what your "
            "money could earn or what borrowing costs you). Paying the break-even cash price today costs the same as the "
            "installment plan in today's money. Known amounts only; estimates and unconfirmed fees are not included."
        ),
    )
