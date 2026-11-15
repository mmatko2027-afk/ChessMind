
import json
import os
import sys
import time
from datetime import datetime

# Додаємо кореневу папку проєкту до шляху Python
project_path = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, project_path)

from app.orchestration import ChessOrchestrator


# Налаштування оцінювання
CASES_FILE = "eval/cases.json"
RUNS_FOLDER = "eval/runs"
REPEATS = 2


def load_cases():
    with open(CASES_FILE, "r", encoding="utf-8") as file:
        return json.load(file)


def main():
    os.makedirs(RUNS_FOLDER, exist_ok=True)

    cases = load_cases()
    assistant = ChessOrchestrator()

    results = []
    passed_count = 0

    # Виконуємо кожен тест двічі
    for case in cases:
        for repeat in range(REPEATS):
            start_time = time.time()

            try:
                response = assistant.explain(
                    question=case["question"],
                    position=case["position"]
                )

                latency = round(time.time() - start_time, 3)

                answer = response["answer"]
                answer_lower = answer.lower()

                # Перевіряємо ключові слова
                keywords_ok = all(
                    keyword.lower() in answer_lower
                    for keyword in case["expected_keywords"]
                )

                # Перевіряємо достатність інформації
                enough_data_ok = (
                    response["has_enough_data"]
                    == case["expected_enough_data"]
                )

                passed = keywords_ok and enough_data_ok

                if passed:
                    passed_count += 1

                results.append({
                    "case_id": case["id"],
                    "kind": case["kind"],
                    "repeat": repeat + 1,
                    "question": case["question"],
                    "answer": answer,
                    "keywords_ok": keywords_ok,
                    "enough_data_ok": enough_data_ok,
                    "passed": passed,
                    "latency_s": latency
                })

                print(
                    case["id"],
                    "повтор:",
                    repeat + 1,
                    "результат:",
                    "УСПІХ" if passed else "ПОМИЛКА"
                )

            except Exception as error:
                results.append({
                    "case_id": case["id"],
                    "kind": case["kind"],
                    "repeat": repeat + 1,
                    "passed": False,
                    "error": str(error)
                })

                print("Помилка:", case["id"], str(error))

    # Формуємо статистику за категоріями
    summary_by_kind = {}

    for result in results:
        kind = result["kind"]

        if kind not in summary_by_kind:
            summary_by_kind[kind] = {
                "total": 0,
                "passed": 0
            }

        summary_by_kind[kind]["total"] += 1

        if result["passed"]:
            summary_by_kind[kind]["passed"] += 1

    total = len(results)
    accuracy = round(passed_count / total * 100, 2) if total else 0

    report = {
        "created_at": datetime.now().isoformat(),
        "repeats": REPEATS,
        "total": total,
        "passed": passed_count,
        "failed": total - passed_count,
        "accuracy_percent": accuracy,
        "summary_by_kind": summary_by_kind,
        "results": results
    }

    # Зберігаємо результати запуску
    label = datetime.now().strftime("%Y%m%d_%H%M%S")
    report_path = os.path.join(
        RUNS_FOLDER,
        "baseline_" + label + ".json"
    )

    with open(report_path, "w", encoding="utf-8") as file:
        json.dump(
            report,
            file,
            ensure_ascii=False,
            indent=4
        )

    print("\nОцінювання завершено.")
    print("Усього тестів:", total)
    print("Успішно:", passed_count)
    print("Помилок:", total - passed_count)
    print("Точність:", accuracy, "%")
    print("Звіт збережено:", report_path)

    print("\nРезультати за категоріями:")

    for kind, data in summary_by_kind.items():
        print(
            kind,
            "-",
            data["passed"],
            "/",
            data["total"]
        )


if __name__ == "__main__":
    main()
