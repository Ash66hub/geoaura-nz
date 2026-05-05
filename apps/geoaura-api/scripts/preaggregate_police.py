"""
Pre-aggregate the NZ Police victimisation CSV into a compact JSON file.

Input:  ~23MB UTF-16 CSV from Supabase storage
Output: ~500KB JSON with meshblock-level crime + population aggregates

Run once whenever the source CSV is updated, then commit the output JSON.
The FastAPI service loads only the small JSON at runtime → no OOM on 512MB hosts.
"""

import csv
import io
import json
import sys
from collections import defaultdict
from pathlib import Path

import httpx

REMOTE_CSV_URL = (
    "https://qzoievmtpylfdvbteruc.supabase.co/storage/v1/object/public/raw-data/"
    "NZPoliceData/Download%20Table_Full%20Data_data%20Feb2025_to_Jan2026_with_population.csv"
)

OUTPUT_PATH = Path(__file__).resolve().parent.parent / "data" / "police_aggregated.json"


def normalize_meshblock(code: str) -> str:
    return code.strip().lstrip("0") or "0"


def parse_population(value: str) -> float | None:
    text = str(value).strip()
    if text in {"", "-999"}:
        return None
    try:
        parsed = float(text)
        return parsed if parsed >= 0 else None
    except (TypeError, ValueError):
        return None


def main():
    local_csv = (
        Path(__file__).resolve().parent.parent.parent.parent
        / "data"
        / "raw"
        / "NZPoliceData"
        / "Download Table_Full Data_data Feb2025_to_Jan2026_with_population.csv"
    )

    if local_csv.exists():
        print(f"Reading local CSV: {local_csv}")
        raw = local_csv.read_bytes()
    else:
        print(f"Downloading CSV from Supabase...")
        with httpx.Client(timeout=120.0) as client:
            response = client.get(REMOTE_CSV_URL)
            response.raise_for_status()
            raw = response.content
        print(f"Downloaded {len(raw):,} bytes")

    if raw.startswith(b"\xff\xfe") or raw.startswith(b"\xfe\xff"):
        text = raw.decode("utf-16")
    else:
        text = raw.decode("utf-8-sig", errors="replace")

    del raw

    stream = io.StringIO(text)
    sample = stream.read(2048)
    stream.seek(0)

    try:
        dialect = csv.Sniffer().sniff(sample, delimiters=",\t")
    except csv.Error:
        dialect = csv.excel_tab

    reader = csv.DictReader(stream, dialect=dialect)
    if reader.fieldnames:
        reader.fieldnames = [f.strip() if f else f for f in reader.fieldnames]

    aggregated: dict[str, dict[str, int]] = defaultdict(lambda: defaultdict(int))
    population: dict[str, float] = {}
    row_count = 0

    for row in reader:
        row_count += 1
        normalized = {k.strip() if k else k: v for k, v in row.items()}

        meshblock_raw = str(normalized.get("Meshblock", "")).strip()
        if (
            not meshblock_raw
            or not meshblock_raw.lstrip("-").isdigit()
            or int(meshblock_raw) <= 0
        ):
            continue

        norm_code = normalize_meshblock(meshblock_raw)

        crime_type = str(normalized.get("ANZSOC Division", "")).strip()
        try:
            victimisations = int(
                str(normalized.get("Victimisations", "0")).strip() or "0"
            )
        except (ValueError, TypeError):
            victimisations = 0

        if crime_type and victimisations > 0:
            aggregated[norm_code][crime_type] += victimisations

        if norm_code not in population:
            pop_val = parse_population(
                str(normalized.get("ELECTORAL_POPULATION_TOTAL", ""))
            )
            if pop_val is not None:
                population[norm_code] = pop_val

    aggregated_plain = {mb: dict(bd) for mb, bd in aggregated.items()}

    output = {
        "meta": {
            "data_source": "NZ Police",
            "time_period": "February 2025 - January 2026",
            "aggregation_level": "Meshblock",
            "rows_processed": row_count,
            "meshblocks_with_crime": len(aggregated_plain),
            "meshblocks_with_population": len(population),
        },
        "crime": aggregated_plain,
        "population": population,
    }

    OUTPUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT_PATH.write_text(json.dumps(output, separators=(",", ":")), encoding="utf-8")

    size_kb = OUTPUT_PATH.stat().st_size / 1024
    print(f"\nDone!")
    print(f"  Rows processed:       {row_count:,}")
    print(f"  Meshblocks (crime):   {len(aggregated_plain):,}")
    print(f"  Meshblocks (pop):     {len(population):,}")
    print(f"  Output:               {OUTPUT_PATH}")
    print(f"  Output size:          {size_kb:.1f} KB")


if __name__ == "__main__":
    main()
