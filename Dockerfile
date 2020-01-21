FROM ubuntu:16.04 AS builder
ARG NODE_VERSION="v10.14.0"
RUN apt-get update && apt-get install -y \
	build-essential \
	curl \
	git \
	libudev-dev \
	libusb-1.0-0 \
	python \
	&& rm -rf /var/lib/apt/lists/*
WORKDIR /
RUN curl -s -O "https://nodejs.org/download/release/${NODE_VERSION}/node-${NODE_VERSION}-linux-x64.tar.gz"
RUN tar xzf "node-${NODE_VERSION}-linux-x64.tar.gz"
ENV PATH="/node-${NODE_VERSION}-linux-x64/bin:${PATH}"
RUN node --version
RUN npm --version
RUN useradd -ms /bin/bash node
USER node
WORKDIR /home/node
COPY ./ ./
RUN npm ci
RUN npm run build-contracts

FROM ubuntu:16.04
ARG NODE_VERSION="v10.14.0"
RUN apt-get update && apt-get install -y \
	awscli \
	curl \
	&& rm -rf /var/lib/apt/lists/*

WORKDIR /
ENV PATH="/node-$NODE_VERSION-linux-x64/bin:${PATH}"
COPY --from=builder /node-$NODE_VERSION-linux-x64/ /node-$NODE_VERSION-linux-x64/

RUN useradd -ms /bin/bash node
USER node
WORKDIR /home/node
COPY --from=builder /home/node/ ./

ENV WEBSERVER_PORT=8085
ENV STREAMR_WS_URL="ws://localhost:8890/api/v1/ws"
ENV STREAMR_HTTP_URL="http://localhost/api/v1"
ENV ETHEREUM_SERVER="http://localhost:8545"
ENV OPERATOR_PRIVATE_KEY="0x5e98cce00cff5dea6b454889f359a4ec06b9fa6b88e9d69b86de8e1c81887da0"
ENV TOKEN_ADDRESS="0xbAA81A0179015bE47Ad439566374F2Bae098686F"
ENV STREAMR_NODE_ADDRESS="0xFCAd0B19bB29D4674531d6f115237E16AfCE377c"
ENV DEBUG="*"

EXPOSE 8085

ENTRYPOINT ["bash", "docker-entrypoint.sh"]
CMD node scripts/start_server.js
