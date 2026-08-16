#!/bin/sh
# Robust pip install: try several indexes (PyPI is often flaky from some VPS/regions).
set -eu
REQ_FILE="${1:?requirements file required}"

INDEXES="
https://pypi.org/simple
https://mirror.yandex.ru/mirrors/pypi/simple
https://pypi.tuna.tsinghua.edu.cn/simple
"

attempt=0
for idx in $INDEXES; do
  attempt=$((attempt + 1))
  host=$(echo "$idx" | sed -E 's|https?://([^/]+)/.*|\1|')
  echo "pip install attempt ${attempt}: index=${idx}"
  if pip install --no-cache-dir --retries 5 --timeout 120 \
      -i "$idx" \
      --trusted-host "$host" \
      --trusted-host pypi.org \
      --trusted-host files.pythonhosted.org \
      --trusted-host pypi.python.org \
      -r "$REQ_FILE"; then
    echo "pip install ok via ${idx}"
    exit 0
  fi
  echo "pip install failed via ${idx}, trying next mirror..."
  sleep 2
done

echo "ERROR: pip install failed on all mirrors" >&2
exit 1
