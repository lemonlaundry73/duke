FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production PORT=3000
# No npm install needed — Duke Forge runs on Node built-ins only.
COPY . .
RUN mkdir -p data uploads && chown -R node:node /app
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s CMD wget -qO- http://127.0.0.1:${PORT}/api/health || exit 1
CMD ["node","server.js"]
