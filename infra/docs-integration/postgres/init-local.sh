#!/bin/sh
set -eu
# Also invoked explicitly by repeat init. Existing credentials are never reset.
psql --username postgres --set ON_ERROR_STOP=1 \
  --set outline_password="$OUTLINE_PASSWORD" --set hydra_password="$HYDRA_PASSWORD" <<'SQL'
SELECT format('CREATE ROLE outline LOGIN PASSWORD %L', :'outline_password')
WHERE NOT EXISTS (SELECT FROM pg_roles WHERE rolname='outline') \gexec
SELECT format('CREATE ROLE hydra LOGIN PASSWORD %L', :'hydra_password')
WHERE NOT EXISTS (SELECT FROM pg_roles WHERE rolname='hydra') \gexec
SELECT 'CREATE DATABASE outline OWNER outline'
WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname='outline') \gexec
SELECT 'CREATE DATABASE hydra OWNER hydra'
WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname='hydra') \gexec
DO $$ BEGIN
  IF EXISTS (SELECT FROM pg_database WHERE datname='exre') OR
     EXISTS (SELECT FROM pg_roles WHERE rolname IN ('outline','hydra') AND
       (NOT rolcanlogin OR rolsuper OR rolcreatedb OR rolcreaterole OR rolreplication OR rolbypassrls)) OR
     EXISTS (SELECT FROM pg_database d JOIN pg_roles r ON r.oid=d.datdba
       WHERE d.datname IN ('outline','hydra') AND d.datname <> r.rolname) THEN
    RAISE EXCEPTION 'LOCAL_DATABASE_OWNERSHIP_CONFLICT';
  END IF;
END $$;
SQL
# The image's first-init server is socket-only. The orchestrator repeats this
# script after TCP readiness, so both stored passwords are then authenticated.
if pg_isready -h 127.0.0.1 -U postgres >/dev/null 2>&1; then
  PGPASSWORD="$OUTLINE_PASSWORD" psql -h 127.0.0.1 -U outline -d outline --set ON_ERROR_STOP=1 -c 'SELECT current_database()' >/dev/null
  PGPASSWORD="$HYDRA_PASSWORD" psql -h 127.0.0.1 -U hydra -d hydra --set ON_ERROR_STOP=1 -c 'SELECT current_database()' >/dev/null
fi
