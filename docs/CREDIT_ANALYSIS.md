# Credit

Work menu → Credit. Issuers are keyed by the 10-digit SEC CIK. The seed is Paramount Skydance, CIK `0002041610`.

The page shows the capital structure, three leverage bases, a manual clean price, covenants, a recovery waterfall, three default measures that are not blended, and the invert paths. Code sets the Buy / Watch / Avoid call. A model does not.

Low and unconfirmed facts stay out of the totals. Missing covenants say "not public". Missing prices say "not found". Agency default tables are not loaded.

`GET /api/credit/issuers` and `GET /api/credit/issuers/{cik}` read the fixture from memory. They do not fetch the network. `POST /api/credit/issuers/{cik}/compute` recomputes from a clean price and an EV multiple. Demo accounts cannot POST. The fixture is not written into Postgres.

Deep dive is refused until the model packet is attested. The route will not choose Grok or Claude on its own.

Tests: `tests/test_credit_calc.py`, `tests/test_credit_fixture.py`, `tests/test_credit_store.py`.
