from __future__ import annotations

import csv
import html
import os
import re
import sys
from dataclasses import dataclass
from pathlib import Path
from tempfile import TemporaryDirectory
from urllib.parse import unquote, urljoin
from urllib.request import urlopen

import pdfplumber


DEFAULT_SOURCE_URL = "https://cr.indianrailways.gov.in/view_section.jsp?id=0,5,2360&lang=0"
DEFAULT_OUTPUT = "data/central-railway-parsed.csv"
TIME_PATTERN = re.compile(r"^\d{2}:\d{2}$")

ASSET_PATTERNS = [
    ("main_down", "Central Main Line", re.compile(r"SUB\s*PTT\s*DN\s*ML", re.I)),
    ("main_up", "Central Main Line", re.compile(r"SUB\s*PTT\s*UP\s*ML", re.I)),
    ("harbour_down", "Harbour Line", re.compile(r"HB\s*PTT.*-DN", re.I)),
    ("harbour_up", "Harbour Line", re.compile(r"HB\s*PTT.*-UP", re.I)),
    ("trans_harbour", "Trans-Harbour Line", re.compile(r"TRANS\s*HB\s*PTT", re.I)),
    ("port_line", "Port Line", re.compile(r"PORT\s*LINE\s*PTT", re.I)),
]

ELLIPSIS_TOKENS = {"", "...", "-", ".", "`"}
MOJIBAKE_TOKENS = ("\u00e2\u20ac\u00a6", "\u00c3\u00a2\u00e2\u201a\u00ac\u00c2\u00a6")


@dataclass
class TrainRecord:
    train_id: str
    line: str
    title: str
    code: str
    flags: str
    train_type: str
    stops: list[tuple[str, str]]


def fetch_text(url: str) -> str:
    with urlopen(url, timeout=60) as response:
        return response.read().decode("utf-8", errors="ignore")


def download_bytes(url: str) -> bytes:
    with urlopen(url, timeout=60) as response:
        return response.read()


def collapse_repeated_pairs(value: str) -> str:
    if len(value) < 4 or len(value) % 2 != 0:
        return value

    if all(value[index] == value[index + 1] for index in range(0, len(value), 2)):
        return value[::2]

    return value


def normalize_station(value: str | None) -> str | None:
    if value is None:
        return None

    cleaned = " ".join(value.replace("\n", " ").split())

    for token in MOJIBAKE_TOKENS:
        cleaned = cleaned.replace(token, "")

    cleaned = " ".join(collapse_repeated_pairs(part) for part in cleaned.split())
    cleaned = cleaned.strip(" .")

    if not cleaned:
        return None

    if cleaned.isupper() and not any(character.isdigit() for character in cleaned):
        cleaned = cleaned.title()

    station_aliases = {
        "Airavali": "Airoli",
        "Belapur": "CBD Belapur",
        "Chhatrapati Shivaji Maharaj Terminus": "CSMT",
        "Ghhaannssoollii": "Ghansoli",
        "Ghansoli": "Ghansoli",
        "Mumbai CSMT": "CSMT",
        "Mumbai Csmt": "CSMT",
        "Seawoods Darave Karave": "Seawoods-Darave",
        "Ulhasnagar": "Ulhas Nagar",
    }

    return station_aliases.get(cleaned, cleaned)


def normalize_header_label(value: str | None) -> str:
    if value is None:
        return ""

    return re.sub(r"[^a-z]", "", value.lower())


def is_station_header(value: str | None) -> bool:
    return normalize_header_label(value) in {"station", "stations"}


def is_train_header(value: str | None) -> bool:
    return normalize_header_label(value) in {"trainnotraincode", "trnotrcode"}


def is_placeholder_row(row: list[str | None]) -> bool:
    tokens: list[str] = []

    for cell in row:
        if cell is None:
            continue

        normalized = re.sub(r"[^0-9a-z]", "", cell.lower())

        if normalized:
            tokens.append(normalized)

    return bool(tokens) and all(token == "0" for token in tokens)


def normalize_time(value: str | None) -> str | None:
    if value is None:
        return None

    cleaned = value.replace("`", "").replace("'", "").strip()
    cleaned = collapse_repeated_pairs(cleaned)

    if cleaned in ELLIPSIS_TOKENS:
        return None

    return cleaned if TIME_PATTERN.match(cleaned) else None


def parse_header_cell(cell: str | None) -> tuple[str | None, str, str]:
    if cell is None:
        return (None, "", "")

    parts = [part.strip() for part in cell.split("\n") if part and part.strip()]

    if not parts:
        return (None, "", "")

    train_id = parts[0]
    code = parts[1] if len(parts) > 1 else ""
    flags = " ".join(parts[2:]).strip()

    if not train_id.isdigit():
        return (None, code, flags)

    return (train_id, code, flags)


def discover_assets(source_url: str) -> list[tuple[str, str, str]]:
    page_html = fetch_text(source_url)
    pdf_urls = re.findall(r'href="([^"]+?\.pdf)"', page_html, flags=re.I)
    discovered: dict[str, tuple[str, str, str]] = {}

    for raw_url in pdf_urls:
        absolute_url = urljoin(source_url, raw_url)
        decoded_url = html.unescape(absolute_url)
        normalized_url = unquote(decoded_url)
        download_url = decoded_url.replace("'", "%27")

        for asset_id, line_name, pattern in ASSET_PATTERNS:
            if pattern.search(normalized_url) and asset_id not in discovered:
                discovered[asset_id] = (asset_id, line_name, download_url)
                break

    missing_assets = [asset_id for asset_id, _, _ in ASSET_PATTERNS if asset_id not in discovered]

    if missing_assets:
        raise RuntimeError(
            f"Unable to discover all required Central Railway PDFs from source page. Missing: {', '.join(missing_assets)}"
        )

    return [discovered[asset_id] for asset_id, _, _ in ASSET_PATTERNS]


def build_station_order(trains: list[TrainRecord]) -> list[str]:
    station_order: list[str] = []
    seen: set[str] = set()

    for train in trains:
        for station, _ in train.stops:
            if station not in seen:
                station_order.append(station)
                seen.add(station)

    return station_order


def classify_train_type(train_stops: list[tuple[str, str]], station_order: list[str]) -> str:
    station_index = {station: index for index, station in enumerate(station_order)}

    if len(train_stops) < 2:
        return "slow"

    start = station_index.get(train_stops[0][0])
    end = station_index.get(train_stops[-1][0])

    if start is None or end is None or end <= start:
        return "slow"

    covered_segment = station_order[start : end + 1]
    return "fast" if len(train_stops) < len(covered_segment) else "slow"


def find_header_index(table: list[list[str | None]]) -> int | None:
    for index, row in enumerate(table):
        if not row or not row[0]:
            continue

        if is_station_header(row[0]) or is_train_header(row[0]):
            return index

    return None


def parse_pdf_asset(pdf_path: Path, line_name: str) -> list[TrainRecord]:
    trains_by_id: dict[str, TrainRecord] = {}
    title_value = ""

    with pdfplumber.open(str(pdf_path)) as pdf:
        for page in pdf.pages:
            for table in page.extract_tables():
                if not table or len(table) < 2:
                    continue

                title_row = table[0]
                header_index = find_header_index(table)

                if header_index is None:
                    continue

                if not title_value:
                    title_value = normalize_station(title_row[0]) or line_name

                header_row = table[header_index]
                headers = [parse_header_cell(cell) for cell in header_row[1:]]
                station_rows = [
                    row
                    for row in table[header_index + 1 :]
                    if row
                    and not is_placeholder_row(row)
                    and normalize_station(row[0] if row else None)
                ]

                for column_index, (train_id, code, flags) in enumerate(headers, start=1):
                    if not train_id:
                        continue

                    stops: list[tuple[str, str]] = []

                    for row in station_rows:
                        station_name = normalize_station(row[0])
                        raw_time = row[column_index] if column_index < len(row) else None
                        stop_time = normalize_time(raw_time)

                        if station_name and stop_time:
                            stops.append((station_name, stop_time))

                    if not stops:
                        continue

                    train = trains_by_id.get(train_id)

                    if train is None:
                        trains_by_id[train_id] = TrainRecord(
                            train_id=train_id,
                            line=line_name,
                            title=title_value or line_name,
                            code=code,
                            flags=flags,
                            train_type="slow",
                            stops=stops,
                        )
                    else:
                        existing_pairs = {(station, time) for station, time in train.stops}

                        for stop in stops:
                            if stop not in existing_pairs:
                                train.stops.append(stop)

    station_order = build_station_order(list(trains_by_id.values()))

    for train in trains_by_id.values():
        ordered: list[tuple[str, str]] = []
        seen_stations: set[str] = set()

        for station, time in train.stops:
            if station not in seen_stations:
                ordered.append((station, time))
                seen_stations.add(station)

        train.stops = ordered
        train.train_type = classify_train_type(train.stops, station_order)

    return list(trains_by_id.values())


def write_output(trains: list[TrainRecord], output_path: Path) -> None:
    output_path.parent.mkdir(parents=True, exist_ok=True)
    fieldnames = [
        "train_id",
        "train_name",
        "train_type",
        "line",
        "origin_station",
        "destination_station",
        "station_name",
        "arrival_time",
        "departure_time",
        "stop_order",
    ]

    with output_path.open("w", newline="", encoding="utf-8") as csv_file:
        writer = csv.DictWriter(csv_file, fieldnames=fieldnames)
        writer.writeheader()

        for train in sorted(trains, key=lambda record: (record.line, int(record.train_id))):
            if len(train.stops) < 2:
                continue

            origin_station = train.stops[0][0]
            destination_station = train.stops[-1][0]
            train_name = f"{origin_station} to {destination_station} {train.line}"

            for stop_order, (station_name, stop_time) in enumerate(train.stops, start=1):
                writer.writerow(
                    {
                        "train_id": train.train_id,
                        "train_name": train_name,
                        "train_type": train.train_type,
                        "line": train.line,
                        "origin_station": origin_station,
                        "destination_station": destination_station,
                        "station_name": station_name,
                        "arrival_time": stop_time,
                        "departure_time": stop_time,
                        "stop_order": stop_order,
                    }
                )


def main() -> int:
    source_url = sys.argv[1] if len(sys.argv) > 1 else os.environ.get("TIMETABLE_SOURCE_URL", DEFAULT_SOURCE_URL)
    output_path = Path(sys.argv[2] if len(sys.argv) > 2 else DEFAULT_OUTPUT)

    assets = discover_assets(source_url)
    all_trains: list[TrainRecord] = []

    with TemporaryDirectory() as temp_dir:
        temp_root = Path(temp_dir)

        for asset_id, line_name, pdf_url in assets:
            pdf_path = temp_root / f"{asset_id}.pdf"
            pdf_path.write_bytes(download_bytes(pdf_url))
            all_trains.extend(parse_pdf_asset(pdf_path, line_name))

    unique_trains: dict[tuple[str, str], TrainRecord] = {}

    for train in all_trains:
        unique_trains[(train.line, train.train_id)] = train

    write_output(list(unique_trains.values()), output_path)
    print(f"parsed_trains={len(unique_trains)}")
    print(f"output_csv={output_path}")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
