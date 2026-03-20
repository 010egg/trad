import argparse
import asyncio
from collections.abc import Sequence
from datetime import date
from itertools import product

from sqlalchemy import func, select

from app.database import async_session
from app.modules.backtest.engine import fetch_historical_klines
from app.modules.backtest.models import HistoricalKline


def _parse_args() -> argparse.Namespace:
    current_year = date.today().year
    parser = argparse.ArgumentParser(description="Bulk backfill missing historical klines into the local database.")
    parser.add_argument("--start-year", type=int, default=2022, help="First year to backfill. Default: 2022")
    parser.add_argument("--end-year", type=int, default=current_year, help=f"Last year to backfill. Default: {current_year}")
    parser.add_argument(
        "--symbol",
        dest="symbols",
        action="append",
        default=[],
        help="Symbol to backfill. Repeat the flag for multiple symbols.",
    )
    parser.add_argument(
        "--interval",
        dest="intervals",
        action="append",
        default=[],
        help="Interval to backfill. Repeat the flag for multiple intervals.",
    )
    return parser.parse_args()


def _normalize_values(values: Sequence[str]) -> list[str]:
    return sorted({value.strip().upper() for value in values if value.strip()})


async def _resolve_combinations(symbols: Sequence[str], intervals: Sequence[str]) -> list[tuple[str, str]]:
    normalized_symbols = _normalize_values(symbols)
    normalized_intervals = sorted({value.strip() for value in intervals if value.strip()})

    if normalized_symbols and normalized_intervals:
        return list(product(normalized_symbols, normalized_intervals))

    async with async_session() as db:
        stmt = select(HistoricalKline.symbol, HistoricalKline.interval).distinct()
        if normalized_symbols:
            stmt = stmt.where(HistoricalKline.symbol.in_(normalized_symbols))
        if normalized_intervals:
            stmt = stmt.where(HistoricalKline.interval.in_(normalized_intervals))
        stmt = stmt.order_by(HistoricalKline.symbol, HistoricalKline.interval)
        rows = (await db.execute(stmt)).all()

    return [(str(symbol), str(interval)) for symbol, interval in rows]


def _year_range(start_year: int, end_year: int) -> list[tuple[int, str, str]]:
    if start_year > end_year:
        raise ValueError("start-year cannot be greater than end-year")

    ranges: list[tuple[int, str, str]] = []
    for year in range(start_year, end_year + 1):
        start_date = f"{year}-01-01"
        end_date = f"{year + 1}-01-01"
        ranges.append((year, start_date, end_date))
    return ranges


async def _count_rows(symbol: str, interval: str, start_date: str, end_date: str) -> int:
    async with async_session() as db:
        stmt = select(func.count()).select_from(HistoricalKline).where(
            HistoricalKline.symbol == symbol,
            HistoricalKline.interval == interval,
            HistoricalKline.open_time >= _date_to_ms(start_date),
            HistoricalKline.open_time < _date_to_ms(end_date),
        )
        return int((await db.execute(stmt)).scalar_one())


def _date_to_ms(date_str: str) -> int:
    from datetime import datetime

    return int(datetime.strptime(date_str, "%Y-%m-%d").timestamp() * 1000)


async def _backfill_range(symbol: str, interval: str, year: int, start_date: str, end_date: str) -> int:
    before_count = await _count_rows(symbol, interval, start_date, end_date)

    async with async_session() as db:
        await fetch_historical_klines(
            db=db,
            symbol=symbol,
            interval=interval,
            start_date=start_date,
            end_date=end_date,
        )
        await db.commit()

    after_count = await _count_rows(symbol, interval, start_date, end_date)
    added = after_count - before_count
    print(f"[{symbol} {interval}] {year}: +{added} rows ({before_count} -> {after_count})")
    return added


async def _print_summary() -> None:
    async with async_session() as db:
        year_expr = func.strftime("%Y", func.datetime(HistoricalKline.open_time / 1000, "unixepoch"))
        year_stmt = (
            select(year_expr.label("year"), func.count().label("rows"))
            .group_by("year")
            .order_by("year")
        )
        combo_stmt = (
            select(
                HistoricalKline.symbol,
                HistoricalKline.interval,
                func.min(func.datetime(HistoricalKline.open_time / 1000, "unixepoch")).label("first_at"),
                func.max(func.datetime(HistoricalKline.open_time / 1000, "unixepoch")).label("last_at"),
                func.count().label("rows"),
            )
            .group_by(HistoricalKline.symbol, HistoricalKline.interval)
            .order_by(HistoricalKline.symbol, HistoricalKline.interval)
        )
        year_rows = (await db.execute(year_stmt)).all()
        combo_rows = (await db.execute(combo_stmt)).all()

    print("\nYear coverage:")
    for year, rows in year_rows:
        print(f"  {year}: {rows}")

    print("\nSymbol / interval coverage:")
    for symbol, interval, first_at, last_at, rows in combo_rows:
        print(f"  {symbol:<10} {interval:<4} {first_at} -> {last_at} ({rows})")


async def main() -> None:
    args = _parse_args()
    combinations = await _resolve_combinations(args.symbols, args.intervals)
    if not combinations:
        raise SystemExit("No symbol/interval combinations found to backfill.")

    year_ranges = _year_range(args.start_year, args.end_year)
    print(f"Backfilling {len(combinations)} combinations across {len(year_ranges)} year ranges.")

    total_added = 0
    for symbol, interval in combinations:
        for year, start_date, end_date in year_ranges:
            total_added += await _backfill_range(symbol, interval, year, start_date, end_date)

    print(f"\nFinished. Added {total_added} rows in total.")
    await _print_summary()


if __name__ == "__main__":
    asyncio.run(main())
