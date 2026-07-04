"""
Quick end-to-end verification of the Admin SQL Query Tool.

Run while the backend is up on http://localhost:8080:
    python test_sql_console.py

Checks:
  1. Login as system-admin (IT/Admin) works.
  2. POST /api/admin/sql-query with a SELECT returns rows.
  3. A non-query statement (UPDATE) returns rows_affected.
  4. The endpoint rejects anonymous callers (401).
  5. The endpoint rejects a non-admin user (403) - treasury-maker.
"""
import json
import sys
import urllib.request
import urllib.error

API = "http://localhost:8080/api"
PASSED, FAILED = [], []


def call(path, body=None, token=None, method=None):
    req = urllib.request.Request(
        API + path,
        data=json.dumps(body).encode() if body is not None else None,
        method=method or ("POST" if body is not None else "GET"),
        headers={"Content-Type": "application/json",
                 **({"Authorization": f"Bearer {token}"} if token else {})},
    )
    try:
        with urllib.request.urlopen(req) as r:
            return r.status, json.loads(r.read().decode() or "null")
    except urllib.error.HTTPError as e:
        return e.code, None


def check(name, ok, detail=""):
    (PASSED if ok else FAILED).append(name)
    print(f"  {'PASS' if ok else 'FAIL'}  {name}{('  -- ' + detail) if detail else ''}")


print("1) Login as system-admin")
status, login = call("/auth/login", {"username": "system-admin", "password": "Password123"})
admin_token = (login or {}).get("token")
check("admin login", status == 200 and bool(admin_token))
if not admin_token:
    sys.exit(1)

print("2) SELECT query")
status, res = call("/admin/sql-query", {"query": "SELECT UserId, Username, IsActive FROM AppUsers ORDER BY UserId"}, admin_token)
check("SELECT returns rows", status == 200 and res.get("success") and res.get("rowCount", 0) > 0,
      f"rowCount={res.get('rowCount') if res else '?'}")

print("3) Non-query statement (harmless UPDATE)")
status, res = call("/admin/sql-query", {"query": "UPDATE AppUsers SET DisplayName = DisplayName WHERE Username = 'system-admin'"}, admin_token)
data = (res or {}).get("data") or [{}]
check("UPDATE returns rows_affected", status == 200 and res.get("success") and "rows_affected" in data[0],
      f"data={data[:1]}")

print("4) Anonymous caller is rejected")
status, _ = call("/admin/sql-query", {"query": "SELECT 1"})
check("anonymous -> 401", status == 401, f"status={status}")

print("5) Non-admin caller is rejected")
status, login = call("/auth/login", {"username": "treasury-maker", "password": "Password123"})
maker_token = (login or {}).get("token")
if maker_token:
    status, _ = call("/admin/sql-query", {"query": "SELECT 1"}, maker_token)
    check("treasury-maker -> 403", status == 403, f"status={status}")
else:
    check("treasury-maker login", False, "could not log in")

print(f"\n{len(PASSED)} passed, {len(FAILED)} failed")
sys.exit(1 if FAILED else 0)
