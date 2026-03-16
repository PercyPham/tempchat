// Package cleanup contains the keyspace notification worker that deletes all
// room-related Redis keys when a room's meta key expires.
package cleanup

import (
	"context"
	"log"
	"strings"

	"github.com/redis/go-redis/v9"
)

// Run subscribes to Redis keyspace expiry notifications and deletes all keys
// associated with a room when its meta key expires. It blocks until ctx is
// cancelled.
func Run(ctx context.Context, rdb *redis.Client) {
	sub := rdb.Subscribe(ctx, "__keyevent@0__:expired")
	defer sub.Close()

	ch := sub.Channel()
	for {
		select {
		case <-ctx.Done():
			return
		case msg, ok := <-ch:
			if !ok {
				return
			}
			handleExpiry(ctx, rdb, msg.Payload)
		}
	}
}

func handleExpiry(ctx context.Context, rdb *redis.Client, key string) {
	if !strings.HasPrefix(key, "room:") || !strings.HasSuffix(key, ":meta") {
		return
	}
	// key format: "room:{roomId}:meta"
	parts := strings.SplitN(key, ":", 3)
	if len(parts) != 3 {
		return
	}
	roomID := parts[1]
	keysKey := "room:" + roomID + ":keys"

	members, err := rdb.SMembers(ctx, keysKey).Result()
	if err != nil || len(members) == 0 {
		return
	}

	pipe := rdb.Pipeline()
	for _, k := range members {
		pipe.Del(ctx, k)
	}
	pipe.Del(ctx, keysKey)
	if _, err := pipe.Exec(ctx); err != nil {
		log.Printf("cleanup: failed to delete room %s keys: %v", roomID, err)
	}
}
