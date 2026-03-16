package cleanup

import (
	"context"
	"fmt"
	"testing"
	"time"

	"github.com/redis/go-redis/v9"
)

func newTestRedis(t *testing.T) *redis.Client {
	t.Helper()
	rdb := redis.NewClient(&redis.Options{Addr: "127.0.0.1:6379"})
	if err := rdb.Ping(context.Background()).Err(); err != nil {
		t.Skipf("Redis not available at 127.0.0.1:6379 — skipping: %v", err)
	}
	t.Cleanup(func() { rdb.Close() })
	return rdb
}

func uniqueRoom(label string) string {
	return fmt.Sprintf("cleanup-test-%s-%d", label, time.Now().UnixNano())
}

// TestHandleExpiry_IgnoresNonMetaKeys verifies that keys without the :meta suffix
// are silently ignored and nothing is deleted.
func TestHandleExpiry_IgnoresNonMetaKeys(t *testing.T) {
	rdb := newTestRedis(t)
	ctx := context.Background()

	roomID := uniqueRoom("ignore")
	usersKey := "room:" + roomID + ":users"
	keysKey := "room:" + roomID + ":keys"

	if err := rdb.Set(ctx, usersKey, "data", 0).Err(); err != nil {
		t.Fatalf("Set: %v", err)
	}
	if err := rdb.SAdd(ctx, keysKey, usersKey).Err(); err != nil {
		t.Fatalf("SAdd: %v", err)
	}
	t.Cleanup(func() { rdb.Del(ctx, usersKey, keysKey) })

	// Feed the users key (not :meta) — worker should ignore it
	handleExpiry(ctx, rdb, usersKey)

	n, err := rdb.Exists(ctx, usersKey).Result()
	if err != nil {
		t.Fatalf("Exists: %v", err)
	}
	if n != 1 {
		t.Errorf("usersKey should still exist after non-meta expiry, got Exists=%d", n)
	}
}

// TestHandleExpiry_DeletesRoomKeys verifies that all keys registered in the
// room:keys set are deleted when the room:meta key expires.
func TestHandleExpiry_DeletesRoomKeys(t *testing.T) {
	rdb := newTestRedis(t)
	ctx := context.Background()

	roomID := uniqueRoom("delete")
	key1 := "room:" + roomID + ":users"
	key2 := "room:" + roomID + ":events"
	keysKey := "room:" + roomID + ":keys"

	if err := rdb.Set(ctx, key1, "data1", 0).Err(); err != nil {
		t.Fatalf("Set key1: %v", err)
	}
	if err := rdb.Set(ctx, key2, "data2", 0).Err(); err != nil {
		t.Fatalf("Set key2: %v", err)
	}
	if err := rdb.SAdd(ctx, keysKey, key1, key2).Err(); err != nil {
		t.Fatalf("SAdd: %v", err)
	}

	handleExpiry(ctx, rdb, "room:"+roomID+":meta")

	for _, k := range []string{key1, key2, keysKey} {
		n, err := rdb.Exists(ctx, k).Result()
		if err != nil {
			t.Fatalf("Exists(%s): %v", k, err)
		}
		if n != 0 {
			t.Errorf("expected key %s to be deleted, got Exists=%d", k, n)
		}
	}
}

// TestHandleExpiry_NoopWhenKeysSetMissing verifies that handleExpiry does not
// panic or error when no keys registry exists for the room.
func TestHandleExpiry_NoopWhenKeysSetMissing(t *testing.T) {
	rdb := newTestRedis(t)
	ctx := context.Background()

	roomID := uniqueRoom("noop")
	// No keys set registered — should return cleanly
	handleExpiry(ctx, rdb, "room:"+roomID+":meta")
}
