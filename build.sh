#!/bin/bash

set -e -x

BASEDIR="$(cd "$(dirname "$0")"; pwd)"

build() {
    docker build -t epflsti/cluster.coreos.powerbox "$BASEDIR"
}

eval "$@"
