# Local database seeding

`supabase/seed.sql` contains deterministic, fictional development records. It
is applied after every migration by `supabase db reset`.

The seeded Auth row is a relationship placeholder only. It has no password and
cannot sign in. Create login-capable local users through Supabase Studio or the
Auth Admin API so password hashing and identities remain owned by Supabase
Auth.

## Reset and verify

```bash
npx supabase start
npx supabase db reset
npm run db:types
npm run typecheck
```

Never copy production users, messages, documents, credentials, or customer
identifiers into this file. Seed changes must remain insert-only; schema
changes belong in `supabase/migrations`.
