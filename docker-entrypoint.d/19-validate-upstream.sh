#!/bin/sh
set -eu

# Limit substitution to an authority, rather than arbitrary Nginx directives.
case "${NOFM_UPSTREAM:-}" in
    *[!A-Za-z0-9.:-]*)
        echo 'NOFM_UPSTREAM contains invalid characters' >&2
        exit 1
        ;;
esac
if ! printf '%s\n' "${NOFM_UPSTREAM:-}" | grep -Eq '^[A-Za-z0-9][A-Za-z0-9.-]*:[0-9]{1,5}$'; then
    echo 'NOFM_UPSTREAM must be a hostname or IPv4 address followed by :port' >&2
    exit 1
fi
port=${NOFM_UPSTREAM##*:}
if [ "$port" -lt 1 ] || [ "$port" -gt 65535 ]; then
    echo 'NOFM_UPSTREAM port must be between 1 and 65535' >&2
    exit 1
fi

# The parent entrypoint requires the output directory to exist before envsubst.
mkdir -p /tmp/nginx/conf.d
