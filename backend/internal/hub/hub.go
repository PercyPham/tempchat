// Package hub manages WebSocket connections and fans out events via Redis Pub/Sub,
// enabling multi-instance deployments where clients may be connected to different
// server processes.
package hub

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"sync"

	"github.com/coder/websocket"
	"github.com/redis/go-redis/v9"
)

// Conn wraps a WebSocket connection with a buffered outbound channel.
type Conn struct {
	ws   *websocket.Conn
	send chan []byte
}

// NewConn creates a Conn and starts its write pump. Call Close when done.
func NewConn(ws *websocket.Conn) *Conn {
	c := &Conn{ws: ws, send: make(chan []byte, 64)}
	go c.writePump()
	return c
}

func (c *Conn) writePump() {
	for msg := range c.send {
		if err := c.ws.Write(context.Background(), websocket.MessageText, msg); err != nil {
			return
		}
	}
}

// Close drains and closes the send channel.
func (c *Conn) Close() {
	close(c.send)
}

// roomSub tracks local connections and the Redis subscription for one room.
type roomSub struct {
	conns map[*Conn]struct{}
	sub   *redis.PubSub
}

// Hub manages per-room subscriptions and local connection sets.
type Hub struct {
	rdb   *redis.Client
	mu    sync.RWMutex
	rooms map[string]*roomSub
}

// New creates a Hub backed by the given Redis client.
func New(rdb *redis.Client) *Hub {
	return &Hub{rdb: rdb, rooms: make(map[string]*roomSub)}
}

func channelName(roomID string) string {
	return fmt.Sprintf("room:%s:pubsub", roomID)
}

// Subscribe registers conn in the hub for roomID and starts a Redis
// subscriber goroutine if this is the first local connection for that room.
func (h *Hub) Subscribe(roomID string, conn *Conn) {
	h.mu.Lock()
	defer h.mu.Unlock()

	rs, ok := h.rooms[roomID]
	if !ok {
		sub := h.rdb.Subscribe(context.Background(), channelName(roomID))
		rs = &roomSub{conns: make(map[*Conn]struct{}), sub: sub}
		h.rooms[roomID] = rs
		go h.fanOut(roomID, rs)
	}
	rs.conns[conn] = struct{}{}
}

// Unsubscribe removes conn from the hub. If it was the last local connection
// for the room, the Redis subscription is torn down.
func (h *Hub) Unsubscribe(roomID string, conn *Conn) {
	h.mu.Lock()
	defer h.mu.Unlock()

	rs, ok := h.rooms[roomID]
	if !ok {
		return
	}
	delete(rs.conns, conn)
	if len(rs.conns) == 0 {
		rs.sub.Close()
		delete(h.rooms, roomID)
	}
}

// Publish serialises event to JSON and publishes it to the room's Redis channel.
// All server instances subscribed to that channel will forward it to local clients.
func (h *Hub) Publish(ctx context.Context, roomID string, event any) error {
	data, err := json.Marshal(event)
	if err != nil {
		return err
	}
	return h.rdb.Publish(ctx, channelName(roomID), data).Err()
}

// fanOut reads messages from the Redis subscription and writes them to every
// local Conn registered for the room.
func (h *Hub) fanOut(roomID string, rs *roomSub) {
	ch := rs.sub.Channel()
	for msg := range ch {
		payload := []byte(msg.Payload)
		h.mu.RLock()
		for conn := range rs.conns {
			select {
			case conn.send <- payload:
			default:
				log.Printf("hub: dropped message for slow conn in room %s", roomID)
			}
		}
		h.mu.RUnlock()
	}
}
