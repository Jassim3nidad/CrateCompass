# Database security tests

Run the pgTAP suite against a local Supabase stack with `npm run db:test` or,
when intentionally validating the linked development project, with
`npm run db:test:linked`. Every test runs inside a transaction and rolls back.

The linked command must only target an isolated development project. Never run
these fixtures against production data.
