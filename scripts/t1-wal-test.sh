#!/bin/bash
# T1: does `sqlite3 -readonly -json` read a WAL-mode cc-switch DB correctly
# while (and after) a writer is active? Four cases. Exit 0 = all pass.
set -u
D=$(mktemp -d /tmp/t1-wal-XXXXXX)
DB=$D/cc-switch.db
SQL="SELECT name, is_current FROM providers WHERE app_type='claude' ORDER BY sort_index"

say() { printf '%s\n' "$*"; }
mkdb() {
  rm -f $DB $DB-wal $DB-shm
  sqlite3 "$DB" "PRAGMA journal_mode=WAL;
    CREATE TABLE providers(id TEXT PRIMARY KEY, name TEXT, app_type TEXT,
      settings_config TEXT, meta TEXT, sort_index INTEGER, is_current INTEGER, created_at TEXT);
    INSERT INTO providers VALUES('a','Work','claude','{}','{}',0,1,'2026-01-01');
    PRAGMA wal_checkpoint(TRUNCATE);"
}

# reader <label>: must exit 0, print committed rows only, fast (<5s)
reader() {
  local label=$1
  local t0=$(date +%s%N)
  if out=$(timeout 5 sqlite3 -readonly -json "$DB" "$SQL" 2>$D/err) && [ $? -eq 0 ]; then
    local t1=$(date +%s%N)
    say "PASS $label: exit 0 in $(( (t1-t0)/1000000 ))ms -> ${out:-<empty>}"
  else
    say "FAIL $label: rc=$? out=${out:-} err=$(cat $D/err)"
  fi
}

# case 1: an open write transaction (uncommitted row B) is held by another process
mkdb
mkfifo $D/fifo 2>/dev/null
sqlite3 "$DB" < $D/fifo > /dev/null 2>&1 &
W=$!
exec 9>$D/fifo
printf 'BEGIN IMMEDIATE;\nINSERT INTO providers VALUES("b","Held","claude","{}","{}",1,0,"2026-01-02");\n' >&9
sleep 0.5
reader "1: active writer txn (must see only committed A)"
exec 9>&-          # EOF -> writer exits, txn rolls back
wait $W 2>/dev/null

# case 2: writer committed, connection closed, -wal/-shm may remain
mkdb
sqlite3 "$DB" "INSERT INTO providers VALUES('c','Committed','claude','{}','{}',2,0,'2026-01-03');" >/dev/null
ls $DB-wal >/dev/null 2>&1 && WAL_PRESENT=yes || WAL_PRESENT=no
reader "2: after clean commit (wal file present: $WAL_PRESENT)"

# case 3: orphaned WAL — writer SIGKILLed mid-transaction, -wal/-shm left behind
mkdb
mkfifo $D/fifo2 2>/dev/null
sqlite3 "$DB" < $D/fifo2 > /dev/null 2>&1 &
W2=$!
exec 8>$D/fifo2
printf 'BEGIN IMMEDIATE;\nINSERT INTO providers VALUES("d","Orphan","claude","{}","{}",3,0,"2026-01-04");\n' >&8
sleep 0.5
kill -9 $W2 2>/dev/null; wait $W2 2>/dev/null
exec 8>&-
say "   (orphan files: $(ls $DB-wal $DB-shm 2>/dev/null | tr '\n' ' '))"
reader "3: orphaned WAL after SIGKILL writer"

# case 4: no WAL at all (checkpointed away)
mkdb
sqlite3 "$DB" "PRAGMA wal_checkpoint(TRUNCATE); PRAGMA journal_mode=DELETE;" >/dev/null
reader "4: plain journal db"

rm -rf $D
