# Credit

Work menu → Credit. The desk is a high-yield book. Issuers are keyed by the 10-digit SEC CIK. Paramount Skydance, CIK `0002041610`, is the loaded capital structure. The other names are a screen: sector, search, and a yield floor. The floor starts at 6%. A priced bond under that floor leaves the book. A 3–4% coupon is not this desk. Coupons and clean prices are typed. They are not a live TRACE print. The call is still code, with a 40% recovery assumption until a structure is loaded.

The page shows the capital structure, three leverage bases, a manual clean price, covenants, a recovery waterfall, three default measures that are not blended, and the invert paths. Code sets the Buy / Watch / Avoid call. A model does not.

Low and unconfirmed facts stay out of the totals. Missing covenants say "not public". Missing prices say "not found". Agency default tables are not loaded.

`GET /api/credit/issuers` and `GET /api/credit/issuers/{cik}` read the fixture from memory. They do not fetch the network. `POST /api/credit/issuers/{cik}/compute` recomputes from a clean price and an EV multiple. Demo accounts cannot POST. The fixture is not written into Postgres.

Deep dive is refused until the model packet is attested. The route will not choose Grok or Claude on its own.

Tests: `tests/test_credit_calc.py`, `tests/test_credit_fixture.py`, `tests/test_credit_store.py`.
