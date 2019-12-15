FROM node:10.14-alpine

WORKDIR /app
COPY . /app

# Install package.json dependencies (yes, clean up must be part of same RUN command because of layering)
#RUN apk add --update python build-base && npm install && apk del python build-base && rm -rf /var/cache/apk/*
RUN set -xe && \
    apk add python py-pip build-base && \
    apk add --no-cache bash git openssh && \
    npm install && \
    (./node_modules/.bin/etherlime opt-out || true) && \
    npm run build-contracts && \
    bash --version && ssh -V && npm -v && node -v

RUN pip install --upgrade awscli

EXPOSE 8085
ENV WEBSERVER_PORT 8085

# start own ganache
#EXPOSE 8550
#ENV GANACHE_PORT 8550

# dev docker: use streamr-ganache and local EE
ENV STREAMR_WS_URL "ws://localhost:8890/api/v1/ws"
ENV STREAMR_HTTP_URL "http://localhost/api/v1"
ENV ETHEREUM_SERVER "http://localhost:8545"
ENV OPERATOR_PRIVATE_KEY "0x5e98cce00cff5dea6b454889f359a4ec06b9fa6b88e9d69b86de8e1c81887da0"
ENV TOKEN_ADDRESS "0xbAA81A0179015bE47Ad439566374F2Bae098686F"
ENV STREAMR_NODE_ADDRESS "0xFCAd0B19bB29D4674531d6f115237E16AfCE377c"
ENV DEBUG "*"

# staging: same as above except
#ENV OPERATOR_PRIVATE_KEY from 1password "Community Products (CP) server Ethereum keys - staging" / password

# production: connect to infura (or whatever ethers.js default providers)
#ENV ETHEREUM_NETWORK "homestead"
#ENV TOKEN_ADDRESS "0xc0aa4dC0763550161a6B59fa430361b5a26df28C"
#ENV STREAMR_NODE_ADDRESS "0xf3E5A65851C3779f468c9EcB32E6f25D9D68601a"
#ENV OPERATOR_PRIVATE_KEY from remote secrets

#ENV BLOCK_FREEZE_SECONDS 1
#ENV FINALITY_WAIT_SECONDS 1
#ENV GAS_PRICE_GWEI 4

ENTRYPOINT ["bash", "docker-entrypoint.sh"]
CMD node scripts/start_server.js
