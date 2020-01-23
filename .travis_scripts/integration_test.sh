#!/bin/bash

set -e

sudo /etc/init.d/mysql stop
git clone https://github.com/streamr-dev/streamr-docker-dev.git
sudo ifconfig docker0 10.200.10.1/24
"$TRAVIS_BUILD_DIR/streamr-docker-dev/streamr-docker-dev/bin.sh" start 5
"$TRAVIS_BUILD_DIR/streamr-docker-dev/streamr-docker-dev/bin.sh" start ganache

# Wait for EE to come up
while true; do
	http_code=$(curl -s -o /dev/null -w "%{http_code}" http://localhost/api/v1/users/me)
	if [ "$http_code" -eq 401 ]; then
		echo "EE up and running"
		break
	else
		echo "EE not receiving connections"
		sleep 5s
	fi
done

docker ps
node ./scripts/create_user.js
./node_modules/.bin/mocha --exit test/integration
