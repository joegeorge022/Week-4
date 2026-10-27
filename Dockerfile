FROM node:22-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY server ./server
COPY public ./public
ENV HOST=0.0.0.0 PORT=3000 OFRENDA_DATA_DIR=/data
RUN mkdir -p /data && chown node:node /data
VOLUME /data
EXPOSE 3000
USER node
CMD ["node", "server/index.js"]
