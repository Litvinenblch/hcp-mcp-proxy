FROM node:18-alpine

WORKDIR /app

COPY package.json ./
RUN npm install --production --no-audit --no-fund

COPY server.js ./

ENV NODE_ENV=production
ENV PORT=8000
EXPOSE 8000

CMD ["node", "server.js"]
