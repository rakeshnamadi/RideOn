#!/usr/bin/env sh
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
"$ROOT/.tools/mysql/bin/mysqladmin.exe" -h127.0.0.1 -P3307 -urideon -p"$(cat "$ROOT/.tools/db-password.txt")" shutdown
