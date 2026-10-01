# Scanner + paper ledger only. No signer, no wallet keys in this image.
FROM node:22-slim
WORKDIR /app
RUN npm install -g tsx@4 && npm cache clean --force
COPY src/lib ./src/lib
COPY src/trading ./src/trading
COPY scripts/pump-scan.ts ./scripts/pump-scan.ts
RUN mkdir -p /app/.trading-state && chown -R node:node /app
USER node
CMD ["tsx", "scripts/pump-scan.ts", "150"]
