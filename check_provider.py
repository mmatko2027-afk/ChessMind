
from app.models import ProviderRequest
from app.providers.openai_compat import OpenAICompatibleProvider

request = ProviderRequest(
    request_id="manual-check",
    position="Початкова позиція",
    question="Як ходить кінь у шахах?"
)

provider = OpenAICompatibleProvider()
result = provider.explain(request)

print("Провайдер:", result.provider)
print("Модель:", result.model)
print("Відповідь:")
print(result.output.model_dump_json(indent=2))
