#!/usr/bin/env bash

# After the container is stopped AWS will attempt to restart it, meaning it will recover without us triggering it

container_id=$(docker ps -aqf "name=ecs-eu-west-1-stg-community-product.*$")
docker stop $container_id