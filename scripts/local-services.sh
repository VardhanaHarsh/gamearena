#!/usr/bin/env bash
# Starts/stops PostgreSQL + Redis WITHOUT Docker, using binaries in ~/.local/ga-runtime
# (embedded-postgres npm binaries + the redis-server binary from the official redis:7 image).
# With Docker installed, prefer: docker compose up -d postgres redis
set -euo pipefail
RT="$HOME/.local/ga-runtime"
PG="$RT/node_modules/@embedded-postgres/linux-x64/native/bin"
case "${1:-start}" in
  start)
    "$PG/pg_ctl" -D "$RT/pgdata" -o "-p 5432 -k /tmp -c listen_addresses=localhost" -l "$RT/pg.log" status >/dev/null 2>&1 \
      || "$PG/pg_ctl" -D "$RT/pgdata" -o "-p 5432 -k /tmp -c listen_addresses=localhost" -l "$RT/pg.log" start
    "$RT/redis-cli" ping >/dev/null 2>&1 || "$RT/redis-server" --port 6379 --bind 127.0.0.1 --save '' --appendonly no --daemonize yes --logfile "$RT/redis.log"
    echo "postgres :5432 and redis :6379 running" ;;
  stop)
    "$PG/pg_ctl" -D "$RT/pgdata" stop || true
    "$RT/redis-cli" shutdown nosave || true ;;
  *) echo "usage: $0 [start|stop]"; exit 1 ;;
esac
