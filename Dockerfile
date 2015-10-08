FROM node:latest
MAINTAINER Dominique Quatravaux <dominique.quatravaux@epfl.ch>

RUN mkdir /powerbox
ADD etcd-mirror /powerbox/etcd-mirror
ADD app.js /powerbox/app.js
ADD package.json /powerbox/package.json
RUN cd /powerbox && npm install

