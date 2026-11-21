#!/usr/bin/env bash
# Starts every backend agent (run from anywhere): ./start.sh [--reset] [--with-sanitation]
cd "$(dirname "$0")/backend"
python3 run_all.py "$@"
