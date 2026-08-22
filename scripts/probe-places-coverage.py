#!/usr/bin/env python3
"""Measure whether Google Places actually finds businesses at given coordinates (#16).

Compares Google Places (New) against OpenStreetMap via Overpass, at coordinates
you supply. Answers "is automatic place suggestion worth it here", which #5's
provider decision rested on and #16 measured for the first time.

    export GOOGLE_MAPS_API_KEY=$(grep '^GOOGLE_MAPS_API_KEY=' .env | cut -d= -f2-)
    python3 scripts/probe-places-coverage.py                    # default sample
    python3 scripts/probe-places-coverage.py 51.9345,4.4165 ...  # your own

REPORTS COUNTS AND TYPES ONLY — never names or addresses. Under EEA terms
(#5, docs/research/place-data-terms.md) Google's place_id may be stored
indefinitely and its names and addresses may not be stored at ANY duration.
Printing them into a terminal someone pastes into an issue is storage, so this
script cannot print them: the field mask never requests them.

Costs nothing: Nearby Search Pro has a free monthly allowance far above this.
"""

# macOS ships Python 3.9, where `list[dict] | None` is a runtime TypeError in an
# annotation. This makes annotations lazy so the modern syntax is safe here.
from __future__ import annotations

import collections
import json
import os
import sys
import time
import urllib.request

RADIUS_M = 150.0
"""Deliberately close to a real place match radius (#11 default is 100 m), not a
wide net. A 500 m search returns 20 hits everywhere and only proves that cities
contain businesses."""

# Rotterdam Spaanse Polder — the business park #5 measured with Overpass and
# found near-useless for company names. Same ground, so the two are comparable.
DEFAULT_SPOTS = [
    ("Spaanse Polder N", 51.9345, 4.4165),
    ("Spaanse Polder C", 51.9310, 4.4230),
    ("Spaanse Polder S", 51.9268, 4.4290),
    ("Spaanse Polder W", 51.9300, 4.4100),
    ("Spaanse Polder E", 51.9330, 4.4340),
]

OVERPASS = "https://overpass-api.de/api/interpreter"
# Overpass is a donated public resource with a usage policy. Pace the requests
# and back off on 429 rather than hammering it.
OVERPASS_GAP_S = 8
OVERPASS_RETRIES = 3


def google_nearby(lat: float, lon: float, key: str) -> list[dict]:
    body = {
        "locationRestriction": {"circle": {"center": {"latitude": lat, "longitude": lon}, "radius": RADIUS_M}},
        "maxResultCount": 20,  # the API's ceiling; hitting it means "at least 20"
    }
    request = urllib.request.Request(
        "https://places.googleapis.com/v1/places:searchNearby",
        data=json.dumps(body).encode(),
        method="POST",
    )
    request.add_header("Content-Type", "application/json")
    request.add_header("X-Goog-Api-Key", key)
    # id and primaryType ONLY. Adding displayName here would make the output
    # unstorable — see the module docstring.
    request.add_header("X-Goog-FieldMask", "places.id,places.primaryType")
    with urllib.request.urlopen(request, timeout=30) as response:
        return json.loads(response.read()).get("places", [])


def overpass_named(lat: float, lon: float) -> list[dict] | None:
    """Named business-ish OSM features. None when Overpass refused."""
    radius = int(RADIUS_M)
    clauses = "".join(
        f'node(around:{radius},{lat},{lon})["name"]["{tag}"];way(around:{radius},{lat},{lon})["name"]["{tag}"];'
        for tag in ("office", "shop", "craft", "amenity")
    )
    query = f"[out:json][timeout:60];({clauses});out tags;"

    for attempt in range(OVERPASS_RETRIES):
        try:
            request = urllib.request.Request(
                OVERPASS,
                data=query.encode(),
                headers={"User-Agent": "porsche-ev-insights coverage probe (#16)"},
            )
            with urllib.request.urlopen(request, timeout=90) as response:
                return json.loads(response.read()).get("elements", [])
        except Exception:
            time.sleep(OVERPASS_GAP_S * (attempt + 1))
    return None


def parse_spots(args: list[str]) -> list[tuple[str, float, float]]:
    spots = []
    for i, arg in enumerate(args, start=1):
        lat, _, lon = arg.partition(",")
        spots.append((f"spot {i}", float(lat), float(lon)))
    return spots


def main(argv: list[str]) -> int:
    key = os.environ.get("GOOGLE_MAPS_API_KEY")
    if not key:
        print("GOOGLE_MAPS_API_KEY is not set. Source it from .env first.", file=sys.stderr)
        return 2

    spots = parse_spots(argv[1:]) if len(argv) > 1 else DEFAULT_SPOTS
    print(f"Radius {int(RADIUS_M)} m · {len(spots)} coordinate(s)\n")
    print(f"{'spot':20} {'Google':>8} {'OSM named':>11} {'OSM office':>11}")
    print("-" * 54)

    google_total = osm_total = office_total = refused = 0
    types: collections.Counter[str] = collections.Counter()

    for name, lat, lon in spots:
        try:
            places = google_nearby(lat, lon, key)
        except Exception as error:
            print(f"{name:20} google failed: {error}", file=sys.stderr)
            continue

        google_total += len(places)
        for place in places:
            primary = place.get("primaryType")
            if primary:
                types[primary] += 1

        elements = overpass_named(lat, lon)
        if elements is None:
            refused += 1
            print(f"{name:20} {len(places):>8} {'(refused)':>11} {'-':>11}")
            continue

        offices = [e for e in elements if "office" in e.get("tags", {})]
        osm_total += len(elements)
        office_total += len(offices)
        print(f"{name:20} {len(places):>8} {len(elements):>11} {len(offices):>11}")
        time.sleep(OVERPASS_GAP_S)

    print("-" * 54)
    print(f"{'TOTAL':20} {google_total:>8} {osm_total:>11} {office_total:>11}")
    if refused:
        print(f"  ({refused} coordinate(s) rate-limited by Overpass — its column understates)")
    print("\nGoogle caps at 20 per call, so any spot showing 20 is a FLOOR, not a count.")

    if types:
        print("\nGoogle primary types (taxonomy, not names):")
        for kind, count in types.most_common(15):
            print(f"  {count:>3}  {kind}")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
