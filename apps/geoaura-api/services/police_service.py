import csv
import io
import json
import ssl
import urllib.parse
import urllib.request
from collections import defaultdict
from pathlib import Path
from typing import Any


class PoliceService:
    """Aggregate NZ Police victimisation data for meshblock-level analytics."""

    MESHBLOCK_2025_QUERY_URL = (
        "https://services2.arcgis.com/vKb0s8tBIA3bdocZ/arcgis/rest/services/"
        "Meshblock_2025/FeatureServer/0/query"
    )

    def __init__(self):
        # services/ -> geoaura-api/ -> apps/ -> repo root
        self.csv_path = (
            Path(__file__).resolve().parent.parent.parent.parent
            / "data"
            / "raw"
            / "NZPoliceData"
            / "Download Table_Full Data_data Feb2025_to_Jan2026.csv"
        )
        self._aggregated_cache: dict[str, dict[str, int]] | None = None

    def parse_police_csv(self) -> dict[str, dict[str, int]]:
        """Parse CSV and aggregate victimisations by meshblock and crime type."""
        data: dict[str, dict[str, int]] = defaultdict(lambda: defaultdict(int))

        if not self.csv_path.exists():
            raise FileNotFoundError(f"Police data CSV not found: {self.csv_path}")

        raw = self.csv_path.read_bytes()

        # NZ Police export is typically UTF-16LE with BOM, but keep fallback for UTF-8 variants.
        if raw.startswith(b"\xff\xfe") or raw.startswith(b"\xfe\xff"):
            text = raw.decode("utf-16")
        else:
            text = raw.decode("utf-8-sig", errors="replace")

        stream = io.StringIO(text)
        sample = stream.read(2048)
        stream.seek(0)

        try:
            dialect = csv.Sniffer().sniff(sample, delimiters=",\t")
        except csv.Error:
            dialect = csv.excel_tab

        reader = csv.DictReader(stream, dialect=dialect)
        if reader.fieldnames:
            reader.fieldnames = [name.strip() if name else name for name in reader.fieldnames]

        for row in reader:
            try:
                normalized = {k.strip() if k else k: v for k, v in row.items()}
                meshblock_raw = str(normalized.get("Meshblock", "")).strip()
                crime_type = str(normalized.get("ANZSOC Division", "")).strip()
                victimisations = int(str(normalized.get("Victimisations", "0")).strip() or "0")

                # Skip invalid meshblocks like -118 sentinel rows.
                if (
                    not meshblock_raw
                    or not meshblock_raw.lstrip("-").isdigit()
                    or int(meshblock_raw) <= 0
                    or not crime_type
                    or victimisations <= 0
                ):
                    continue

                data[meshblock_raw][crime_type] += victimisations
            except (ValueError, TypeError):
                continue

        return {mesh: dict(breakdown) for mesh, breakdown in data.items()}

    def build_geojson_for_api_response(
        self,
        aggregated_police_data: dict[str, dict[str, int]],
    ) -> dict[str, Any]:
        """Build API payload as a FeatureCollection keyed by meshblock."""
        features: list[dict[str, Any]] = []

        for meshblock_id, crime_breakdown in aggregated_police_data.items():
            total_victimisations = sum(crime_breakdown.values())

            features.append(
                {
                    "type": "Feature",
                    "id": meshblock_id,
                    "geometry": None,
                    "properties": {
                        "meshblock_code": meshblock_id,
                        "victimisation_sum": total_victimisations,
                        "victimisation_rate": None,
                        "population_estimate": None,
                        "crime_breakdown": crime_breakdown,
                    },
                }
            )

        return {
            "type": "FeatureCollection",
            "features": features,
            "properties": {
                "data_source": "NZ Police",
                "time_period": "February 2025 - January 2026",
                "aggregation_level": "Meshblock",
                "aggregate_type": "victimisations",
            },
        }

    def get_police_incidents(self) -> dict[str, Any]:
        aggregated_data = self.get_aggregated_data()
        return self.build_geojson_for_api_response(aggregated_data)

    def get_aggregated_data(self) -> dict[str, dict[str, int]]:
        if self._aggregated_cache is None:
            self._aggregated_cache = self.parse_police_csv()
        return self._aggregated_cache

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
            "outFields": "MB2025_V1_00,LAND_AREA_SQ_KM",
            "returnGeometry": "true",
            "outSR": "4326",
            "f": "geojson",
            "resultRecordCount": str(limit),
        }
        url = f"{self.MESHBLOCK_2025_QUERY_URL}?{urllib.parse.urlencode(params)}"

        # Keep this endpoint resilient in macOS dev environments where cert chains vary.
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
        aggregated_data = self.get_aggregated_data()
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
            raw_code = str(props.get("MB2025_V1_00", "")).strip()
            normalized_code = self._normalize_meshblock_code(raw_code)
            if not normalized_code:
                continue

            crime_breakdown = aggregated_data.get(normalized_code)
            if not crime_breakdown:
                continue

            total_victimisations = sum(crime_breakdown.values())
            land_area = props.get("LAND_AREA_SQ_KM")
            density = None
            try:
                land_area_val = float(land_area)
                if land_area_val > 0:
                    density = total_victimisations / land_area_val
            except (TypeError, ValueError):
                density = None

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
                        "population_estimate": None,
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
