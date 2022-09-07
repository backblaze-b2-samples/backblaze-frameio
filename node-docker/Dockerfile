FROM node:alpine

WORKDIR /srv

COPY package*.json ./
RUN npm install

# Remove spurious backblaze-frameio-common module so we can copy it in the next step
RUN rm -r node_modules/backblaze-frameio-common

# copy everything else in
COPY . .

EXPOSE 8888

# command to run our app
CMD ["node", "server.js"]
