
import os
import sqlite3

from datetime import date

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

            cursor.execute("""
                CREATE TABLE IF NOT EXISTS ai_usage (
                    usage_date TEXT PRIMARY KEY,
                    request_count INTEGER NOT NULL DEFAULT 0,
                    total_cost REAL NOT NULL DEFAULT 0,
                    input_tokens INTEGER NOT NULL DEFAULT 0,
                    output_tokens INTEGER NOT NULL DEFAULT 0
                )
            """)

            cursor.execute("PRAGMA table_info(ai_usage)")
            columns = [row["name"] for row in cursor.fetchall()]

            if "input_tokens" not in columns:
                cursor.execute("""
                    ALTER TABLE ai_usage
                    ADD COLUMN input_tokens INTEGER NOT NULL DEFAULT 0
                """)

            if "output_tokens" not in columns:
                cursor.execute("""
                    ALTER TABLE ai_usage
                    ADD COLUMN output_tokens INTEGER NOT NULL DEFAULT 0
                """)

            connection.commit()

        finally:
            connection.close()

    def record_ai_request(self):
        usage_date = date.today().isoformat()
        connection = self.get_connection()

        try:
            cursor = connection.cursor()

            cursor.execute("""
                INSERT INTO ai_usage (
                    usage_date,
                    request_count,
                    total_cost
                )
                VALUES (?, 1, 0)
                ON CONFLICT(usage_date)
                DO UPDATE SET
                    request_count = request_count + 1
            """, (usage_date,))

            connection.commit()

        finally:
            connection.close()

    def record_ai_usage(
        self,
        cost: float = 0.0,
        input_tokens: int = 0,
        output_tokens: int = 0
    ):
        usage_date = date.today().isoformat()
        connection = self.get_connection()

        try:
            cursor = connection.cursor()

            cursor.execute("""
                INSERT INTO ai_usage (
                    usage_date,
                    request_count,
                    total_cost,
                    input_tokens,
                    output_tokens
                )
                VALUES (?, 0, ?, ?, ?)
                ON CONFLICT(usage_date)
                DO UPDATE SET
                    total_cost = total_cost + ?,
                    input_tokens = input_tokens + ?,
                    output_tokens = output_tokens + ?
            """, (
                usage_date,
                cost,
                input_tokens,
                output_tokens,
                cost,
                input_tokens,
                output_tokens
            ))

            connection.commit()

        finally:
            connection.close()

    def get_ai_usage(self):
        usage_date = date.today().isoformat()
        connection = self.get_connection()

        try:
            cursor = connection.cursor()

            cursor.execute("""
                SELECT
                    request_count,
                    total_cost,
                    input_tokens,
                    output_tokens
                FROM ai_usage
                WHERE usage_date = ?
            """, (usage_date,))

            row = cursor.fetchone()

            if row is None:
                return {
                    "request_count": 0,
                    "total_cost": 0.0,
                    "input_tokens": 0,
                    "output_tokens": 0
                }

            return {
                "request_count": row["request_count"],
                "total_cost": row["total_cost"],
                "input_tokens": row["input_tokens"],
                "output_tokens": row["output_tokens"]
            }

        finally:
            connection.close()

    def check_ai_limits(self):
        from app.providers.errors import ProviderBudgetExceededError

        usage = self.get_ai_usage()

        if usage["request_count"] >= settings.daily_ai_request_limit:
            raise ProviderBudgetExceededError(
                "Перевищено денний ліміт AI-запитів."
            )

        if usage["total_cost"] >= settings.daily_ai_budget:
            raise ProviderBudgetExceededError(
                "Вичерпано денний бюджет AI."
            )

        return True
