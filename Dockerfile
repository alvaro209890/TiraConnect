# TiraConnect — imagem de produção (alternativa ao systemd; ver README)
FROM node:22-alpine
ENV NODE_ENV=production
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY . .
RUN mkdir -p /data /uploads && chown -R node:node /data /uploads
USER node
ENV DATA_DIR=/data UPLOAD_DIR=/uploads HOST=0.0.0.0 PORT=3120
EXPOSE 3120
HEALTHCHECK --interval=30s --timeout=5s CMD wget -qO- http://127.0.0.1:3120/api/health || exit 1
CMD ["node", "--disable-warning=ExperimentalWarning", "src/server.js"]
