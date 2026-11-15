
import logging
import os

from app.settings import settings


class RequestIdFilter(logging.Filter):

    def filter(self, record):

        if not hasattr(record, "request_id"):
            record.request_id = "-"

        return True


def setup_logging():

    log_directory = os.path.dirname(settings.log_file)

    if log_directory:
        os.makedirs(log_directory, exist_ok=True)

    file_handler = logging.FileHandler(
        settings.log_file,
        encoding="utf-8"
    )

    console_handler = logging.StreamHandler()

    formatter = logging.Formatter(
        "%(asctime)s | %(levelname)s | "
        "request_id=%(request_id)s | %(message)s"
    )

    file_handler.setFormatter(formatter)
    console_handler.setFormatter(formatter)

    file_handler.addFilter(RequestIdFilter())
    console_handler.addFilter(RequestIdFilter())

    logger = logging.getLogger()

    logger.setLevel(logging.INFO)

    logger.handlers.clear()

    logger.addHandler(file_handler)
    logger.addHandler(console_handler)
