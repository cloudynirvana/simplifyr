FROM node:20-slim
RUN npm install -g gmgn-cli
WORKDIR /app
COPY trading/ ./trading/
# secrets come from --env-file at runtime, never baked in
CMD ["node", "trading/bot.mjs"]
