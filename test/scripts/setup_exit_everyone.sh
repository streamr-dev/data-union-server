#!/bin/bash -eux
cd `dirname $0`/../..
source cps
cd scripts
export COMMUNITY_ADDRESS=`node deploy_community.js |grep Deployed | grep -oe '0x\w\+'`
echo "deployed community $COMMUNITY_ADDRESS"

node add_secret.js
node join_community.js

#ganache2
export ETHEREUM_PRIVATE_KEY=e5af7834455b7239881b85be89d905d6881dcb4751063897f12be1b0dd546bdb
node join_community.js

#ganache3
export ETHEREUM_PRIVATE_KEY=4059de411f15511a85ce332e7a428f36492ab4e87c7830099dadbf130f1896ae
node join_community.js

#ganache1 admin
export ETHEREUM_PRIVATE_KEY=5e98cce00cff5dea6b454889f359a4ec06b9fa6b88e9d69b86de8e1c81887da0
node send_tokens.js

#should have 3 users
node exit_everyone.js
node exit_everyone.js
