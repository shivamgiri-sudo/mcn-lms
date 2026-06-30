#!/usr/bin/env bash

set -e

if [ -z "$DATABASE_URL" ]; then
  echo "ERROR: DATABASE_URL is not set. Skipping migration."
  exit 0
fi

echo "Running prisma migrate deploy..."

if npx prisma migrate deploy; then
  echo "Migration completed successfully."
else
  echo "Migration failed (this is non-fatal):"
  echo "$?"
  exit 0
fi
