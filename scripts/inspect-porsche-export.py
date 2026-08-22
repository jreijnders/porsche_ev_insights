#!/usr/bin/env python3
"""Inspect a My Porsche CSV export and report what it actually contains.

Answers the questions the archive ticket asks of an export: how many trip rows,
what date range they really cover, and — because the app exports in the device's
language — what the headers literally say.

Deliberately language-agnostic. The dashboard's own parsers
(src/utils/dataMerger.js, src/services/dataProcessor.js) match English and
Portuguese header names only; a Dutch export matches neither. So nothing here
keys off a header name. Columns are identified by the shape of their values:
the date column is the one whose values parse as dates, numeric columns are the
ones whose values parse as numbers.

Usage:
    python3 scripts/inspect-porsche-export.py FILE.csv [FILE.csv ...]
"""

import csv
import io
import re
import sys
from datetime import datetime

# ── reading ───────────────────────────────────────────────────────────────

ENCODINGS = ("utf-8-sig", "utf-8", "cp1252", "latin-1")


def read_text(path):
    """Return (text, encoding). Tries encodings in order; latin-1 never fails."""
    for enc in ENCODINGS:
        try:
            with open(path, "r", encoding=enc, newline="") as fh:
                return fh.read(), enc
        except UnicodeDecodeError:
            continue
    raise SystemExit(f"could not decode {path} in any of {ENCODINGS}")


def sniff_delimiter(text):
    """Pick the delimiter. Sniffer first; a header-line tally is the fallback.

    European exports frequently use ';' precisely because ',' is the decimal
    separator, so guessing ',' unconditionally would fold every row into one
    field and report a plausible-looking but wrong column count.
    """
    sample = text[:8192]
    try:
        return csv.Sniffer().sniff(sample, delimiters=",;\t|").delimiter
    except csv.Error:
        head = sample.splitlines()[0] if sample.splitlines() else ""
        return max(",;\t|", key=head.count) if head else ","


def read_rows(path):
    text, encoding = read_text(path)
    delimiter = sniff_delimiter(text)
    rows = list(csv.reader(io.StringIO(text), delimiter=delimiter))
    rows = [r for r in rows if any(cell.strip() for cell in r)]  # drop blank lines
    return rows, encoding, delimiter


# ── value parsing ─────────────────────────────────────────────────────────

# Ordered: the most specific patterns first, so a full timestamp is never
# truncated to a bare date by an earlier, looser match.
DATE_FORMATS = (
    ("%Y-%m-%dT%H:%M:%SZ", "ISO 8601 UTC"),
    ("%Y-%m-%dT%H:%M:%S", "ISO 8601"),
    ("%Y-%m-%d %H:%M:%S", "yyyy-mm-dd hh:mm:ss"),
    ("%Y-%m-%d %H:%M", "yyyy-mm-dd hh:mm"),
    ("%Y-%m-%d", "yyyy-mm-dd"),
    ("%d/%m/%Y %H:%M:%S", "dd/mm/yyyy hh:mm:ss"),
    ("%d/%m/%Y %H:%M", "dd/mm/yyyy hh:mm"),
    ("%d/%m/%Y", "dd/mm/yyyy"),
    ("%d-%m-%Y %H:%M:%S", "dd-mm-yyyy hh:mm:ss"),
    ("%d-%m-%Y %H:%M", "dd-mm-yyyy hh:mm"),
    ("%d-%m-%Y", "dd-mm-yyyy"),
    ("%d.%m.%Y %H:%M:%S", "dd.mm.yyyy hh:mm:ss"),
    ("%d.%m.%Y %H:%M", "dd.mm.yyyy hh:mm"),
    ("%d.%m.%Y", "dd.mm.yyyy"),
)

# Day-first formats are read as day-first. Whether that is right is checked
# separately by day_first_is_proven(): if no value anywhere in the column has a
# first component above 12, the file cannot distinguish 03/04 from 04/03 and the
# report says so rather than asserting a range it cannot support.
DAY_FIRST = re.compile(r"^\s*(\d{1,2})[/.\-]\d{1,2}[/.\-]\d{4}")


def parse_date(value):
    """Return (datetime, format label) or (None, None)."""
    v = value.strip()
    if not v:
        return None, None
    for fmt, label in DATE_FORMATS:
        try:
            return datetime.strptime(v, fmt), label
        except ValueError:
            continue
    return None, None


def parse_number(value):
    """Parse a number written in either European or Anglo convention.

    '1.234,5' and '1,234.5' are the same number written two ways. The rule that
    settles it without knowing the locale: whichever separator appears last is
    the decimal one.
    """
    v = value.strip().replace(" ", " ").replace(" ", "")
    if not v:
        return None
    v = re.sub(r"[^\d,.\-+]", "", v)  # strip units such as 'km' or 'kWh'
    if not re.search(r"\d", v):
        return None
    last_comma, last_dot = v.rfind(","), v.rfind(".")
    if last_comma > last_dot:
        v = v.replace(".", "").replace(",", ".")
    else:
        v = v.replace(",", "")
    try:
        return float(v)
    except ValueError:
        return None


# ── column classification ─────────────────────────────────────────────────


def column_values(rows, index):
    return [row[index] for row in rows if index < len(row) and row[index].strip()]


def date_column(rows, width):
    """The column whose values parse as dates. Best parse rate wins, >=80%."""
    best = None
    for i in range(width):
        values = column_values(rows, i)
        if not values:
            continue
        parsed = [parse_date(v) for v in values]
        hits = [(d, label) for d, label in parsed if d is not None]
        rate = len(hits) / len(values)
        if rate >= 0.8 and (best is None or rate > best[1]):
            labels = {label for _, label in hits}
            best = (i, rate, [d for d, _ in hits], sorted(labels), values)
    return best


def day_first_is_proven(values):
    """True when some value has a first component >12, forcing a day-first read.

    Without such a value the file is genuinely ambiguous and the caller should
    flag the date range as unconfirmed rather than state it.
    """
    for v in values:
        m = DAY_FIRST.match(v)
        if m and int(m.group(1)) > 12:
            return True
    return False


def numeric_columns(rows, width, skip):
    """Every column that is >=80% numeric, with its sum. Distance is in here
    under whatever name the export language gave it."""
    out = []
    for i in range(width):
        if i == skip:
            continue
        values = column_values(rows, i)
        if not values:
            continue
        numbers = [n for n in (parse_number(v) for v in values) if n is not None]
        if len(numbers) / len(values) >= 0.8 and numbers:
            out.append((i, len(numbers), sum(numbers), min(numbers), max(numbers)))
    return out


# ── reporting ─────────────────────────────────────────────────────────────

BOLD, DIM, GREEN, YELLOW, RESET = "\033[1m", "\033[2m", "\033[32m", "\033[33m", "\033[0m"
if not sys.stdout.isatty():
    BOLD = DIM = GREEN = YELLOW = RESET = ""


def header_label(headers, index):
    name = headers[index].strip() if index < len(headers) else ""
    return f"{name!r}" if name else f"column {index + 1} (unnamed)"


def inspect(path):
    """Print a report for one file. Returns a one-line summary for the tail."""
    rows, encoding, delimiter = read_rows(path)
    print(f"\n{BOLD}{path}{RESET}")

    if not rows:
        print(f"  {YELLOW}empty file — no rows at all{RESET}")
        return f"{path}: empty"

    headers, data = rows[0], rows[1:]
    width = max(len(r) for r in rows)
    shown = ", ".join(h.strip() for h in headers)
    delim_name = {"\t": "tab"}.get(delimiter, delimiter)

    print(f"  {DIM}encoding {encoding} · delimiter {delim_name!r} · {width} columns{RESET}")
    print(f"  headers verbatim: {shown}")
    print(f"  {BOLD}{len(data)} data rows{RESET}")

    if not data:
        print(f"  {YELLOW}header only — the export contains no trips{RESET}")
        return f"{path}: 0 rows"

    found = date_column(data, width)
    if not found:
        print(f"  {YELLOW}no date column found — cannot report a date range{RESET}")
        return f"{path}: {len(data)} rows, date range unknown"

    index, rate, dates, labels, raw = found
    first, last = min(dates), max(dates)
    span = (last - first).days
    print(f"  date column: {header_label(headers, index)} · format {', '.join(labels)}")
    if rate < 1.0:
        print(f"  {YELLOW}{int(round((1 - rate) * len(raw)))} value(s) in that column did not parse{RESET}")
    print(
        f"  {BOLD}{GREEN}covers {first:%Y-%m-%d %H:%M} → {last:%Y-%m-%d %H:%M}{RESET}"
        f"  {DIM}({span} days){RESET}"
    )

    ambiguous = any("dd/" in l or "dd-" in l or "dd." in l for l in labels) and not day_first_is_proven(raw)
    if ambiguous:
        print(
            f"  {YELLOW}day-first assumed but unproven: no value has a first component "
            f"above 12, so dd/mm and mm/dd cannot be told apart in this file{RESET}"
        )

    for i, count, total, lo, hi in numeric_columns(data, width, index):
        print(
            f"  {header_label(headers, i)}: sum {total:,.1f} · "
            f"min {lo:,.1f} · max {hi:,.1f} {DIM}({count} values){RESET}"
        )

    return f"{path}: {len(data)} rows, {first:%Y-%m-%d} → {last:%Y-%m-%d}"


def main(argv):
    if len(argv) < 2:
        print(__doc__.strip())
        return 2
    summaries = [inspect(path) for path in argv[1:]]
    if len(summaries) > 1:
        print(f"\n{BOLD}Summary{RESET}")
        for line in summaries:
            print(f"  {line}")
    print()
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
