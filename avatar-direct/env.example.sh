#!/usr/bin/env bash
# Copy to env.sh (gitignored) and fill in, OR source the values from
# agent-samples/simple-backend/.env. Never commit real keys/cert.
export AGORA_APP_ID="<EVENTDEMO_APP_ID>"
export AGORA_APP_CERTIFICATE="<EVENTDEMO_APP_CERTIFICATE>"   # secret
export LS_KEY="<LSDUB_AVATAR_API_KEY>"                       # LemonSlice, secret
export ANAM_KEY="<ANAMDUB_AVATAR_API_KEY>"                   # Anam, secret
export SDK_LIB="/home/ubuntu/palabra/server/vendor_sdk/agora_sdk"
export RECV_AV="/home/ubuntu/web/avatar-direct/recv_av"      # build: go build -o recv_av recv_av.go
