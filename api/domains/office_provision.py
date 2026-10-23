"""Create and remove one office's Railway service, database, and hostname.

The registry in DGA's database stores the office name and hostname. It does
not store the other database URL. That URL lives only on the new service.
"""
from __future__ import annotations

import json
import os
import secrets
import time
import urllib.error
import urllib.request
from typing import Callable, Optional

BASE_DOMAIN = os.environ.get("OFFICE_BASE_DOMAIN", "privateofficedesk.com")
PROJECT_ID = os.environ.get("RAILWAY_PROJECT_ID", "091577c5-dea0-4800-9896-aa661a89c4b7")
ENVIRONMENT_ID = os.environ.get("RAILWAY_ENVIRONMENT_ID", "46efbe24-cfc8-43f6-9e02-d778eb69f817")
REPO = os.environ.get("OFFICE_GITHUB_REPO", "alecmazo/DGA-research-analyst")
POSTGRES_IMAGE = "ghcr.io/railwayapp-templates/postgres-ssl:18"
# DGA's own services. Erase refuses these ids.
PROTECTED_SERVICES = {
    "6aac66bc-eea5-45a1-b808-ff4275886491",  # web
    "9a383655-0d8f-4582-99c7-960ca03c6c5b",  # sliw
    "ca04fafc-bcb9-4dc2-9644-9ea1b190d53d",  # Postgres
}

_GQL = "https://backboard.railway.com/graphql/v2"


class OfficeProvisionError(RuntimeError):
    pass


def railway_token() -> str:
    return (os.environ.get("RAILWAY_API_TOKEN") or os.environ.get("RAILWAY_TOKEN") or "").strip()


def configured() -> bool:
    return bool(railway_token())


def hostname_for(slug: str, base: str = "") -> str:
    label = (slug or "").strip().lower().replace("_", "-").strip("-")
    domain = (base or BASE_DOMAIN).strip().lower()
    return f"{label}.{domain}"


def service_names(slug: str) -> tuple[str, str]:
    label = (slug or "").strip().lower().replace("_", "-").strip("-")
    return f"office-{label}", f"office-{label}-db"


def _post_json(url: str, payload: dict, headers: dict, timeout: int = 60) -> dict:
    req = urllib.request.Request(
        url,
        data=json.dumps(payload).encode(),
        headers=headers,
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            body = json.loads(resp.read().decode() or "{}")
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode(errors="replace")[:300]
        raise OfficeProvisionError(f"Railway answered {exc.code}. {detail}") from exc
    if body.get("errors"):
        message = body["errors"][0].get("message") or "Railway request failed"
        raise OfficeProvisionError(message)
    return body.get("data") or {}


def railway_call(query: str, variables: dict) -> dict:
    token = railway_token()
    if not token:
        raise OfficeProvisionError("This service has no Railway token, so it cannot create an office.")
    return _post_json(
        _GQL,
        {"query": query, "variables": variables},
        {"Content-Type": "application/json", "Authorization": f"Bearer {token}"},
    )


def _create_service(name: str, source: dict, variables: Optional[dict] = None, branch: str = "") -> str:
    payload = {
        "projectId": PROJECT_ID,
        "environmentId": ENVIRONMENT_ID,
        "name": name,
        "source": source,
    }
    if variables:
        payload["variables"] = variables
    if branch:
        payload["branch"] = branch
    data = railway_call(
        """
        mutation($input: ServiceCreateInput!) {
          serviceCreate(input: $input) { id name }
        }
        """,
        {"input": payload},
    )
    service_id = ((data.get("serviceCreate") or {}).get("id") or "").strip()
    if not service_id or service_id in PROTECTED_SERVICES:
        raise OfficeProvisionError("Railway did not return a new service id.")
    return service_id


def _volume(service_id: str) -> str:
    data = railway_call(
        """
        mutation($input: VolumeCreateInput!) {
          volumeCreate(input: $input) { id }
        }
        """,
        {
            "input": {
                "projectId": PROJECT_ID,
                "environmentId": ENVIRONMENT_ID,
                "serviceId": service_id,
                "mountPath": "/var/lib/postgresql/data",
            }
        },
    )
    return ((data.get("volumeCreate") or {}).get("id") or "").strip()


def _set_database_url(web_id: str, db_service_name: str) -> None:
    railway_call(
        """
        mutation($input: VariableUpsertInput!) {
          variableUpsert(input: $input)
        }
        """,
        {
            "input": {
                "projectId": PROJECT_ID,
                "environmentId": ENVIRONMENT_ID,
                "serviceId": web_id,
                "name": "DATABASE_URL",
                "value": "${{%s.DATABASE_URL}}" % db_service_name,
            }
        },
    )


def _deploy(service_id: str) -> None:
    railway_call(
        """
        mutation($environmentId: String!, $serviceId: String!) {
          serviceInstanceDeployV2(environmentId: $environmentId, serviceId: $serviceId)
        }
        """,
        {"environmentId": ENVIRONMENT_ID, "serviceId": service_id},
    )


def _add_domain(service_id: str, hostname: str) -> tuple[str, list[dict]]:
    data = railway_call(
        """
        mutation($input: CustomDomainCreateInput!) {
          customDomainCreate(input: $input) {
            id
            domain
            status { dnsRecords { recordType hostlabel fqdn requiredValue } }
          }
        }
        """,
        {
            "input": {
                "projectId": PROJECT_ID,
                "environmentId": ENVIRONMENT_ID,
                "serviceId": service_id,
                "domain": hostname,
                "targetPort": 8080,
            }
        },
    )
    created = data.get("customDomainCreate") or {}
    records = ((created.get("status") or {}).get("dnsRecords") or [])
    return (created.get("id") or "").strip(), records


def _record_type(raw: str) -> str:
    text = (raw or "").upper()
    if "CNAME" in text:
        return "CNAME"
    if "TXT" in text:
        return "TXT"
    if text.endswith("_A"):
        return "A"
    return ""


def cloudflare_zone_id() -> str:
    explicit = (os.environ.get("CLOUDFLARE_ZONE_ID") or "").strip()
    if explicit:
        return explicit
    token = (os.environ.get("CLOUDFLARE_API_TOKEN") or "").strip()
    if not token:
        return ""
    req = urllib.request.Request(
        f"https://api.cloudflare.com/client/v4/zones?name={BASE_DOMAIN}",
        headers={"Authorization": f"Bearer {token}"},
    )
    with urllib.request.urlopen(req, timeout=30) as resp:
        body = json.loads(resp.read().decode() or "{}")
    results = body.get("result") or []
    if not results:
        raise OfficeProvisionError(f"Cloudflare has no zone for {BASE_DOMAIN}.")
    return results[0].get("id") or ""


def publish_dns(records: list[dict]) -> list[str]:
    """Create grey-cloud records. Returns Cloudflare record ids. Empty if no token."""
    token = (os.environ.get("CLOUDFLARE_API_TOKEN") or "").strip()
    if not token:
        return []
    zone = cloudflare_zone_id()
    ids: list[str] = []
    for record in records:
        rtype = _record_type(record.get("recordType") or "")
        content = (record.get("requiredValue") or "").strip()
        name = (record.get("fqdn") or record.get("hostlabel") or "").strip()
        if not rtype or not content or not name:
            continue
        payload = {
            "type": rtype,
            "name": name,
            "content": content,
            "ttl": 1,
            "proxied": False,
        }
        req = urllib.request.Request(
            f"https://api.cloudflare.com/client/v4/zones/{zone}/dns_records",
            data=json.dumps(payload).encode(),
            headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"},
            method="POST",
        )
        with urllib.request.urlopen(req, timeout=30) as resp:
            body = json.loads(resp.read().decode() or "{}")
        if not body.get("success"):
            raise OfficeProvisionError("Cloudflare did not publish the office hostname.")
        ids.append(((body.get("result") or {}).get("id") or ""))
    return [item for item in ids if item]


def delete_dns(record_ids: list[str]) -> None:
    token = (os.environ.get("CLOUDFLARE_API_TOKEN") or "").strip()
    if not token or not record_ids:
        return
    zone = cloudflare_zone_id()
    for record_id in record_ids:
        req = urllib.request.Request(
            f"https://api.cloudflare.com/client/v4/zones/{zone}/dns_records/{record_id}",
            headers={"Authorization": f"Bearer {token}"},
            method="DELETE",
        )
        try:
            urllib.request.urlopen(req, timeout=30).read()
        except urllib.error.HTTPError:
            continue


def _database_url(db_service_id: str) -> str:
    data = railway_call(
        """
        query($projectId: String!, $environmentId: String!, $serviceId: String) {
          variables(projectId: $projectId, environmentId: $environmentId, serviceId: $serviceId)
        }
        """,
        {
            "projectId": PROJECT_ID,
            "environmentId": ENVIRONMENT_ID,
            "serviceId": db_service_id,
        },
    )
    variables = data.get("variables") or {}
    if isinstance(variables, str):
        try:
            variables = json.loads(variables)
        except json.JSONDecodeError:
            variables = {}
    url = (variables.get("DATABASE_URL") or variables.get("DATABASE_PUBLIC_URL") or "").strip()
    if not url or url.startswith("${{"):
        return ""
    return url


def seed_login(database_url: str, email: str, name: str, password: str) -> str:
    """Create the first GP user on the office database. Returns the user id."""
    import psycopg

    import auth_v2

    password_hash, salt = auth_v2.hash_password(password)
    user_id = "gp_" + secrets.token_hex(8)
    record = {
        "lp_id": user_id,
        "email": email,
        "name": name,
        "role": "gp",
        "password_hash_hex": password_hash,
        "password_salt_hex": salt,
        "fund_memberships": {},
        "managed_account_ids": [],
        "must_change_password": True,
        "demo_mode": False,
    }
    with psycopg.connect(database_url, connect_timeout=10) as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                CREATE TABLE IF NOT EXISTS lp_credentials_kv (
                    lp_id TEXT PRIMARY KEY,
                    data_json TEXT NOT NULL,
                    updated_at TIMESTAMPTZ DEFAULT now()
                )
                """
            )
            cur.execute(
                """
                INSERT INTO lp_credentials_kv (lp_id, data_json, updated_at)
                VALUES (%s, %s, now())
                """,
                (user_id, json.dumps(record)),
            )
        conn.commit()
    return user_id


def create_office_instance(
    slug: str,
    email: str,
    contact_name: str,
    password: str,
    seed: Optional[Callable[..., str]] = None,
) -> dict:
    """Steps 1–6. Raises OfficeProvisionError. Does not write DGA's registry."""
    web_name, db_name = service_names(slug)
    hostname = hostname_for(slug)
    db_id = ""
    web_id = ""
    try:
        db_id = _create_service(db_name, {"image": POSTGRES_IMAGE})
        _volume(db_id)
        web_id = _create_service(
            web_name,
            {"repo": REPO},
            {"DATABASE_URL": "${{%s.DATABASE_URL}}" % db_name},
            branch="main",
        )
        _set_database_url(web_id, db_name)
        _deploy(db_id)
        _deploy(web_id)
        domain_id, records = _add_domain(web_id, hostname)
    except OfficeProvisionError:
        try:
            erase_office_instance(web_id, db_id, "", [])
        except OfficeProvisionError:
            pass
        raise
    dns_ids = publish_dns(records)
    public_records = [
        {
            "type": _record_type(item.get("recordType") or ""),
            "name": item.get("fqdn") or item.get("hostlabel") or hostname,
            "content": item.get("requiredValue") or "",
        }
        for item in records
    ]
    login_error = ""
    try:
        _seed_when_ready(db_id, email, contact_name or email, password, seed)
    except OfficeProvisionError as exc:
        login_error = str(exc)
    return {
        "hostname": hostname,
        "web_service_id": web_id,
        "db_service_id": db_id,
        "domain_id": domain_id,
        "dns_record_ids": dns_ids,
        "dns_records": public_records,
        "login_error": login_error,
        "dns_published": bool(dns_ids),
    }


def _seed_when_ready(db_id: str, email: str, name: str, password: str, seed: Optional[Callable[..., str]]) -> None:
    seeder = seed or seed_login
    last = "The new database did not answer in time."
    for _ in range(8):
        url = _database_url(db_id)
        if url:
            try:
                seeder(url, email, name, password)
                return
            except Exception as exc:
                last = str(exc)[:200]
        time.sleep(3)
    raise OfficeProvisionError(last)


def erase_office_instance(web_service_id: str, db_service_id: str, domain_id: str, dns_record_ids: list[str]) -> None:
    for service_id in (web_service_id, db_service_id):
        if service_id and service_id in PROTECTED_SERVICES:
            raise OfficeProvisionError("That service belongs to DGA and stays in place.")
    delete_dns(dns_record_ids)
    if domain_id:
        try:
            railway_call(
                "mutation($id: String!) { customDomainDelete(id: $id) }",
                {"id": domain_id},
            )
        except OfficeProvisionError:
            pass
    for service_id in (web_service_id, db_service_id):
        if not service_id:
            continue
        railway_call(
            """
            mutation($id: String!, $environmentId: String) {
              serviceDelete(id: $id, environmentId: $environmentId)
            }
            """,
            {"id": service_id, "environmentId": ENVIRONMENT_ID},
        )
