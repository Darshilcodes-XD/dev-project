from pathlib import Path
import pytest
from backend.app import create_app


@pytest.fixture()
def app(tmp_path: Path):
    test_app = create_app({
        "TESTING": True,
        "DATABASE_PATH": str(tmp_path / "test.db"),
        "SECRET_KEY": "test-key",
    })
    yield test_app


@pytest.fixture()
def client(app):
    return app.test_client()
