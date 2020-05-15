#!/bin/bash

set -e

sudo /etc/init.d/mysql stop
git clone https://github.com/streamr-dev/streamr-docker-dev.git
sudo ifconfig docker0 10.200.10.1/24
"$TRAVIS_BUILD_DIR/streamr-docker-dev/streamr-docker-dev/bin.sh" start --except data-union-server --wait

docker ps

node ./scripts/create_user.js
./node_modules/.bin/mocha --exit test/integration
