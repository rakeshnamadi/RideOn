#!/usr/bin/env sh
# Starts the project-local MySQL 8.4 (portable build in .tools/) on 127.0.0.1:3307.
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
exec "$ROOT/.tools/mysql/bin/mysqld.exe" --defaults-file="$ROOT/.tools/my.ini" --console
