#!/bin/bash

# Script siêu đơn giản để generate private key
# Chạy: bash scripts/gen_key.sh

echo "🔐 Generating private key..."
echo

# Method 1: OpenSSL
echo "=== METHOD 1: OpenSSL ==="
openssl rand -hex 32 | sed 's/^/0x/'

# echo
# echo "=== METHOD 2: /dev/urandom ==="
# # Method 2: /dev/urandom
# xxd -l 32 -p /dev/urandom | sed 's/^/0x/'

# echo
# echo "=== METHOD 3: Simple random ==="
# # Method 3: Simple random (ít secure hơn)
# echo "0x$(openssl rand -hex 32)"

echo
echo "✅ Done!"
echo "⚠️  Chỉ dùng cho testing, không dùng cho mainnet!" 