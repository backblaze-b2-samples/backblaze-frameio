# pull the Node.js Docker image
FROM node:alpine

# create the directory inside the container
WORKDIR /srv

# copy the package.json files from local machine to the workdir in container
COPY package*.json ./

# run npm install in our local machine
RUN npm install

# copy the generated modules and all other files to the container
COPY . .

EXPOSE 8675

# the command that starts our app
CMD ["node", "index.js"]
