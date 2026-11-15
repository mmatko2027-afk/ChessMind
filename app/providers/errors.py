
class ProviderError(Exception):

    def __init__(
        self,
        message: str,
        retryable: bool = False,
        kind: str = "provider_error"
    ):
        super().__init__(message)
        self.retryable = retryable
        self.kind = kind


class ProviderTimeoutError(ProviderError):

    def __init__(self, message: str, retryable: bool = True):
        super().__init__(message, retryable, "timeout")


class ProviderRateLimitError(ProviderError):

    def __init__(self, message: str, retryable: bool = True):
        super().__init__(message, retryable, "rate_limit")


class ProviderUnavailableError(ProviderError):

    def __init__(self, message: str, retryable: bool = True):
        super().__init__(message, retryable, "unavailable")


class ProviderAuthenticationError(ProviderError):

    def __init__(self, message: str):
        super().__init__(message, False, "auth")


class ProviderBadRequestError(ProviderError):

    def __init__(self, message: str):
        super().__init__(message, False, "bad_request")


class ProviderInvalidResponseError(ProviderError):

    def __init__(self, message: str):
        super().__init__(message, False, "invalid_output")


class ProviderStreamError(ProviderError):

    def __init__(self, message: str, retryable: bool = False):
        super().__init__(message, retryable, "stream_error")

class ProviderBudgetExceededError(ProviderError):
    def __init__(self, message: str):
        super().__init__(message, False, "budget_exceeded")