import pytest

from app import create_app
from app.config import Config
from app.ai.gemini import Gemini


@pytest.fixture
def app():
    return create_app(Config(sqlite_path=":memory:", gemini_key="", allow_reset=True))


@pytest.fixture
def client(app):
    return app.test_client()


def H(role, name=None):
    h = {"X-User-Role": role}
    if name:
        h["X-User-Name"] = name
    return h
