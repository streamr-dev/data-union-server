#!/bin/bash -eux
cd `dirname $0`/../..
source cps
cd scripts

export SLEEP_MS=0

export DATAUNION_ADDRESS=`node deploy.js |grep Deployed | grep -oe '0x\w\+'`
echo "Deployed data union at $DATAUNION_ADDRESS"

node add_secret.js
node join_dataunion.js

#ganache2
export ETHEREUM_PRIVATE_KEY=e5af7834455b7239881b85be89d905d6881dcb4751063897f12be1b0dd546bdb
node join_dataunion.js
BALANCE_BEFORE=$(node get_token_balance.js)

#ganache3
export ETHEREUM_PRIVATE_KEY=4059de411f15511a85ce332e7a428f36492ab4e87c7830099dadbf130f1896ae
node join_dataunion.js

#ganache1 admin
export ETHEREUM_PRIVATE_KEY=5e98cce00cff5dea6b454889f359a4ec06b9fa6b88e9d69b86de8e1c81887da0
export DATA_TOKEN_AMOUNT=1
node send_tokens.js

sleep 10

#should have 3 users
node exit_everyone.js
node exit_everyone.js

#ganache2
export ETHEREUM_PRIVATE_KEY=e5af7834455b7239881b85be89d905d6881dcb4751063897f12be1b0dd546bdb
node join_dataunion.js
BALANCE_AFTER=$(node get_token_balance.js)

DIFF=$(echo $BALANCE_AFTER - $BALANCE_BEFORE |bc)
EXPECTED="233333333333333333"
if [ $DIFF -eq $EXPECTED ]
then
    echo OK
else
    echo Expected: $EXPECTED
    echo Got: $DIFF
    exit 1
fi
