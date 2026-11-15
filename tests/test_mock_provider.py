from app.models import ProviderRequest
from app.providers.mock import MockAIProvider


def test_mock_provider_insufficient_information():

    provider = MockAIProvider()

    request = ProviderRequest(
        request_id="test-001",
        position="",
        question="Так"
    )

    result = provider.explain(request)

    assert result.output.has_enough_data is False

    assert result.output.missing_information == [
        "Уточнене запитання"
    ]

    assert result.output.answer == (
        "Мені недостатньо інформації для відповіді."
    )