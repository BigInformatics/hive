# Database Migrations

Hive uses [Drizzle ORM](https://orm.drizzle.team/) for schema definition and migration generation. However, due to unmapped columns (like `search_tsv` on `chat_messages`), **`drizzle-kit push` cannot be used safely** — it attempts to drop columns it doesn't know about.

## Migration Strategy

### For columns mapped in Drizzle schema

1. Update the schema in `src/db/schema.ts`
2. Generate a migration: `npm run db:generate`
3. Review the generated SQL in `drizzle/` directory
4. Apply: `npm run db:migrate`

### For columns NOT in Drizzle schema (e.g., generated columns, custom indexes)

Use manual SQL. Connect to the database and run the migration directly:

```bash
psql -h $PGHOST -p $PGPORT -U $PGUSER -d $PGDATABASE_TEAM
```

### New tables

When creating new tables, always grant permissions to the Docker container user:

```sql
CREATE TABLE your_table ( ... );

-- Grant to both the dev user and the Docker runtime user
GRANT ALL ON your_table TO domingo;
GRANT ALL ON your_table TO team_user;
```

> **Why?** The Docker container connects as `team_user`, not the migration user. Without explicit GRANTs, the app gets permission denied errors at runtime.

## Known Unmapped Columns

| Table | Column | Type | Purpose |
|-------|--------|------|---------|
| `chat_messages` | `search_tsv` | `tsvector GENERATED ALWAYS` | Full-text search index |

These columns are managed via manual SQL and must not be removed. If `drizzle-kit push` is run, it will try to `ALTER TABLE ... DROP COLUMN` on these — **do not allow this**.

## Environment Variables

| Variable | Description |
|----------|-------------|
| `PGHOST` | Database host |
| `PGPORT` | Database port (default: 5432) |
| `PGUSER` | Database user |
| `PGPASSWORD` | Database password |
| `PGDATABASE_TEAM` | Database name |

## Migration Checklist

- [ ] Schema change in `src/db/schema.ts` (if Drizzle-mapped)
- [ ] Generated migration reviewed (`npm run db:generate`)
- [ ] Manual SQL for unmapped columns prepared
- [ ] GRANTs included for `team_user`
- [ ] Migration tested locally
- [ ] Applied to production
- [ ] Migration committed to git
