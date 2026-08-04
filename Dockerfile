# Fundstelle — runs without runtime dependencies, so the image stays small.
FROM node:22-alpine

WORKDIR /app
COPY server.js example-start-system.json ./
COPY lib ./lib
COPY public ./public

# All data (transcripts, category system, requirements, codings) lives on a
# mounted volume so that it outlives the container.
ENV HOST=0.0.0.0 \
    PORT=4173 \
    TRANSCRIPTS=/data/transcripts \
    CATEGORIES=/data/categories.json

USER node
EXPOSE 4173
VOLUME ["/data"]

CMD ["node", "server.js"]
