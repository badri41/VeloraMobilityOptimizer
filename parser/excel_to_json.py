#!/usr/bin/env python3
"""
Excel to JSON converter for this...

Usage: python parser/excel_to_json.py input.xlsx output.json

Expected sheets (optional): vehicles, requests, employees (not required)

"""

import os
import sys
import json
import pandas as pd
from datetime import datetime

def load_dotenv_env():
    """Load env vars from env/.env if present (simple KEY=VALUE parser)."""
    env_path = os.path.join(os.path.dirname(__file__), '..', 'env', '.env')
    env_path = os.path.abspath(env_path)
    if not os.path.exists(env_path):
        return
    with open(env_path, 'r') as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith('#'):
                continue
            if '=' not in line:
                continue
            key, val = line.split('=', 1)
            key = key.strip()
            val = val.strip().strip('"').strip("'")
            if key:
                os.environ[key] = val

def sheet_to_records(df):
    df = df.where(pd.notnull(df), None)
    return df.to_dict(orient='records')

def get_sharing_limit(val):
    if not val or not isinstance(val, str): return 100
    v = val.lower().strip()
    if 'single' in v: return 1
    if 'double' in v: return 2
    if 'triple' in v: return 3
    return 100

def get_vehicle_type(val):
    if not val: return "any"
    return str(val).lower().strip()

def normalize_text(val, default=""):
    if val is None:
        return default
    return str(val).strip()

def time_to_minutes(time_obj):
    """Convert time object or string (HH:MM) to minutes since midnight."""
    import datetime as dt
    if isinstance(time_obj, dt.time):
        return time_obj.hour * 60 + time_obj.minute
    elif isinstance(time_obj, str):
        try:
            h, m = time_obj.split(':')
            return int(h) * 60 + int(m)
        except:
            return 0.0
    elif isinstance(time_obj, (int, float)):
        return float(time_obj)
    return 0.0

def main():
    load_dotenv_env()
    if len(sys.argv) < 3:
        print("Usage: excel_to_json.py input.xlsx output.json")
        return
    inp = sys.argv[1]
    out = sys.argv[2]
    xls = pd.ExcelFile(inp)
    result = {"config": {"allow_external_maps": False, "maps_api_key": ""}}

    if 'vehicles' in xls.sheet_names:
        df = xls.parse('vehicles')
        vehicles = []
        for idx, r in enumerate(sheet_to_records(df)):
            vehicle_type = get_vehicle_type(r.get('vehicle_type', r.get('type', r.get('Type', 'any'))))
            v = {
                'id': idx,
                'vehicle_id': r.get('vehicle_id', f'V{idx:02d}'),
                'fuel_type': normalize_text(r.get('fuel_type', r.get('fuelType', ''))),
                'vehicle_type': vehicle_type,
                'capacity': int(r.get('capacity', 4)),
                'type': vehicle_type,
                'costPerKm': float(r.get('cost_per_km', r.get('costPerKm', 1.0))),
                'avg_speed_kmph': float(r.get('avg_speed_kmph', r.get('avgSpeedKmph', 0.0))),
                'startLoc': {'lat': float(r.get('current_lat', r.get('startLat', 0.0))), 
                            'lon': float(r.get('current_lng', r.get('startLon', 0.0)))},
                'availabilityTime': time_to_minutes(r.get('available_from', r.get('availabilityTime', 0.0))),
                'category': normalize_text(r.get('category', ''))
            }
            vehicles.append(v)
        result['vehicles'] = vehicles

    # Parse Metadata
    # Default tolerances (minutes)
    tolerances = {1: 30, 2: 20, 3: 15, 4: 10, 5: 5} # Fallback
    weights = {"cost": 0.7, "time": 0.3}

    # Map provider configuration defaults
    map_provider = "haversine"  # Default: fast Haversine * 1.4 approximation
    map_timeout_ms = 2000
    map_max_retries = 2

    if 'metadata' in xls.sheet_names:
        df = xls.parse('metadata')
        meta = {}
        for r in sheet_to_records(df):
            k = str(r.get('key', '')).strip()
            v = r.get('value', None)
            if k and v is not None:
                meta[k] = v

        # Update config
        if 'allow_external_maps' in meta:
            result['config']['allow_external_maps'] = (str(meta['allow_external_maps']).lower() == 'true')

        # Parse map provider settings
        # Valid providers: haversine, osrm, openrouteservice (ors), google_maps (google)
        if 'map_provider' in meta:
            map_provider = str(meta['map_provider']).lower().strip()
        if 'map_timeout_ms' in meta:
            map_timeout_ms = int(meta['map_timeout_ms'])
        if 'map_max_retries' in meta:
            map_max_retries = int(meta['map_max_retries'])

        # Parse tolerances
        for i in range(1, 6):
            k = f'priority_{i}_max_delay_min'
            if k in meta:
                tolerances[i] = int(meta[k])

        # Parse weights
        if 'objective_cost_weight' in meta: weights['cost'] = float(meta['objective_cost_weight'])
        if 'objective_time_weight' in meta: weights['time'] = float(meta['objective_time_weight'])

    result['config']['tolerances'] = tolerances
    result['config']['weights'] = weights
    result['config']['map_provider'] = map_provider
    result['config']['map_timeout_ms'] = map_timeout_ms
    result['config']['map_max_retries'] = map_max_retries

    # Source the API key from environment (metadata never provides it for security)
    maps_api_key = os.getenv('MAPS_API_KEY', '')
    result['config']['maps_api_key'] = maps_api_key

    # If API key is present, enable external maps and use appropriate provider
    if maps_api_key:
        result['config']['allow_external_maps'] = True
        # Auto-select provider based on API key format if not specified
        if map_provider == 'haversine':
            # If key starts with 'AIza' it's Google, otherwise assume OpenRouteService
            if maps_api_key.startswith('AIza'):
                result['config']['map_provider'] = 'google'
            else:
                result['config']['map_provider'] = 'openrouteservice'
    else:
        result['config']['allow_external_maps'] = True  # MapDistance handles fallback

    if 'employees' in xls.sheet_names:
        df = xls.parse('employees')
        # Employees map to requests (trips)
        reqs = []
        for idx, r in enumerate(sheet_to_records(df)):
            req = {
                'id': idx,
                'employee_id': r.get('employee_id', f'E{idx:02d}'),
                'priority': int(r.get('priority', 3)),
                'vehiclePreference': get_vehicle_type(r.get('vehicle_preference', r.get('vehiclePreference', 'any'))),
                'sharingLimit': get_sharing_limit(r.get('sharing_preference', r.get('sharingPreference', 'any'))),
                'pickup': {'lat': float(r.get('pickup_lat', r.get('pickupLat', 0.0))), 
                          'lon': float(r.get('pickup_lng', r.get('pickupLon', 0.0)))},
                'dropoff': {'lat': float(r.get('drop_lat', r.get('dropoffLat', 0.0))), 
                           'lon': float(r.get('drop_lng', r.get('dropoffLon', 0.0)))},
                'earlyTime': time_to_minutes(r.get('earliest_pickup', r.get('earlyTime', 0.0))),
                'lateTime': time_to_minutes(r.get('latest_drop', r.get('lateTime', 1e6))),
                'load': int(r.get('load', r.get('Load', 1)))
            }
            reqs.append(req)
        result['requests'] = reqs
    elif 'requests' in xls.sheet_names:
        df = xls.parse('requests')
        reqs = []
        for r in sheet_to_records(df):
            req = {
                'id': int(r.get('id', 0)),
                'priority': int(r.get('priority', 3)),
                'pickup': {'lat': float(r.get('pickupLat', 0.0)), 'lon': float(r.get('pickupLon', 0.0))},
                'dropoff': {'lat': float(r.get('dropoffLat', 0.0)), 'lon': float(r.get('dropoffLon', 0.0))},
                'earlyTime': float(r.get('earlyTime', 0.0)),
                'lateTime': float(r.get('lateTime', 1e6)),
                'load': int(r.get('load', 1))
            }
            reqs.append(req)
        result['requests'] = reqs

    if 'employees' in xls.sheet_names:
        df = xls.parse('employees')
        emps = []
        for r in sheet_to_records(df):
            e = {
                'id': int(r.get('id', 0)),
                'name': r.get('name', ''),
                'shiftStart': float(r.get('shiftStart', 0.0)),
                'shiftEnd': float(r.get('shiftEnd', 24.0)),
                'startLoc': {'lat': float(r.get('startLat', 0.0)), 'lon': float(r.get('startLon', 0.0))}
            }
            emps.append(e)
        result['employees'] = emps

    # Generic fallback: try to read first sheet as requests if none found
    if 'requests' not in result and 'vehicles' not in result:
        df = xls.parse(xls.sheet_names[0])
        result['requests'] = []
        for r in sheet_to_records(df):
            # expect columns named pickupLat,pickupLon,dropoffLat,dropoffLon
            if all(k in r for k in ('pickupLat','pickupLon','dropoffLat','dropoffLon')):
                req = {
                    'vehiclePreference': get_vehicle_type(r.get('vehicle_preference', r.get('vehiclePreference', 'any'))),
                    'sharingLimit': get_sharing_limit(r.get('sharing_preference', r.get('sharingPreference', 'any'))),
                    'vehiclePreference': get_vehicle_type(r.get('vehicle_preference', r.get('vehiclePreference', 'any'))),
                    'sharingLimit': get_sharing_limit(r.get('sharing_preference', r.get('sharingPreference', 'any'))),
                    'id': int(r.get('id', 0)),
                    'priority': int(r.get('priority', 3)),
                    'pickup': {'lat': float(r.get('pickupLat', 0.0)), 'lon': float(r.get('pickupLon', 0.0))},
                    'dropoff': {'lat': float(r.get('dropoffLat', 0.0)), 'lon': float(r.get('dropoffLon', 0.0))},
                    'earlyTime': float(r.get('earlyTime', 0.0)),
                    'lateTime': float(r.get('lateTime', 1e6)),
                    'load': int(r.get('load', 1))
                }
                result['requests'].append(req)

    # Extract baseline costs if available
    if 'baseline' in xls.sheet_names:
        df = xls.parse('baseline')
        baseline_data = sheet_to_records(df)
        result['baseline'] = baseline_data

    with open(out, 'w') as f:
        json.dump(result, f, indent=2)
    print('Wrote', out)

if __name__ == '__main__':
    main()
