FROM nginxinc/nginx-unprivileged:1.31.7-alpine@sha256:378d0c32f6562f7fd9629170797f57d2b953aa09be983b3daaf4809bb039ca00

LABEL org.opencontainers.image.title="NoFM Audio Gateway" \
      org.opencontainers.image.description="Visitor-only HTTP and WebSocket gateway for NoFM Audio" \
      org.opencontainers.image.licenses="AGPL-3.0-or-later" \
      org.opencontainers.image.source="https://github.com/nofm-audio/nofm-audio-gateway"

ENV NGINX_ENVSUBST_FILTER="^NOFM_UPSTREAM$" \
    NGINX_ENVSUBST_OUTPUT_DIR="/tmp/nginx/conf.d"

COPY LICENSE /usr/share/licenses/nofm-audio-gateway/LICENSE
COPY config/nginx.conf /etc/nginx/nginx.conf
COPY config/default.conf.template /etc/nginx/templates/default.conf.template
COPY --chmod=755 docker-entrypoint.d/19-validate-upstream.sh /docker-entrypoint.d/19-validate-upstream.sh

USER 101:101
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
    CMD ["wget", "-q", "-O", "/dev/null", "http://127.0.0.1:8080/healthz"]
