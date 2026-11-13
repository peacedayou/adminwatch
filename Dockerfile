# Node 22.18+ exécute TypeScript directement (suppression des types), pas d'étape de compilation.
FROM node:22-slim
ENV NODE_ENV=production
WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev --no-audit --no-fund && npm cache clean --force
COPY src/ src/
# Utilisateur sans privilèges ; l'état (dernier bloc, alertes envoyées) vit dans /data
RUN mkdir /data && chown node:node /data
USER node
VOLUME ["/data"]
ENTRYPOINT ["node", "src/cli.ts"]
CMD ["run", "--config", "/config/config.json"]
