FROM node:alpine

# Copy in package files and .npmrc, then run npm
WORKDIR /srv
COPY node-risingcloud/webservice/package*.json node-risingcloud/webservice/.npmrc node-risingcloud/webservice/
COPY backblaze-frameio-common ./backblaze-frameio-common

WORKDIR /srv/node-risingcloud/webservice
RUN npm install

COPY node-risingcloud/webservice .

EXPOSE 8888

# command to run our app
CMD ["node", "server.js"]
