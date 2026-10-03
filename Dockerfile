FROM node:24-bookworm-slim

ENV NODE_ENV=production
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY --chown=node:node . .
RUN mkdir -p data uploads \
    && chown -R node:node /app

USER node
EXPOSE 3000
CMD ["npm", "start"]
