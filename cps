#!/bin/bash

export DEBUG=Streamr*

source ./test/setup_dev

# good candidates for private keys
export ETHEREUM_PRIVATE_KEY=5E98CCE00CFF5DEA6B454889F359A4EC06B9FA6B88E9D69B86DE8E1C81887DA0 # ganache 1
#export ETHEREUM_PRIVATE_KEY=4059de411f15511a85ce332e7a428f36492ab4e87c7830099dadbf130f1896ae # ganache 3
#export ETHEREUM_PRIVATE_KEY=1000000000000000000000000000000000000000000000000000000000000000 # from...
#export ETHEREUM_PRIVATE_KEY=1000000000000000000000000000000000000000000000000000000000000999 # ...to

node scripts/start_server.js
#node scripts/watch_dataunion.js
#node scripts/exit_everyone.js
#node scripts/deploy.js
#node scripts/add_secret.js
#node scripts/join.js
#node scripts/check_dataunion.js
#node scripts/send_tokens.js
#node scripts/create_user.js
