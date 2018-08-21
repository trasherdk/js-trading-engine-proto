FROM node:10-alpine

WORKDIR /code

COPY . /code
RUN yarn

EXPOSE 3000
CMD [ "yarn", "start" ]
