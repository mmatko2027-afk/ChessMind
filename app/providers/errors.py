
class ProviderError(Exception):
    def __init__(self, message: str, retryable: bool = False):
        super().__init__(message)
        self.retryable = retryable


class ProviderTimeoutError(ProviderError):
    pass


class ProviderRateLimitError(ProviderError):
    pass


class ProviderUnavailableError(ProviderError):
    pass


class ProviderInvalidResponseError(ProviderError):
    pass


class ProviderStreamError(ProviderError):
    pass
