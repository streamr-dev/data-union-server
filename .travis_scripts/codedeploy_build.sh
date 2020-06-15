#!/bin/bash

set -ev

# Set .appspec in root
mv .codedeploy/appspec.yml appspec.yml
# Copy bash scripts to be deployed in the tar
tar -czf "du.tar" appspec.yml .codedeploy
mkdir s3_upload
mv du.tar s3_upload