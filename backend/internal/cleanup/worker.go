// Package cleanup contains the keyspace notification worker that deletes all
// room-related Redis keys when a room's meta key expires.
package cleanup

import (
	"context"
	"log"
	"strings"

	"github.com/percypham/tempchat/internal/store"
	"github.com/redis/go-redis/v9"
)

// Run subscribes to Redis keyspace expiry notifications and deletes all keys
// associated with a room when its meta key expires. It blocks until ctx is
// cancelled.
func Run(ctx context.Context, rdb *redis.Client, s store.Store) {
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
			handleExpiry(ctx, s, msg.Payload)
		}
	}
}

func handleExpiry(ctx context.Context, s store.Store, key string) {
	if !strings.HasPrefix(key, "room:") || !strings.HasSuffix(key, ":meta") {
		return
	}
	// key format: "room:{roomId}:meta"
	parts := strings.SplitN(key, ":", 3)
	if len(parts) != 3 {
		return
	}
	roomID := parts[1]
	if err := s.DeleteRoom(ctx, roomID); err != nil {
		log.Printf("cleanup: failed to delete room %s keys: %v", roomID, err)
	}
}
