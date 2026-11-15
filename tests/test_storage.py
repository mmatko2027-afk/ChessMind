
import sqlite3

from app.storage import ChessStorage


def test_storage_initialization(tmp_path):

    database_path = tmp_path / "test_chessmind.db"

    storage = ChessStorage(str(database_path))

    storage.initialize()

    connection = sqlite3.connect(database_path)

    cursor = connection.cursor()

    cursor.execute(
        "SELECT name FROM sqlite_master WHERE type='table'"
    )

    tables = cursor.fetchall()

    connection.close()

    table_names = []

    for table in tables:
        table_names.append(table[0])

    assert "games" in table_names
    assert "user_settings" in table_names
    assert "analysis_jobs" in table_names
