
# ChessMind

ChessMind — це застосунок для навчання шахів з AI-помічником.

## Мета проєкту

Створити програму, яка допомагає користувачам вивчати шахи, отримувати пояснення правил та розбирати шахові позиції.

## Технології

- Python
- FastAPI
- Pydantic
- SQLite
- Mock AI Provider
- Pytest

## Структура проєкту

```text
app/
    main.py
    settings.py
    models.py
    service.py
    orchestration.py
    gateway.py
    storage.py
    telemetry.py
    providers/
        base.py
        mock.py
        errors.py
        openai_compat.py

docs/
    architecture.md
    api.md
    adr/

tests/
    test_api.py
    test_service.py
    test_provider_errors.py

requirements.txt
.env.example
README.md
```

## Встановлення

Для роботи потрібен Python 3.11 або новіший.

1. Завантажте репозиторій:

```bash
git clone https://github.com/mmatko2027-afk/ChessMind.git
```

2. Перейдіть до папки проєкту:

```bash
cd ChessMind
```

3. Створіть віртуальне середовище:

```bash
python -m venv .venv
```

4. Активуйте його у Windows:

```powershell
.venv\Scripts\Activate.ps1
```

5. Встановіть залежності:

```bash
pip install -r requirements.txt
```

6. Створіть файл налаштувань:

```powershell
Copy-Item .env.example .env
```

## Запуск

Запустіть програму командою:

```bash
uvicorn app.main:app --reload
```

Після запуску API буде доступне за адресою:

http://127.0.0.1:8000

Документація API:

http://127.0.0.1:8000/docs

## Основні маршрути

| Метод | Маршрут | Призначення |
|---|---|---|
| GET | /health | Перевірка стану програми |
| POST | /api/coach/explain | Отримання пояснення від шахового помічника |

## AI-провайдер

За замовчуванням використовується Mock AI Provider.

Він повертає тестові відповіді без звернення до платної AI-моделі.

У файлі `.env` можна змінити режим роботи:

```dotenv
LLM_PROVIDER=mock
MOCK_FAILURE_MODE=none
```

## Запуск тестів

Для перевірки роботи програми виконайте:

```bash
pytest -v
```

Тести перевіряють API, сервіс та обробку помилок AI-провайдера.

## Документація

Додаткові матеріали знаходяться в папці `docs/`:

- `architecture.md` — архітектура системи.
- `api.md` — опис API.
- `adr/` — архітектурні рішення.
