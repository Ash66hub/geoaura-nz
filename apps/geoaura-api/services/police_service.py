import csv
import io
import json
import ssl
import time
import urllib.parse
import urllib.request
import httpx
from collections import defaultdict
from pathlib import Path
from typing import Any, Optional


class PoliceService:
    """Aggregate NZ Police victimisation data for meshblock-level analytics."""

    _CACHE_TTL_SECONDS = 3600.0

    MESHBLOCK_2025_QUERY_URL = (
        "https://services2.arcgis.com/vKb0s8tBIA3bdocZ/arcgis/rest/services/"
        "Meshblock_2025/FeatureServer/0/query"
    )
    REMOTE_CSV_URL = (
        "https://qzoievmtpylfdvbteruc.supabase.co/storage/v1/object/public/raw-data/"
        "NZPoliceData/Download%20Table_Full%20Data_data%20Feb2025_to_Jan2026_with_population.csv"
    )

    def __init__(self):
        nz_police_data_dir = (
            Path(__file__).resolve().parent.parent.parent.parent
            / "data"
            / "raw"
            / "NZPoliceData"
        )
        self.csv_path = (
            nz_police_data_dir
            / "Download Table_Full Data_data Feb2025_to_Jan2026_with_population.csv"
        )

        self._aggregated_cache: dict[str, dict[str, int]] | None = None
        self._population_cache: dict[str, float] | None = None
        self._cache_time: float | None = None

    def _cache_expired(self) -> bool:
        if self._cache_time is None:
            return True
        return (time.time() - self._cache_time) > self._CACHE_TTL_SECONDS

    def _get_csv_text(self) -> str:
        """Get CSV content from local file or remote URL."""
        if self.csv_path.exists():
            raw = self.csv_path.read_bytes()
        else:
            with httpx.Client(timeout=60.0) as client:
                response = client.get(self.REMOTE_CSV_URL)
                response.raise_for_status()
                raw = response.content

        if raw.startswith(b"\xff\xfe") or raw.startswith(b"\xfe\xff"):
            return raw.decode("utf-16")
        return raw.decode("utf-8-sig", errors="replace")

    def _parse_csv_once(self) -> tuple[dict[str, dict[str, int]], dict[str, float]]:
        """
        Single-pass CSV parse producing both aggregated crime data and population data.
        Avoids reading and decoding the 23MB file twice.
        """
        aggregated: dict[str, dict[str, int]] = defaultdict(lambda: defaultdict(int))
        population: dict[str, float] = {}

        text = self._get_csv_text()
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

        for row in reader:
            normalized = {k.strip() if k else k: v for k, v in row.items()}

            meshblock_raw = str(normalized.get("Meshblock", "")).strip()
            if not meshblock_raw or not meshblock_raw.lstrip("-").isdigit() or int(meshblock_raw) <= 0:
                continue

            normalized_code = self._normalize_meshblock_code(meshblock_raw)

            # Crime aggregation
            crime_type = str(normalized.get("ANZSOC Division", "")).strip()
            try:
                victimisations = int(str(normalized.get("Victimisations", "0")).strip() or "0")
            except (ValueError, TypeError):
                victimisations = 0

            if crime_type and victimisations > 0:
                aggregated[meshblock_raw][crime_type] += victimisations

            # Population (write once per meshblock; later rows overwrite but value is constant)
            if normalized_code not in population:
                pop_val = self._parse_population_value(
                    str(normalized.get("ELECTORAL_POPULATION_TOTAL", ""))
                )
                if pop_val is not None:
                    population[normalized_code] = pop_val

        aggregated_plain = {mesh: dict(breakdown) for mesh, breakdown in aggregated.items()}
        return aggregated_plain, population

    def _ensure_cache(self) -> None:
        if not self._cache_expired():
            return
        self._aggregated_cache, self._population_cache = self._parse_csv_once()
        self._cache_time = time.time()

    def get_aggregated_data(self) -> dict[str, dict[str, int]]:
        self._ensure_cache()
        return self._aggregated_cache  # type: ignore[return-value]

    def get_population_data(self) -> dict[str, float]:
        self._ensure_cache()
        return self._population_cache  # type: ignore[return-value]

    @staticmethod
    def _parse_population_value(value: str) -> Optional[float]:
        text = str(value).strip()
        if text in {"", "-999"}:
            return None
        try:
            parsed = float(text)
            return parsed if parsed >= 0 else None
        except (TypeError, ValueError):
            return None

    @staticmethod
    def _normalize_meshblock_code(code: str) -> str:
        normalized = code.strip()
        if not normalized:
            return normalized
        return normalized.lstrip("0") or "0"

    def _fetch_meshblocks_for_extent(
        self,
        min_lng: float,
        min_lat: float,
        max_lng: float,
        max_lat: float,
        limit: int,
    ) -> dict[str, Any]:
        params = {
            "where": "1=1",
            "geometry": f"{min_lng},{min_lat},{max_lng},{max_lat}",
            "geometryType": "esriGeometryEnvelope",
            "inSR": "4326",
            "spatialRel": "esriSpatialRelIntersects",
            "outFields": "*",
            "returnGeometry": "true",
            "outSR": "4326",
            "f": "geojson",
            "resultRecordCount": str(limit),
        }
        url = f"{self.MESHBLOCK_2025_QUERY_URL}?{urllib.parse.urlencode(params)}"
        context = ssl._create_unverified_context()
        with urllib.request.urlopen(url, timeout=40, context=context) as response:
            return json.loads(response.read().decode("utf-8"))

    def get_police_incidents_for_extent(
        self,
        min_lng: float,
        min_lat: float,
        max_lng: float,
        max_lat: float,
        limit: int = 2000,
    ) -> dict[str, Any]:
        self._ensure_cache()
        aggregated_data = self._aggregated_cache
        population_data = self._population_cache

        meshblocks_geojson = self._fetch_meshblocks_for_extent(
            min_lng=min_lng,
            min_lat=min_lat,
            max_lng=max_lng,
            max_lat=max_lat,
            limit=limit,
        )

        features: list[dict[str, Any]] = []
        for feature in meshblocks_geojson.get("features", []):
            props = feature.get("properties", {}) or {}
            raw_code = str(props.get("MB2025_V2_00") or props.get("MB2025_V1_00", "")).strip()
            normalized_code = self._normalize_meshblock_code(raw_code)
            if not normalized_code:
                continue

            crime_breakdown = aggregated_data.get(normalized_code)  # type: ignore[union-attr]
            if not crime_breakdown:
                continue

            total_victimisations = sum(crime_breakdown.values())
            land_area = props.get("LAND_AREA_SQ_KM")
            density = None
            population_estimate = population_data.get(normalized_code)  # type: ignore[union-attr]
            population_adjusted_rate = None

            try:
                land_area_val = float(land_area)
                if land_area_val > 0:
                    density = total_victimisations / land_area_val
            except (TypeError, ValueError):
                density = None

            if population_estimate and population_estimate > 0:
                population_adjusted_rate = (total_victimisations / population_estimate) * 1000

            features.append(
                {
                    "type": "Feature",
                    "id": normalized_code,
                    "geometry": feature.get("geometry"),
                    "properties": {
                        "meshblock_code": normalized_code,
                        "meshblock_code_padded": raw_code,
                        "victimisation_sum": total_victimisations,
                        "victimisation_rate": density,
                        "victimisation_rate_population": population_adjusted_rate,
                        "population_estimate": population_estimate,
                        "land_area_sq_km": land_area,
                        "crime_breakdown": crime_breakdown,
                    },
                }
            )

        return {
            "type": "FeatureCollection",
            "features": features,
            "properties": {
                "data_source": "NZ Police + Stats NZ Meshblock 2025",
                "time_period": "February 2025 - January 2026",
                "aggregation_level": "Meshblock",
                "aggregate_type": "victimisations",
            },
        }
