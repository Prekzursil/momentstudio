from fastapi.testclient import TestClient
from app.main import app

client = TestClient(app)


def test_http_error_shape():
    res = client.get("/api/v1/does-not-exist")
    assert res.status_code == 404
    body = res.json()
    assert set(body.keys()) == {"detail", "code"}
    assert body["detail"] == "Not Found"
