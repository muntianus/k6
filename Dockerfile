FROM node:22-alpine

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=4041

COPY package.json ./
COPY src ./src

EXPOSE 4041

HEALTHCHECK --interval=15s --timeout=3s --start-period=5s --retries=3 \
  CMD wget -qO- http://127.0.0.1:4041/health || exit 1

USER node

CMD ["node", "src/server.js"]
