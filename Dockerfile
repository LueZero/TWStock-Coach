FROM node:24-bookworm-slim@sha256:d6aa754f16b3197301076f047b5def2f02ea1dbbc2ca920407d46d7ec7f87b20
ENV NODE_ENV=production TZ=Asia/Taipei
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --workspaces=false && npm cache clean --force
COPY --chown=node:node api api
COPY --chown=node:node scripts scripts
COPY --chown=node:node tests tests
USER node
EXPOSE 8000
CMD ["node", "api/index.js"]
