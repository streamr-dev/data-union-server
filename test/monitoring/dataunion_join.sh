#!/bin/bash

source test/setup_prod

POLL_INTERVAL_SECONDS=900  # 15 minutes
if [ -z $DATAUNION_ADDRESS ]; then
    export DEBUG=*
    export DATAUNION_ADDRESS=`node scripts/deploy.js |grep Deployed | grep -oe '0x\w\+'`
    node scripts/add_secret.js
    export DEBUG=
    echo "Deployed contract at $DATAUNION_ADDRESS"
else
    echo "Using existing contract at $DATAUNION_ADDRESS"
fi
echo "Joining a new member every $POLL_INTERVAL_SECONDS seconds. Press Ctrl+C to stop."

starttime=$(date +"%s")

# 899999 minutes = 624 days
# seq -w for uniform width if numbers were not uniform width...
for i in $(seq -w 1000 9999)
do
    export ETHEREUM_PRIVATE_KEY=0x10000000000000000000000000000000000000000000000000$starttime$i
    MEMBER_ADDRESS=`node -p "require('ethers').utils.computeAddress('$ETHEREUM_PRIVATE_KEY')"`

    echo Sending join for $MEMBER_ADDRESS
    node scripts/join_dataunion.js

    sleep 60

    # curl -f gets exit code 22 when HTTP request returns 404
    POLL_URL=https://streamr.network/api/v1/dataunions/$DATAUNION_ADDRESS/members/$MEMBER_ADDRESS
    echo Checking the join from $POLL_URL
    curl -s -S -f $POLL_URL > /dev/null
    assert_exit_code_zero dus-join-monitor

    sleep $POLL_INTERVAL_SECONDS
done
