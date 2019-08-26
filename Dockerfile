FROM node:10.14-alpine

WORKDIR /app
COPY . /app

# Install package.json dependencies (yes, clean up must be part of same RUN command because of layering)
#RUN apk add --update python build-base && npm install && apk del python build-base && rm -rf /var/cache/apk/*
RUN set -xe && \
    apk add --update python build-base && \
    apk add --no-cache bash git openssh && \
    npm install && \
    (./node_modules/.bin/etherlime opt-out || true) && \
    npm run build-contracts && \
    apk del python build-base git && \
    rm -rf /var/cache/apk/* && \
    bash --version && ssh -V && npm -v && node -v

EXPOSE 8085
EXPOSE 8550
ENV WEBSERVER_PORT 8085
ENV GANACHE_PORT 8550

#ENV ETHEREUM_SERVER
#ENV ETHEREUM_NETWORK
#ENV ETHEREUM_PRIVATE_KEY
#ENV TOKEN_ADDRESS
#ENV BLOCK_FREEZE_SECONDS 60
#ENV FINALITY_WAIT_SECONDS 60
#ENV GAS_PRICE_GWEI 4

#ENV STREAMR_API_KEY "tester1-api-key"
ENV STREAMR_WS_URL "ws://localhost:8890/api/v1/ws"
ENV STREAMR_HTTP_URL "http://localhost:8081/streamr-core/api/v1"

ENV DEVELOPER_MODE "x"
#ENV TOKEN_SYMBOL "TEST"
#ENV TOKEN_NAME "TestToken"

CMD node start_server.js
