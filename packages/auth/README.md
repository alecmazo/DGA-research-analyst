# `@dga/auth` (placeholder)

Sign-in is an email + password account. The API is `POST /api/auth/v2/login`
in `auth_v2.py`. Sessions are HMAC-signed JSON (`TOKEN_SECRET`) and travel
in the `x-auth-v2-token` header (or `v2_token` query on downloads).

Roles:

- **GP / admin** sees every fund and managed account, including the fund
  admin routes.
- **LP** sees only the funds and managed accounts assigned to that login
  (`/api/v2/lp/*`, plus fund display settings and balance history).

There is no shared desk password and no shared fund password.
`FUND_DELETE_PASSWORD` is a separate confirmation on
`DELETE /api/fund/admin/delete` and still requires a GP session.
