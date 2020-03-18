#!/bin/bash

# docker env
export ETHEREUM_SERVER=http://localhost:8545
export STREAMR_NODE_ADDRESS=0xFCAd0B19bB29D4674531d6f115237E16AfCE377c
export STREAMR_WS_URL=ws://localhost:8890/api/v1/ws
export STREAMR_HTTP_URL=http://localhost:8081/streamr-core/api/v1
#export COMMUNITY_ADDRESS=  # TODO: find out and add

# start_server.js without env variables
#export ETHEREUM_SERVER=http://localhost:8548
#export STREAMR_NODE_ADDRESS=0xc0aa4dC0763550161a6B59fa430361b5a26df28C
#export COMMUNITY_ADDRESS=0xEAA002f7Dc60178B6103f8617Be45a9D3df659B6
export COMMUNITY_ADDRESS=0x5159FBF2e0Ff63e35b17293416fdf7a0909a0cDA
#export COMMUNITY_ADDRESS=0xfC31c70FafCbFe399195C789602ae2455B247fD2
export WEBSERVER_PORT=8085

# both dev envs
export TOKEN_ADDRESS=0xbAA81A0179015bE47Ad439566374F2Bae098686F
export ETHEREUM_PRIVATE_KEY=5E98CCE00CFF5DEA6B454889F359A4EC06B9FA6B88E9D69B86DE8E1C81887DA0 # ganache 1
#export ETHEREUM_PRIVATE_KEY=4059de411f15511a85ce332e7a428f36492ab4e87c7830099dadbf130f1896ae # ganache 3
#export ETHEREUM_PRIVATE_KEY=beefbeefbeefbeefbeefbeefbeefbeefbeefbeefbeefbeefbeefbeefbeefbeef
#export ETHEREUM_PRIVATE_KEY=0123456789ABCDEF0123456789ABCDEF0123456789ABCDEF0123456789ABCDEF

# start_server
export OPERATOR_PRIVATE_KEY=0x5e98cce00cff5dea6b454889f359a4ec06b9fa6b88e9d69b86de8e1c81887da0 # ganache 0

# deploy_community
export BLOCK_FREEZE_SECONDS=1
export OPERATOR_ADDRESS=0xa3d1F77ACfF0060F7213D7BF3c7fEC78df847De1      # ganache 0
export ADMIN_FEE=0.3
export GAS_PRICE_GWEI=20

# add_secret, join_community
export SECRET=secret

# send_tokens
export DATA_TOKEN_AMOUNT=0.01

#node scripts/watch_community.js
#node scripts/start_server.js
#node scripts/deploy_community.js
#node scripts/exit_everyone.js
#node scripts/add_secret.js
#node scripts/join_community.js
#node scripts/check_community.js
#node scripts/send_tokens.js
#node scripts/create_user.js
