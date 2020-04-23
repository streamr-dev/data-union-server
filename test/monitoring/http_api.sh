#!/bin/bash

source test/setup_prod

POLL_URL=https://streamr.network/api/v1/dataunions/0x3650b99D107d581eF8ff004365A4Ada8DA6bf62F/stats
POLL_INTERVAL_SECONDS=60

echo "Polling $POLL_URL every $POLL_INTERVAL_SECONDS seconds"
echo "Press Ctrl+C to stop polling "

while true
do
    # "If you want only errors add the -S flag curl -s -S 'example.com' > /dev/null" https://unix.stackexchange.com/questions/196549/hide-curl-output
    curl -s -S $POLL_URL > /dev/null
    assert_exit_code_zero

    sleep $POLL_INTERVAL_SECONDS
done
