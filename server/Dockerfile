FROM node:20-alpine
WORKDIR /app
COPY server/package.json server/package-lock.json* ./
RUN npm install
COPY server/ .
COPY fleet.json /fleet.json
EXPOSE 4000
CMD ["npm", "start"]
