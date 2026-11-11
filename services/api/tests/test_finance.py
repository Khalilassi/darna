from datetime import date
from decimal import Decimal as D

import pytest
from pydantic import ValidationError

from app.finance.engine import (
    Amount,
    Fee,
    Installment,
    RentInput,
    SaleInput,
    compute_rent,
    compute_sale,
    present_value,
)
from app.models.enums import Payer, PaymentMode, Provenance

AS_OF = date(2026, 11, 1)
sp = Provenance.seller_provided


def amt(v, prov=sp, assumption=None):
    return Amount(amount=D(v), provenance=prov, assumption=assumption)


def test_fully_paid_cash_unit():
    r = compute_sale(SaleInput(payment_mode=PaymentMode.cash, area_sqm=D("150"), owner_cash_price=amt("6000000")), AS_OF)
    assert r.initial_cash_required == D("6000000.00")
    assert r.future_liabilities == D("0.00")
    assert r.known_total_cost == D("6000000.00")
    assert r.price_per_sqm == D("40000.00")
    assert r.unconfirmed == [] and r.warnings == []
    assert r.verified_share == D("0")


def test_installment_resale_future_installments_and_premium():
    insts = [Installment(due_date=date(2027, m, 1), amount=D("100000")) for m in (1, 4, 7, 10)]
    inp = SaleInput(
        payment_mode=PaymentMode.installments, area_sqm=D("100"),
        owner_cash_price=amt("2500000"), paid_to_developer=amt("2000000"), installments=insts,
    )
    r = compute_sale(inp, AS_OF)
    assert r.initial_cash_required == D("2500000.00")
    assert r.future_liabilities == D("400000.00")
    assert r.known_total_cost == D("2900000.00")
    assert r.owner_premium == D("500000.00")
    assert r.next_installment.due_date == date(2027, 1, 1)
    assert r.final_installment_date == date(2027, 10, 1)
    assert [(b.schedule, b.year, b.count, b.total) for b in r.schedule_summary] == [("unit", 2027, 4, D("400000"))]


def test_overdue_paid_by_buyer_added_to_initial_cash():
    insts = [Installment(due_date=date(2026, 6, 1), amount=D("50000")), Installment(due_date=date(2027, 6, 1), amount=D("50000"))]
    inp = SaleInput(payment_mode=PaymentMode.installments, area_sqm=D("100"), owner_cash_price=amt("1000000"),
                    installments=insts, overdue_payer=Payer.buyer)
    r = compute_sale(inp, AS_OF)
    assert r.overdue_total == D("50000.00")
    assert r.initial_cash_required == D("1050000.00")
    assert r.future_liabilities == D("50000.00")
    assert r.known_total_cost == D("1100000.00")
    assert "overdue_installments" in r.warnings


def test_overdue_settled_by_seller_not_charged_to_buyer_but_reduces_seller_net():
    insts = [Installment(due_date=date(2026, 6, 1), amount=D("50000")), Installment(due_date=date(2027, 6, 1), amount=D("50000"))]
    inp = SaleInput(payment_mode=PaymentMode.installments, area_sqm=D("100"), owner_cash_price=amt("1000000"),
                    installments=insts, overdue_payer=Payer.seller)
    r = compute_sale(inp, AS_OF)
    assert r.initial_cash_required == D("1000000.00")
    assert r.known_total_cost == D("1050000.00")
    assert r.seller_net_known == D("950000.00")


def test_included_in_price_is_never_double_counted():
    insts = [Installment(due_date=date(2026, 6, 1), amount=D("50000")), Installment(due_date=date(2027, 6, 1), amount=D("50000"))]
    inp = SaleInput(
        payment_mode=PaymentMode.installments, area_sqm=D("100"), owner_cash_price=amt("1000000"),
        paid_to_developer=amt("700000"), installments=insts, overdue_payer=Payer.included_in_price,
        maintenance_deposit_due=amt("80000"), maintenance_payer=Payer.included_in_price,
    )
    r = compute_sale(inp, AS_OF)
    assert r.initial_cash_required == D("1000000.00")  # nothing added on top of price
    assert r.known_total_cost == D("1050000.00")
    # premium excludes amounts the price already covers: 1,000,000 - 50,000 - 80,000 - 700,000
    assert r.owner_premium == D("170000.00")
    assert r.seller_net_known == D("870000.00")
    excluded = {i.code for i in r.line_items if i.counted_in == "excluded"}
    assert {"overdue_installments", "maintenance_deposit"} <= excluded


def test_unpaid_maintenance_deposit_paid_by_buyer():
    inp = SaleInput(payment_mode=PaymentMode.cash, area_sqm=D("200"), owner_cash_price=amt("8000000"),
                    maintenance_deposit_due=amt("400000", Provenance.verified), maintenance_payer=Payer.buyer)
    r = compute_sale(inp, AS_OF)
    assert r.initial_cash_required == D("8400000.00")
    assert r.verified_share == (D("400000") / D("8400000")).quantize(D("0.0001"))


def test_multiple_schedules_grouped():
    insts = [
        Installment(due_date=date(2027, 1, 1), amount=D("100000"), schedule="unit"),
        Installment(due_date=date(2028, 1, 1), amount=D("100000"), schedule="unit"),
        Installment(due_date=date(2027, 3, 1), amount=D("20000"), schedule="garage"),
    ]
    r = compute_sale(SaleInput(payment_mode=PaymentMode.installments, area_sqm=D("120"),
                               owner_cash_price=amt("1500000"), installments=insts), AS_OF)
    assert [(b.schedule, b.year) for b in r.schedule_summary] == [("garage", 2027), ("unit", 2027), ("unit", 2028)]
    assert r.future_liabilities == D("220000.00")


def test_unknown_fee_is_unconfirmed_and_excluded():
    inp = SaleInput(payment_mode=PaymentMode.cash, area_sqm=D("100"), owner_cash_price=amt("3000000"),
                    fees=[Fee(code="transfer_fee", value=Amount(provenance=Provenance.unknown))])
    r = compute_sale(inp, AS_OF)
    assert r.known_total_cost == D("3000000.00")
    assert r.unconfirmed == ["transfer_fee"]
    assert "unconfirmed_fees" in r.warnings


def test_estimates_are_separate_and_carry_assumptions():
    inp = SaleInput(payment_mode=PaymentMode.cash, area_sqm=D("100"), owner_cash_price=amt("3000000"),
                    fees=[Fee(code="registration_tax", value=amt("75000", Provenance.estimate, "2.5% of price, rate not confirmed"))])
    r = compute_sale(inp, AS_OF)
    assert r.known_total_cost == D("3000000.00")
    assert r.estimated_extra == D("75000.00")
    assert r.total_with_estimates == D("3075000.00")
    assert r.assumptions == ["registration_tax: 2.5% of price, rate not confirmed"]


def test_split_fee():
    inp = SaleInput(payment_mode=PaymentMode.cash, area_sqm=D("100"), owner_cash_price=amt("1000000"),
                    fees=[Fee(code="transfer_fee", value=amt("30001"), payer=Payer.split, buyer_share=D("0.5"))])
    r = compute_sale(inp, AS_OF)
    buyer_part = next(i for i in r.line_items if i.code == "transfer_fee").amount
    seller_part = next(i for i in r.seller_items if i.code == "transfer_fee").amount
    assert buyer_part + seller_part == D("30001")
    assert r.initial_cash_required == D("1000000") + buyer_part


def test_seller_paid_fee_not_on_buyer():
    inp = SaleInput(payment_mode=PaymentMode.cash, area_sqm=D("100"), owner_cash_price=amt("1000000"),
                    fees=[Fee(code="transfer_fee", value=amt("20000"), payer=Payer.seller)])
    r = compute_sale(inp, AS_OF)
    assert r.initial_cash_required == D("1000000.00")
    assert r.seller_net_known == D("980000.00")


def test_price_below_paid_warns():
    inp = SaleInput(payment_mode=PaymentMode.cash, area_sqm=D("100"), owner_cash_price=amt("900000"),
                    paid_to_developer=amt("1000000"))
    r = compute_sale(inp, AS_OF)
    assert r.owner_premium == D("-100000.00")
    assert "price_below_amount_paid" in r.warnings


def test_installment_due_today_is_not_overdue():
    insts = [Installment(due_date=AS_OF, amount=D("10000"))]
    r = compute_sale(SaleInput(payment_mode=PaymentMode.installments, area_sqm=D("50"), owner_cash_price=amt("100000"),
                               installments=insts), AS_OF)
    assert r.overdue_total == D("0.00") and r.future_liabilities == D("10000.00")


@pytest.mark.parametrize(
    "kwargs",
    [
        dict(payment_mode=PaymentMode.cash, installments=[Installment(due_date=date(2027, 1, 1), amount=D("1"))]),
        dict(payment_mode=PaymentMode.installments, installments=[]),
        dict(payment_mode=PaymentMode.cash, fees=[Fee(code="a", value=amt("1")), Fee(code="a", value=amt("2"))]),
        dict(payment_mode=PaymentMode.cash, overdue_payer=Payer.split),
    ],
)
def test_invalid_sale_inputs_rejected(kwargs):
    with pytest.raises(ValidationError):
        SaleInput(area_sqm=D("100"), owner_cash_price=amt("1"), **kwargs)


def test_amount_rules():
    with pytest.raises(ValidationError):
        Amount(amount=D("1"), provenance=Provenance.unknown)
    with pytest.raises(ValidationError):
        Amount(provenance=Provenance.verified)
    with pytest.raises(ValidationError):
        Amount(amount=D("1"), provenance=Provenance.estimate)  # missing assumption
    with pytest.raises(ValidationError):
        Amount(amount=D("-1"))
    with pytest.raises(ValidationError):
        SaleInput(payment_mode=PaymentMode.cash, area_sqm=D("100"), owner_cash_price=Amount(provenance=Provenance.unknown))


def test_decimal_precision_no_float_drift():
    insts = [Installment(due_date=date(2027, 1, 1), amount=D("0.10")) for _ in range(3)]
    r = compute_sale(SaleInput(payment_mode=PaymentMode.installments, area_sqm=D("3"), owner_cash_price=amt("0.10"),
                               installments=insts), AS_OF)
    assert r.known_total_cost == D("0.40")
    assert r.price_per_sqm == D("0.13")


def test_present_value():
    insts = [Installment(due_date=date(2027, 11, 1), amount=D("110000"))]
    pv = present_value(insts, AS_OF, D("0.10"))
    assert pv.nominal_future == D("110000.00")
    assert pv.present_value == D("100000.00")
    assert "10.00%" in pv.assumption
    assert present_value(insts, AS_OF, D("0")).present_value == D("110000.00")
    with pytest.raises(ValueError):
        present_value(insts, AS_OF, D("2"))


def test_rent_basic():
    r = compute_rent(RentInput(monthly_rent=D("30000"), security_deposit_months=D("2"), advance_months=3, min_lease_months=12))
    assert r.advance_rent == D("90000.00")
    assert r.security_deposit == D("60000.00")
    assert r.move_in_cash_required == D("150000.00")
    assert r.min_term_rent_total == D("360000.00")
    assert not r.min_term_rent_assumes_increase


def test_rent_annual_increase_and_fees():
    r = compute_rent(RentInput(monthly_rent=D("10000"), min_lease_months=24, annual_increase_pct=D("10"),
                               fees=[Fee(code="club_access", value=Amount(provenance=Provenance.unknown))]))
    assert r.min_term_rent_total == D("252000.00")  # 12*10000 + 12*11000
    assert r.min_term_rent_assumes_increase
    assert r.unconfirmed == ["club_access"]
