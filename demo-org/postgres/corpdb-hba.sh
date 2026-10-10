#!/bin/bash
# The governed business database accepts remote connections only over TLS.
set -euo pipefail
hba="$PGDATA/pg_hba.conf"
sed -i -E 's/^host(\s+all\s+all\s+all)/hostssl\1/' "$hba"
echo "hostnossl all all 0.0.0.0/0 reject" >> "$hba"
echo "hostnossl all all ::/0 reject" >> "$hba"
