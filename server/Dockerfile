FROM node:20-alpine
WORKDIR /app
RUN echo "precedence ::ffff:0:0/96 100" >> /etc/gai.conf
COPY server/package.json server/package-lock.json* ./
RUN npm install
COPY server .
COPY fleet.json ./
EXPOSE 4000
CMD ["npm", "start"]
