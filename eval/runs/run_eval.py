import json
import os
import sys
import time
from datetime import datetime

project_path = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, project_path)

from app.orchestration import ChessOrchestrator
from app.storage import ChessStorage


CASES_FILE = "eval/cases.json"
RUNS_FOLDER = "eval/runs"
REPEATS = 2
EVALUATION_DB = "data/evaluation.db"


def load_cases():
    with open(CASES_FILE, "r", encoding="utf-8") as file:
        return json.load(file)


def main():
    os.makedirs(RUNS_FOLDER, exist_ok=True)
    os.makedirs("data", exist_ok=True)

    cases = load_cases()

    assistant = ChessOrchestrator()

    assistant.gateway.storage = ChessStorage("data/evaluation.db")
    assistant.gateway.storage.initialize()

    assistant.gateway.storage = ChessStorage(EVALUATION_DB)
    assistant.gateway.storage.initialize()

    results = []
    passed_count = 0

    total_input_tokens = 0
    total_output_tokens = 0
    total_tokens = 0
    total_cost = 0.0
    latencies = []

    for case in cases:
        for repeat in range(REPEATS):
            start_time = time.time()

            try:
                response = assistant.explain(
                    question=case["question"],
                    position=case["position"]
                )

                latency = round(time.time() - start_time, 3)
                latencies.append(latency)

                answer = response["answer"]
                answer_lower = answer.lower()

                keywords_ok = all(
                    keyword.lower() in answer_lower
                    for keyword in case["expected_keywords"]
                )

                enough_data_ok = (
                    response["has_enough_data"]
                    == case["expected_enough_data"]
                )

                passed = keywords_ok and enough_data_ok

                if passed:
                    passed_count += 1

                input_tokens = response.get("input_tokens", 0)
                output_tokens = response.get("output_tokens", 0)
                used_tokens = response.get("total_tokens", 0)
                cost = response.get("cost", 0.0)

                total_input_tokens += input_tokens
                total_output_tokens += output_tokens
                total_tokens += used_tokens
                total_cost += cost

                results.append({
                    "case_id": case["id"],
                    "kind": case["kind"],
                    "repeat": repeat + 1,
                    "question": case["question"],
                    "answer": answer,
                    "keywords_ok": keywords_ok,
                    "enough_data_ok": enough_data_ok,
                    "passed": passed,
                    "latency_s": latency,
                    "provider": response.get("provider", "unknown"),
                    "model": response.get("model", "unknown"),
                    "input_tokens": input_tokens,
                    "output_tokens": output_tokens,
                    "total_tokens": used_tokens,
                    "cost": cost
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

    average_latency = (
        round(sum(latencies) / len(latencies), 3)
        if latencies else 0
    )

    report = {
        "created_at": datetime.now().isoformat(),
        "provider": results[0].get("provider", "unknown") if results else "unknown",
        "repeats": REPEATS,
        "total": total,
        "passed": passed_count,
        "failed": total - passed_count,
        "accuracy_percent": accuracy,
        "average_latency_s": average_latency,
        "total_input_tokens": total_input_tokens,
        "total_output_tokens": total_output_tokens,
        "total_tokens": total_tokens,
        "total_cost": round(total_cost, 8),
        "summary_by_kind": summary_by_kind,
        "results": results
    }

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
    print("Середній час:", average_latency, "с")
    print("Вхідні токени:", total_input_tokens)
    print("Вихідні токени:", total_output_tokens)
    print("Усього токенів:", total_tokens)
    print("Вартість:", round(total_cost, 8), "USD")
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
