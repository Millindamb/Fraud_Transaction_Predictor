FROM node:20-alpine
WORKDIR /app
ENV NODE_ENV=production

# Install dependencies first so this layer is cached until package files change
COPY package*.json ./
RUN npm ci --omit=dev

COPY . .

USER node
EXPOSE 5000
CMD ["node", "server.js"]
