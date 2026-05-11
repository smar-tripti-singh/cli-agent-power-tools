FROM node:20-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --production
COPY src/ src/
RUN mkdir -p data
EXPOSE 8443
CMD ["node", "src/index.js"]
