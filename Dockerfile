FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production PORT=3000
# No npm install needed — Duke Forge runs on Node built-ins only.
COPY . .
# Runs as root so the persistent disk mounted at DATA_DIR (/var/data on Render) is always writable.
RUN mkdir -p data uploads
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s CMD wget -qO- http://127.0.0.1:${PORT}/api/health || exit 1
CMD ["node","server.js"]
