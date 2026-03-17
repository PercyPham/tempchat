// Package redis provides the Redis-backed implementation of store.Store.
package redis

import (
	"github.com/redis/go-redis/v9"
)

// NewClient creates a Redis client from the given address.
func NewClient(addr string) *redis.Client {
	return redis.NewClient(&redis.Options{Addr: addr})
}
