#!/bin/sh
set -eu

psql --username postgres --set ON_ERROR_STOP=1 \
  --set exre_password="$EXRE_PASSWORD" \
  --set outline_password="$OUTLINE_PASSWORD" \
  --set hydra_password="$HYDRA_PASSWORD" <<'SQL'
CREATE ROLE exre LOGIN PASSWORD :'exre_password';
CREATE ROLE outline LOGIN PASSWORD :'outline_password';
CREATE ROLE hydra LOGIN PASSWORD :'hydra_password';
CREATE DATABASE exre OWNER exre;
CREATE DATABASE outline OWNER outline;
CREATE DATABASE hydra OWNER hydra;
SQL
