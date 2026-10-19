FROM node:26.12.0-bookworm-slim@sha256:298992629d69bbd5b2b03ad57094d8e4fcb3a8eeb7c4e25d29de656519568913
WORKDIR /app
COPY server.mjs .
USER 1000:1000
EXPOSE 8090
CMD ["node", "server.mjs"]
