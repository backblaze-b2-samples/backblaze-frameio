FROM node:alpine

WORKDIR /srv

COPY package*.json ./
RUN npm install

# copy everything else in
COPY . .

# jenny
EXPOSE 8675

# command to run our app
CMD ["node", "index.js"]
