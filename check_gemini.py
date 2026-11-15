import time
from openai import OpenAI
from app.settings import settings

client = OpenAI(
    api_key=settings.llm_api_key,
    base_url=settings.llm_base_url,
    timeout=settings.llm_timeout_s,
    max_retries=0
)

questions = [
    "Як ходить кінь у шахах?",
    "Як ходить тура у шахах?",
    "Чим відрізняється слон від коня?",
    "Що таке шах у шахах?",
    "Що означає мат у шахах?"
]

total_time = 0
total_input = 0
total_output = 0
success_count = 0

print("Перевірка реального Gemini")
print("Модель:", settings.llm_model)
print("Кількість запитів:", len(questions))

for i in range(len(questions)):
    print("\nЗапит", i + 1, ":", questions[i])

    try:
        start_time = time.time()

        response = client.chat.completions.create(
            model=settings.llm_model,
            messages=[
                {"role": "user", "content": questions[i]}
            ],
            temperature=settings.llm_temperature,
            max_tokens=settings.llm_max_tokens
        )

        latency = time.time() - start_time
        usage = response.usage

        input_tokens = 0
        output_tokens = 0

        if usage is not None:
            input_tokens = usage.prompt_tokens or 0
            output_tokens = usage.completion_tokens or 0

        cost = (
            input_tokens * settings.input_token_price
            + output_tokens * settings.output_token_price
        ) / 1000000

        print("Час:", round(latency, 3), "с")
        print("Вхідні токени:", input_tokens)
        print("Вихідні токени:", output_tokens)
        print("Вартість:", round(cost, 8), "USD")

        total_time += latency
        total_input += input_tokens
        total_output += output_tokens
        success_count += 1

    except Exception as error:
        print("Помилка:", type(error).__name__)
        print("HTTP статус:", getattr(error, "status_code", None))

print("\n===== ПІДСУМКИ =====")
print("Успішних запитів:", success_count, "з", len(questions))
print("Загальний час:", round(total_time, 3), "с")

if success_count > 0:
    print("Середній час:", round(total_time / success_count, 3), "с")

print("Усього вхідних токенів:", total_input)
print("Усього вихідних токенів:", total_output)
print("Усього токенів:", total_input + total_output)

print("\nПеревірку завершено.")
