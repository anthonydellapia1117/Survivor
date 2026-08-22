#!/usr/bin/env python3
"""Independent verification: seeded schedule vs ESPN's scoreboard API.

The schedule is SEEDED from nflverse, so nflverse cannot corroborate itself.
ESPN is an unrelated source; agreement between the two is real evidence the
seeded dates and matchups are right.

Usage:
    # fetch the 18 weeks (curl, so it goes through the egress proxy)
    mkdir -p /tmp/espn && for w in $(seq 1 18); do \\
      curl -s -o /tmp/espn/w$w.json \\
      "https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard?dates=2026&seasontype=2&week=$w"; \\
    done
    python3 scripts/schedule/verify-against-espn.py /tmp/espn

ESPN publishes a midnight placeholder with timeValid=false for games whose
TV window is not yet assigned (late-season Sunday games under flex rules).
Those are compared on DATE only — which is what selects the deadline bucket.
Games with timeValid=true are compared on the exact kickoff instant.
"""
import json, re, glob, sys, os
from datetime import datetime
from zoneinfo import ZoneInfo

REPO = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
MIG = os.path.join(REPO, "supabase/migrations/20260822000014_nfl_schedule.sql")
ESPN_DIR = sys.argv[1] if len(sys.argv) > 1 else "/tmp/espn"
ET = ZoneInfo("America/New_York")
MAP = {"WSH": "WAS", "JAC": "JAX", "LA": "LAR"}
norm = lambda t: MAP.get(t, t)

sql = open(MIG).read()
rows = re.findall(r"\('([^']+)', (\d+), '([^']+)', '([^']+)', '([^']+)', '([^']+)'\)", sql)
seeded = {}
for gid, week, kick, day, away, home in rows:
    dt = datetime.fromisoformat(kick.replace("+00", "+00:00"))
    seeded[(int(week), away, home)] = dict(id=gid, week=int(week), utc=dt, day=day, away=away, home=home)

espn = {}
for f in glob.glob(os.path.join(ESPN_DIR, "w*.json")):
    data = json.load(open(f))
    week = data["week"]["number"]
    for e in data.get("events", []):
        c = e["competitions"][0]
        home = norm(next(x for x in c["competitors"] if x["homeAway"] == "home")["team"]["abbreviation"])
        away = norm(next(x for x in c["competitors"] if x["homeAway"] == "away")["team"]["abbreviation"])
        espn[(week, away, home)] = dict(
            week=week, utc=datetime.fromisoformat(e["date"].replace("Z", "+00:00")),
            home=home, away=away, name=e["shortName"], time_valid=bool(c.get("timeValid")),
        )

print(f"seeded: {len(seeded)}   ESPN: {len(espn)}")

hard, tbd = [], []
for k, s in seeded.items():
    e = espn.get(k)
    if not e:
        hard.append(f"NOT IN ESPN: W{s['week']} {s['away']}@{s['home']} ({s['id']})")
        continue
    s_et, e_et = s["utc"].astimezone(ET), e["utc"].astimezone(ET)
    # Calendar day must always agree — it selects the deadline bucket.
    if s_et.date() != e_et.date():
        hard.append(f"DATE W{s['week']} {s['away']}@{s['home']}: seed {s_et:%a %b %-d} vs ESPN {e_et:%a %b %-d}")
        continue
    if s["day"] != s_et.strftime("%A"):
        hard.append(f"DAYTAG W{s['week']} {s['away']}@{s['home']}: stored {s['day']} vs ET day {s_et:%A}")
        continue
    if e["time_valid"]:
        if s["utc"] != e["utc"]:
            hard.append(f"KICKOFF W{s['week']} {s['away']}@{s['home']}: seed {s_et:%a %-I:%M %p} vs ESPN {e_et:%a %-I:%M %p} ET")
    else:
        tbd.append(f"W{s['week']} {s['away']}@{s['home']} (seed {s_et:%a %b %-d %-I:%M %p} ET)")

for k, e in espn.items():
    if k not in seeded:
        hard.append(f"NOT IN SEED: W{e['week']} {e['away']}@{e['home']} ({e['name']})")

print(f"\nHARD DISCREPANCIES (date / matchup / confirmed-kickoff): {len(hard)}")
for p in hard:
    print("  " + p)
if not hard:
    print("  none — every game agrees on week, date, home, away, and (where ESPN")
    print("  has confirmed the window) the exact kickoff time.")

print(f"\nESPN time still TBD (timeValid=false), date agrees, compared on date only: {len(tbd)}")
for t in tbd:
    print("  " + t)

confirmed = sum(1 for e in espn.values() if e["time_valid"])
print(f"\nExact-time matches verified against ESPN: {confirmed} of {len(espn)}")
