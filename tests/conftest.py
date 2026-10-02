"""Credit benchmarks stay offline unless a test passes its own curve."""

import pytest

from credit.market import install_benchmarks, missing_benchmarks


@pytest.fixture(autouse=True)
def _credit_benchmarks_stay_offline():
    install_benchmarks(missing_benchmarks("Treasury curve is not loaded."))
    yield
    install_benchmarks(None)
