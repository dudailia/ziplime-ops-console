#!/usr/bin/env python3
"""Generate the console's seed dry-run files by running the real ziplime engine.

Every line in data/seed/dryruns/*.jsonl is written by
LimeTraderSdkExchange._write_dry_run_record (ziplime, branch
feat/dry-run-orders), driven the way tests/exchanges/test_lime_dry_run.py
drives it: a dry-run exchange on top of the test suite's FakeAsyncLimeClient,
so no network, no credentials, no live trading.

What this script supplies:
  * order intents (symbol, signed amount, market or limit, bar time) from a
    seeded RNG per deployment, so the same seed gives the same files;
  * a risk profile per deployment, set as ZIPLIME_* environment variables
    before the exchange is built (the engine snapshots them at construction);
  * scenarios through the fake client's own knobs: validation_response for
    broker rejections, market.quotes for market-order pricing;
  * a simulated wall clock. The exchange module's `datetime` is replaced by a
    shim whose now() returns the simulated bar time plus a small lag. Without
    it every recorded_at would be the generation time, cancels would have no
    place on the session clock, and the order-deadline scenario could not run.
    Nothing else in the engine is patched.

Run it with ziplime's own virtualenv; nothing is installed or written there:

    PYTHONDONTWRITEBYTECODE=1 ../ziplime/.venv/bin/python scripts/generate_seed.py
"""

from __future__ import annotations

import asyncio
import datetime
import heapq
import json
import math
import os
import random
import subprocess
import sys
import types
from dataclasses import dataclass, field
from pathlib import Path
from typing import Callable
from zoneinfo import ZoneInfo

ROOT = Path(__file__).resolve().parent.parent
ZIPLIME = (ROOT.parent / "ziplime").resolve()
OUT = ROOT / "data" / "seed"
DRYRUNS = OUT / "dryruns"

if not (ZIPLIME / "ziplime" / "exchanges" / "lime_trader_sdk").is_dir():
    sys.exit(f"ziplime checkout not found at {ZIPLIME}")
sys.path.insert(0, str(ZIPLIME))

from lime_trader.models.trading import ValidateOrderResponse  # noqa: E402

from ziplime.exchanges.lime_trader_sdk import (  # noqa: E402
    lime_trader_sdk_exchange as exchange_module,
)
from ziplime.exchanges.lime_trader_sdk.lime_trader_sdk_exchange import (  # noqa: E402
    LimeTraderSdkExchange,
)
from ziplime.finance.domain.order import Order  # noqa: E402
from ziplime.finance.domain.order_status import OrderStatus  # noqa: E402
from ziplime.finance.execution import LimitOrder, MarketOrder  # noqa: E402
from ziplime.utils.calendar_utils import get_calendar  # noqa: E402

from tests.exchanges.test_lime_trader_sdk_exchange import (  # noqa: E402
    FakeAssetService,
    FakeAsyncLimeClient,
    _asset,
    _balance,
    _market_quote,
)

UTC = datetime.timezone.utc
ET = ZoneInfo("America/New_York")
AS_OF = datetime.date(2026, 10, 12)
SESSION_COUNT = 10
FIRST_BAR = 9 * 60 + 31
LAST_BAR = 15 * 60 + 59

RISK_VARS = (
    "ZIPLIME_REQUIRE_ORDER_RISK_LIMITS",
    "ZIPLIME_ALLOWED_SYMBOLS",
    "ZIPLIME_ALLOW_SELL",
    "ZIPLIME_MAX_ORDER_QUANTITY",
    "ZIPLIME_MAX_ORDER_NOTIONAL_USD",
    "ZIPLIME_MAX_ORDERS_PER_INVOCATION",
    "ZIPLIME_ORDER_DEADLINE_UTC",
)


# ---------------------------------------------------------------------------
# Simulated wall clock
# ---------------------------------------------------------------------------
class SimulatedClock:
    """Wall clock for the exchange module. Each read moves it forward a little,
    as a real clock would between two writes."""

    def __init__(self) -> None:
        self._now = datetime.datetime(2000, 1, 1, tzinfo=UTC)
        self._rng = random.Random(0)

    def reset(self, rng: random.Random) -> None:
        self._rng = rng

    def set(self, moment: datetime.datetime) -> None:
        self._now = moment.astimezone(UTC)

    def read(self) -> datetime.datetime:
        self._now += datetime.timedelta(microseconds=self._rng.randint(150, 900))
        return self._now


CLOCK = SimulatedClock()


class _ClockedDatetime(datetime.datetime):
    @classmethod
    def now(cls, tz=None):  # noqa: D102 - mirrors datetime.datetime.now
        current = CLOCK.read()
        if tz is None:
            return current.replace(tzinfo=None)
        return current.astimezone(tz)


def install_clock() -> None:
    shim = types.ModuleType("datetime")
    for name in dir(datetime):
        if not name.startswith("__"):
            setattr(shim, name, getattr(datetime, name))
    shim.datetime = _ClockedDatetime
    exchange_module.datetime = shim


class QuietLogger:
    """The exchange logs every order through structlog; keep the output clean."""

    def __getattr__(self, _name):
        return lambda *args, **kwargs: None


# ---------------------------------------------------------------------------
# Deployments
# ---------------------------------------------------------------------------
def fail_closed(
    *, max_quantity: int, max_notional: int, max_orders: int, allowed: list[str] | None = None
) -> dict[str, str]:
    """The engine's fail-closed risk profile. Sells must be off: the engine
    refuses to start with ZIPLIME_ALLOW_SELL=true under this profile."""
    env = {
        "ZIPLIME_REQUIRE_ORDER_RISK_LIMITS": "true",
        "ZIPLIME_ALLOW_SELL": "false",
        "ZIPLIME_MAX_ORDER_QUANTITY": str(max_quantity),
        "ZIPLIME_MAX_ORDER_NOTIONAL_USD": str(max_notional),
        "ZIPLIME_MAX_ORDERS_PER_INVOCATION": str(max_orders),
    }
    if allowed:
        env["ZIPLIME_ALLOWED_SYMBOLS"] = ",".join(allowed)
    return env


@dataclass(frozen=True)
class Intent:
    minute: int
    symbol: str
    amount: float
    style: str  # "market" | "limit"
    cancel_after: int | None = None


@dataclass
class Deployment:
    id: str
    account: str
    strategy: str
    description: str
    seed: int
    symbols: dict[str, float]
    risk: dict[str, str] | None
    validate_orders: bool = True
    orders_per_session: tuple[int, int] = (3, 5)
    quantity: tuple[int, int] = (5, 30)
    limit_share: float = 0.7
    cancel_share: float = 0.1
    # Probability that an intent asks for a fraction of a share (a skip).
    sub_lot_share: float = 0.0
    # Probability that a whole-share intent carries a fractional remainder,
    # which the engine rounds toward zero before sending.
    remainder_share: float = 0.0
    sell_share: Callable[[int], float] = lambda _i: 0.0
    # Symbols the strategy trades outside its core list.
    extra_symbols: dict[str, float] = field(default_factory=dict)
    extra_share: float = 0.0
    # Extra intents on given session indexes (busy days).
    bursts: dict[int, int] = field(default_factory=dict)
    # Broker validation: return a rejection message, or None for valid.
    broker_check: Callable[[int, Intent, float], str | None] = lambda _i, _o, _p: None
    # Session index -> symbols with no current quote.
    missing_quotes: dict[int, set[str]] = field(default_factory=dict)
    # Session index -> deadline as minutes after midnight ET.
    deadlines: dict[int, int] = field(default_factory=dict)
    # Session index -> minute at which the strategy cancels a broker order this
    # run never placed (left over from an earlier run).
    foreign_cancels: dict[int, int] = field(default_factory=dict)
    # Session indexes the deployment ran. Default: all.
    active_sessions: range | None = None


def buying_power_check(limit_usd: float) -> Callable[[int, Intent, float], str | None]:
    def check(_index: int, intent: Intent, price: float) -> str | None:
        if intent.amount > 0 and intent.amount * price > limit_usd:
            return "insufficient buying power"
        return None

    return check


def one_off_rejection(session: int, symbol: str, message: str):
    fired: set[int] = set()

    def check(index: int, intent: Intent, _price: float) -> str | None:
        if index == session and intent.symbol == symbol and index not in fired:
            fired.add(index)
            return message
        return None

    return check


DEPLOYMENTS: list[Deployment] = [
    Deployment(
        id="harbor-momentum",
        account="harbor-lane",
        strategy="Large-cap momentum",
        description="Buys strength in four liquid names with limit orders.",
        seed=101,
        symbols={"SPY": 571.2, "QQQ": 489.4, "AAPL": 227.4, "MSFT": 418.1},
        risk=fail_closed(max_quantity=100, max_notional=25000, max_orders=8,
                         allowed=["SPY", "QQQ", "AAPL", "MSFT"]),
        orders_per_session=(3, 5),
        quantity=(5, 40),
        limit_share=0.85,
        cancel_share=0.15,
    ),
    Deployment(
        id="harbor-etf-core",
        account="harbor-lane",
        strategy="ETF core allocation",
        description="Adds to a four-ETF core once or twice a day.",
        seed=102,
        symbols={"SPY": 571.2, "IWM": 221.6, "TLT": 92.3, "GLD": 243.8},
        risk=fail_closed(max_quantity=100, max_notional=40000, max_orders=6,
                         allowed=["SPY", "IWM", "TLT", "GLD"]),
        orders_per_session=(1, 3),
        quantity=(10, 60),
        limit_share=0.5,
        cancel_share=0.0,
    ),
    Deployment(
        id="priya-growth",
        account="priya-raman",
        strategy="Growth rotation",
        description="Rotates into growth names, some of them outside the allowlist.",
        seed=201,
        symbols={"AAPL": 227.4, "MSFT": 418.1, "NVDA": 137.85, "AMZN": 186.5},
        extra_symbols={"TSLA": 251.4, "AMD": 158.2, "PLTR": 41.3},
        extra_share=0.3,
        risk=fail_closed(max_quantity=50, max_notional=10000, max_orders=10,
                         allowed=["AAPL", "MSFT", "NVDA", "AMZN"]),
        orders_per_session=(3, 6),
        quantity=(5, 20),
        limit_share=0.8,
    ),
    Deployment(
        id="tomas-meanrev",
        account="tomas-ibarra",
        strategy="Mean reversion, payments and banks",
        description="Limit orders sized for a cap that is too tight for these prices.",
        seed=301,
        symbols={"MSFT": 418.1, "JPM": 211.4, "V": 279.6, "MA": 498.3},
        risk=fail_closed(max_quantity=50, max_notional=3000, max_orders=12),
        orders_per_session=(3, 5),
        quantity=(4, 15),
        limit_share=1.0,
        cancel_share=0.1,
    ),
    Deployment(
        id="tomas-pairs",
        account="tomas-ibarra",
        strategy="KO/PEP pairs",
        description="Small pairs trades well inside the limits.",
        seed=302,
        symbols={"KO": 63.4, "PEP": 166.2},
        risk=fail_closed(max_quantity=50, max_notional=5000, max_orders=6),
        orders_per_session=(1, 3),
        quantity=(10, 25),
        limit_share=0.9,
    ),
    Deployment(
        id="wen-rebalance",
        account="wen-li",
        strategy="Four-fund rebalancer",
        description="Started selling to rebalance in the last four sessions; sells are off.",
        seed=401,
        symbols={"SPY": 571.2, "AGG": 99.1, "VNQ": 94.6, "EFA": 81.2},
        risk=fail_closed(max_quantity=60, max_notional=15000, max_orders=10),
        orders_per_session=(3, 5),
        quantity=(3, 25),
        limit_share=0.6,
        sub_lot_share=0.2,
        sell_share=lambda index: 0.45 if index >= 6 else 0.0,
    ),
    Deployment(
        id="greta-sector",
        account="greta-lindqvist",
        strategy="Sector ETF rotation",
        description="Busy days ask for more orders than one invocation allows.",
        seed=501,
        symbols={"XLK": 226.1, "XLF": 47.3, "XLE": 89.2, "XLV": 151.4,
                 "XLI": 136.7, "XLY": 205.3, "XLP": 82.1, "XLU": 79.4},
        risk=fail_closed(max_quantity=80, max_notional=20000, max_orders=6),
        orders_per_session=(3, 5),
        quantity=(5, 60),
        limit_share=0.7,
        cancel_share=0.0,
        bursts={3: 5, 7: 5},
    ),
    Deployment(
        id="kofi-rebal",
        account="kofi-mensah",
        strategy="Fractional target-weight rebalancer",
        description="Most deltas are below one share, so they are skipped, not refused.",
        seed=601,
        symbols={"VTI": 285.4, "VXUS": 63.2, "BND": 73.1, "VNQ": 94.6},
        risk=fail_closed(max_quantity=40, max_notional=6000, max_orders=10),
        orders_per_session=(4, 7),
        quantity=(1, 12),
        limit_share=0.5,
        cancel_share=0.0,
        sub_lot_share=0.5,
        remainder_share=0.4,
    ),
    Deployment(
        id="sofia-swing",
        account="sofia-marchetti",
        strategy="Swing entries, mega-cap tech",
        description="Order sizes regularly exceed the account's buying power.",
        seed=701,
        symbols={"META": 590.2, "NFLX": 721.6, "NVDA": 137.85, "AAPL": 227.4},
        risk=None,
        orders_per_session=(2, 4),
        quantity=(5, 25),
        limit_share=0.7,
        sell_share=lambda _i: 0.2,
        broker_check=buying_power_check(9000.0),
    ),
    Deployment(
        id="aaron-trend",
        account="aaron-feld",
        strategy="Trend following",
        description="Runs with validate_orders=False, so Lime is never asked.",
        seed=801,
        symbols={"AAPL": 227.4, "GOOGL": 165.3, "AMZN": 186.5},
        risk=None,
        validate_orders=False,
        orders_per_session=(2, 4),
        quantity=(5, 30),
        limit_share=0.6,
        sell_share=lambda _i: 0.25,
        foreign_cancels={1: 9 * 60 + 32},
    ),
    Deployment(
        id="nadia-intraday",
        account="nadia-haddad",
        strategy="Intraday market-order momentum",
        description="Market orders priced at the live quote; one day had no quote for two names.",
        seed=901,
        symbols={"AAPL": 227.4, "MSFT": 418.1, "AMZN": 186.5, "GOOGL": 165.3},
        risk=fail_closed(max_quantity=30, max_notional=9000, max_orders=10),
        orders_per_session=(3, 5),
        quantity=(10, 34),
        limit_share=0.1,
        cancel_share=0.0,
        missing_quotes={8: {"AMZN", "GOOGL"}},
    ),
    Deployment(
        id="nadia-index-test",
        account="nadia-haddad",
        strategy="Index entry test",
        description="A test deployment that stopped running after five sessions.",
        seed=902,
        symbols={"SPY": 571.2, "QQQ": 489.4},
        risk=fail_closed(max_quantity=30, max_notional=20000, max_orders=4),
        orders_per_session=(1, 2),
        quantity=(5, 20),
        limit_share=1.0,
        cancel_share=0.0,
        active_sessions=range(0, 5),
    ),
    Deployment(
        id="jonas-breakout",
        account="jonas-weber",
        strategy="Opening-range breakout",
        description="One session's signals went stale before the order deadline.",
        seed=1001,
        symbols={"AAPL": 227.4, "NVDA": 137.85, "AMD": 158.2, "MSFT": 418.1},
        risk=fail_closed(max_quantity=60, max_notional=15000, max_orders=10),
        orders_per_session=(3, 5),
        quantity=(5, 30),
        limit_share=0.8,
        cancel_share=0.1,
        deadlines={6: 10 * 60 + 15},
    ),
    Deployment(
        id="jonas-etf",
        account="jonas-weber",
        strategy="Sector ETF momentum",
        description="One broker rejection with a message the console has no rule for.",
        seed=1002,
        symbols={"XLK": 226.1, "SMH": 248.9, "XLE": 89.2},
        risk=None,
        orders_per_session=(2, 3),
        quantity=(10, 40),
        limit_share=0.8,
        broker_check=one_off_rejection(
            8, "SMH", "price is outside the allowed band for this symbol"
        ),
    ),
]


# ---------------------------------------------------------------------------
# Generation
# ---------------------------------------------------------------------------
def sessions() -> list[datetime.date]:
    calendar = get_calendar("NYSE")
    start = AS_OF - datetime.timedelta(days=30)
    days = calendar.sessions_in_range(start.isoformat(), AS_OF.isoformat())
    return [day.date() for day in days][-SESSION_COUNT:]


def bar_time(day: datetime.date, minute: int) -> datetime.datetime:
    return datetime.datetime(day.year, day.month, day.day, minute // 60, minute % 60, tzinfo=ET)


def session_intents(dep: Deployment, rng: random.Random, index: int) -> list[Intent]:
    count = rng.randint(*dep.orders_per_session) + dep.bursts.get(index, 0)
    minutes = sorted(rng.sample(range(FIRST_BAR, LAST_BAR + 1), count))
    if index in dep.bursts:
        # A busy day is one rebalance tick asking for many orders at once.
        burst_at = rng.randint(14 * 60, 15 * 60 + 30)
        minutes = sorted(minutes[: count - dep.bursts[index]] + [burst_at] * dep.bursts[index])
    intents = []
    core = list(dep.symbols)
    for minute in minutes:
        if dep.extra_symbols and rng.random() < dep.extra_share:
            symbol = rng.choice(list(dep.extra_symbols))
        else:
            symbol = rng.choice(core)
        if rng.random() < dep.sub_lot_share:
            amount = round(rng.uniform(0.05, 0.95), 3)
        else:
            amount = float(rng.randint(*dep.quantity))
            if rng.random() < dep.remainder_share:
                amount = round(amount + rng.uniform(0.05, 0.95), 3)
        if rng.random() < dep.sell_share(index):
            amount = -amount
        style = "limit" if rng.random() < dep.limit_share else "market"
        cancel_after = None
        if style == "limit" and rng.random() < dep.cancel_share:
            wait = rng.randint(15, 90)
            if minute + wait <= LAST_BAR:
                cancel_after = wait
        if amount == int(amount):
            amount = int(amount)
        intents.append(Intent(minute, symbol, amount, style, cancel_after))
    return intents


def apply_env(env: dict[str, str]) -> None:
    for name in RISK_VARS:
        os.environ.pop(name, None)
    os.environ.update(env)


async def run_session(
    dep: Deployment,
    account_number: str,
    day: datetime.date,
    index: int,
    rng: random.Random,
    prices: dict[str, float],
    path: Path,
) -> None:
    env = dict(dep.risk or {})
    if index in dep.deadlines:
        env["ZIPLIME_ORDER_DEADLINE_UTC"] = bar_time(day, dep.deadlines[index]).astimezone(UTC).isoformat()
    apply_env(env)

    all_symbols = {**dep.symbols, **dep.extra_symbols}
    assets = {symbol: _asset(symbol, sid=i + 1) for i, symbol in enumerate(sorted(all_symbols))}
    client = FakeAsyncLimeClient(balances=[_balance(account_number)])
    calendar = get_calendar("NYSE")
    CLOCK.set(bar_time(day, FIRST_BAR - 1))
    exchange = LimeTraderSdkExchange(
        name="LIME",
        canonical_name="Lime Trading",
        country_code="US",
        clock=types.SimpleNamespace(trading_calendar=calendar),
        trading_calendar=calendar,
        start_cash_balance=100_000.0,
        asset_service=FakeAssetService(*assets.values()),
        is_default=True,
        account_id=account_number,
        default_mic="XNGS",
        validate_orders=dep.validate_orders,
        client=client,
        logger=QuietLogger(),
        dry_run_file=path,
    )

    # (minute, sequence, action, payload): a heap so cancels interleave with
    # later submits in time order.
    queue: list[tuple[int, int, str, object]] = []
    seq = 0
    for intent in session_intents(dep, rng, index):
        heapq.heappush(queue, (intent.minute, seq, "submit", intent))
        seq += 1
    for foreign_index, minute in dep.foreign_cancels.items():
        if foreign_index == index:
            heapq.heappush(queue, (minute, seq, "foreign-cancel", f"{rng.getrandbits(48):012x}"))
            seq += 1

    missing = dep.missing_quotes.get(index, set())
    while queue:
        minute, _, action, payload = heapq.heappop(queue)
        CLOCK.set(bar_time(day, minute) + datetime.timedelta(milliseconds=rng.randint(250, 1400)))
        if action == "foreign-cancel":
            await exchange.cancel_order(str(payload))
            continue
        if action == "cancel":
            try:
                await exchange.cancel_order(payload.id)
            except Exception:  # noqa: BLE001 - recorded or refused by the engine
                pass
            continue

        intent: Intent = payload
        price = prices[intent.symbol] * math.exp(rng.gauss(0, 0.003))
        client.market.quotes = [
            _market_quote(symbol, f"{prices[symbol] * 1.0003:.2f}", f"{prices[symbol] * 0.9997:.2f}")
            for symbol in all_symbols
            if symbol not in missing
        ]
        rejection = dep.broker_check(index, intent, price)
        client.trading.validation_response = (
            ValidateOrderResponse(is_valid=False, validation_message=rejection)
            if rejection
            else ValidateOrderResponse(is_valid=True)
        )
        if intent.style == "limit":
            offset = rng.uniform(0.0, 0.002)
            limit = price * (1 - offset) if intent.amount > 0 else price * (1 + offset)
            style = LimitOrder(limit_price=round(limit, 2))
        else:
            style = MarketOrder()
        order = Order(
            id=f"{rng.getrandbits(80):020x}",  # ziplime: uuid.uuid4().hex[:20]
            dt=bar_time(day, intent.minute),
            asset=assets[intent.symbol],
            amount=intent.amount,
            filled=0,
            commission=0.0,
            execution_style=style,
            status=OrderStatus.OPEN,
            exchange_name="LIME",
            trading_account_id=account_number,
            exchange_order_id=None,
        )
        try:
            await exchange.submit_order(order)
        except Exception:  # noqa: BLE001 - ziplime's stop_on_error=False drops it too
            continue
        placed = str(order.exchange_order_id or "").startswith(LimeTraderSdkExchange.DRY_RUN_ID_PREFIX)
        if placed and intent.cancel_after:
            heapq.heappush(queue, (minute + intent.cancel_after, seq, "cancel", order))
            seq += 1


def git(*args: str) -> str:
    return subprocess.run(
        ["git", "-C", str(ZIPLIME), *args], capture_output=True, text=True, check=True
    ).stdout.strip()


def count_events(path: Path) -> dict[str, int]:
    counts = {"place": 0, "refuse": 0, "skip": 0, "cancel": 0}
    if path.exists():
        for line in path.read_text().splitlines():
            counts[json.loads(line)["event"]] += 1
    return counts


def main() -> None:
    accounts = {a["id"]: a for a in json.loads((OUT / "accounts.json").read_text())["accounts"]}
    install_clock()
    DRYRUNS.mkdir(parents=True, exist_ok=True)
    for stale in DRYRUNS.glob("*.jsonl"):
        stale.unlink()  # the engine appends; start from empty files

    days = sessions()
    manifest_deployments = []
    for dep in DEPLOYMENTS:
        account = accounts[dep.account]
        rng = random.Random(dep.seed)
        CLOCK.reset(random.Random(dep.seed * 7919))
        path = DRYRUNS / f"{dep.id}.jsonl"
        prices = dict({**dep.symbols, **dep.extra_symbols})
        active = dep.active_sessions or range(len(days))
        ran = []
        for index, day in enumerate(days):
            # Daily drift, applied whether or not the deployment ran that day.
            for symbol in prices:
                prices[symbol] *= math.exp(rng.gauss(0, 0.012))
            if index not in active:
                continue
            asyncio.run(run_session(dep, account["accountNumber"], day, index, rng, prices, path))
            ran.append(day.isoformat())
        apply_env({})
        lines = path.read_text().count("\n") if path.exists() else 0
        manifest_deployments.append(
            {
                "id": dep.id,
                "account": dep.account,
                "strategy": dep.strategy,
                "description": dep.description,
                "file": f"dryruns/{dep.id}.jsonl",
                "symbols": sorted(dep.symbols),
                "riskEnv": dep.risk,
                "validateOrders": dep.validate_orders,
                "deadlines": {
                    days[i].isoformat(): bar_time(days[i], m).astimezone(UTC).isoformat()
                    for i, m in dep.deadlines.items()
                },
                "sessions": ran,
                "lines": lines,
                "counts": count_events(path),
            }
        )
        print(f"{dep.id:20} {lines:4} lines  {count_events(path)}")

    manifest = {
        "_note": "Generated by scripts/generate_seed.py. Every .jsonl line was written by ziplime's LimeTraderSdkExchange in dry run, with the test suite's fake Lime client and a simulated wall clock.",
        "asOf": AS_OF.isoformat(),
        "sessions": [d.isoformat() for d in days],
        "ziplime": {
            "branch": git("rev-parse", "--abbrev-ref", "HEAD"),
            "commit": git("rev-parse", "HEAD"),
            "subject": git("log", "-1", "--format=%s"),
        },
        "deployments": manifest_deployments,
    }
    (OUT / "manifest.json").write_text(json.dumps(manifest, indent=2, ensure_ascii=False) + "\n")


if __name__ == "__main__":
    main()
