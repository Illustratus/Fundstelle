# Fundstelle — runs without runtime dependencies, so the image stays small.
FROM node:22-alpine

# tini reaps the process tree and passes signals on, so `docker compose down`
# stops the tool instead of waiting out the ten-second kill timer. su-exec drops
# root in the entrypoint once the data folder has been handed over.
RUN apk add --no-cache tini su-exec

LABEL org.opencontainers.image.title="Fundstelle" \
      org.opencontainers.image.description="Local-first tool for qualitative content analysis" \
      org.opencontainers.image.licenses="MIT" \
      org.opencontainers.image.source="https://github.com/illustratus/fundstelle"

WORKDIR /app
COPY server.js example-start-system.json ./
COPY lib ./lib
COPY public ./public
COPY docker-entrypoint.sh /usr/local/bin/
RUN chmod +x /usr/local/bin/docker-entrypoint.sh

# All data (transcripts, category system, requirements, codings) lives on a
# mounted volume so that it outlives the container. Where exactly is decided by
# the entrypoint and not here: a path set in the image is indistinguishable from
# one the caller set, which took the choice away from anyone naming the folders
# by their earlier German variable names.
ENV HOST=0.0.0.0 \
    PORT=4173

EXPOSE 4173
VOLUME ["/data"]

# Starting as root is deliberate and brief: the entrypoint hands the data folder
# to `node` and drops to it before the tool itself ever runs. Give the container
# a `user:` of its own to skip that entirely.
ENTRYPOINT ["/sbin/tini", "--", "docker-entrypoint.sh"]
CMD ["node", "server.js"]

# Compose can then wait for the tool to actually answer, not merely to start.
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+process.env.PORT+'/api/interviews').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
