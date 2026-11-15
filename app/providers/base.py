
from abc import ABC, abstractmethod

from app.models import ProviderRequest, ProviderResult


class AIProvider(ABC):

    @abstractmethod
    def explain(self, request: ProviderRequest) -> ProviderResult:
        pass
