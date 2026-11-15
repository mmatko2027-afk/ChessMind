
import os
import sqlite3

from app.settings import settings


class ChessStorage:

    def __init__(self, db_path: str | None = None):
        self.db_path = db_path or settings.db_path

    def get_connection(self):
        directory = os.path.dirname(self.db_path)

        if directory:
            os.makedirs(directory, exist_ok=True)

        connection = sqlite3.connect(self.db_path)
        connection.row_factory = sqlite3.Row

        return connection

    def initialize(self):
        connection = self.get_connection()

        try:
            cursor = connection.cursor()

            cursor.execute("""
                CREATE TABLE IF NOT EXISTS games (
                    id TEXT PRIMARY KEY,
                    level TEXT NOT NULL,
                    opponent TEXT NOT NULL,
                    status TEXT NOT NULL,
                    current_turn TEXT NOT NULL,
                    fen TEXT NOT NULL
                )
            """)

            cursor.execute("""
                CREATE TABLE IF NOT EXISTS user_settings (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    assistant_position TEXT NOT NULL,
                    assistant_appearance TEXT NOT NULL,
                    voice_enabled BOOLEAN NOT NULL
                )
            """)

            cursor.execute("""
                CREATE TABLE IF NOT EXISTS analysis_jobs (
                    id TEXT PRIMARY KEY,
                    game_id TEXT NOT NULL,
                    status TEXT NOT NULL,
                    result TEXT,
                    FOREIGN KEY (game_id) REFERENCES games(id)
                )
            """)

            connection.commit()

        finally:
            connection.close()
