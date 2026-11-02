from conftest import INSTALL_A, INSTALL_B, headers, scan_body


def test_health(client):
    r = client.get("/api/v1/health")
    assert r.status_code == 200
    assert r.json()["status"] == "ok"


def test_post_requires_install_id(client):
    r = client.post("/api/v1/scans", json=scan_body())
    assert r.status_code == 401


def test_install_id_must_be_a_uuid(client):
    r = client.post("/api/v1/scans", json=scan_body(), headers={"X-Install-ID": "not-a-uuid"})
    assert r.status_code == 400


def test_install_id_must_be_version_4(client):
    uuid_v1 = "c232ab00-9414-11ec-b3c8-9f6bdeced846"
    r = client.post("/api/v1/scans", json=scan_body(), headers={"X-Install-ID": uuid_v1})
    assert r.status_code == 400


def test_post_then_list(client):
    r = client.post("/api/v1/scans", json=scan_body("news.example.com"), headers=headers())
    assert r.status_code == 201
    assert r.json()["domain"] == "news.example.com"

    r = client.get("/api/v1/scans", headers=headers())
    assert r.status_code == 200
    scans = r.json()["scans"]
    assert len(scans) == 1
    assert scans[0]["domain"] == "news.example.com"
    assert scans[0]["https"] is True
    assert scans[0]["observed_at"].endswith("Z")


def test_list_is_newest_first(client):
    for stamp, domain in [
        ("2026-10-01T08:00:00Z", "first.example.com"),
        ("2026-10-01T10:00:00Z", "third.example.com"),
        ("2026-10-01T09:00:00Z", "second.example.com"),
    ]:
        client.post("/api/v1/scans", json=scan_body(domain, stamp), headers=headers())
    domains = [s["domain"] for s in client.get("/api/v1/scans", headers=headers()).json()["scans"]]
    assert domains == ["third.example.com", "second.example.com", "first.example.com"]


def test_installs_cannot_see_each_others_scans(client):
    client.post("/api/v1/scans", json=scan_body("a.example.com"), headers=headers(INSTALL_A))
    client.post("/api/v1/scans", json=scan_body("b.example.com"), headers=headers(INSTALL_B))
    a = client.get("/api/v1/scans", headers=headers(INSTALL_A)).json()["scans"]
    b = client.get("/api/v1/scans", headers=headers(INSTALL_B)).json()["scans"]
    assert [s["domain"] for s in a] == ["a.example.com"]
    assert [s["domain"] for s in b] == ["b.example.com"]


def test_limit_is_validated(client):
    assert client.get("/api/v1/scans?limit=0", headers=headers()).status_code == 422
    assert client.get("/api/v1/scans?limit=501", headers=headers()).status_code == 422
    assert client.get("/api/v1/scans?limit=5", headers=headers()).status_code == 200


def test_invalid_payload_is_rejected_and_nothing_is_stored(client):
    bad = scan_body()
    bad["site"]["domain"] = "https://example.com/private/path?token=1"
    assert client.post("/api/v1/scans", json=bad, headers=headers()).status_code == 422
    assert client.get("/api/v1/scans", headers=headers()).json()["scans"] == []


def test_extra_url_field_is_rejected(client):
    body = scan_body()
    body["site"]["url"] = "https://example.com/inbox"
    assert client.post("/api/v1/scans", json=body, headers=headers()).status_code == 422


def test_delete_removes_only_my_data(client):
    client.post("/api/v1/scans", json=scan_body("a.example.com"), headers=headers(INSTALL_A))
    client.post("/api/v1/scans", json=scan_body("a2.example.com"), headers=headers(INSTALL_A))
    client.post("/api/v1/scans", json=scan_body("b.example.com"), headers=headers(INSTALL_B))

    r = client.delete("/api/v1/me", headers=headers(INSTALL_A))
    assert r.status_code == 200
    assert r.json() == {"deleted_scans": 2}

    assert client.get("/api/v1/scans", headers=headers(INSTALL_A)).json()["scans"] == []
    assert len(client.get("/api/v1/scans", headers=headers(INSTALL_B)).json()["scans"]) == 1


def test_delete_with_no_data_is_fine(client):
    r = client.delete("/api/v1/me", headers=headers())
    assert r.status_code == 200
    assert r.json() == {"deleted_scans": 0}
