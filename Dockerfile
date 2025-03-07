FROM node:alpine

WORKDIR /srv

COPY package*.json ./
RUN npm install

# copy everything else in
COPY . .

EXPOSE 8888

# command to run our app
CMD ["node", "src/server.js"]
