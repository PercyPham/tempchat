package hub

import (
	"context"
	"fmt"
	"testing"
	"time"

	"github.com/redis/go-redis/v9"
)

// newTestRedis returns a Redis client pointed at the local dev instance.
// The test is skipped if Redis is not reachable.
func newTestRedis(t *testing.T) *redis.Client {
	t.Helper()
	rdb := redis.NewClient(&redis.Options{Addr: "127.0.0.1:6379"})
	if err := rdb.Ping(context.Background()).Err(); err != nil {
		t.Skipf("Redis not available at 127.0.0.1:6379 — skipping: %v", err)
	}
	t.Cleanup(func() { rdb.Close() })
	return rdb
}

// newTestConn creates a Conn with only the send channel populated (no WebSocket, no writePump).
// This lets hub tests read directly from the channel without a real network connection.
func newTestConn() (*Conn, <-chan []byte) {
	ch := make(chan []byte, 64)
	return &Conn{send: ch}, ch
}

// uniqueRoom returns a room ID unique to each call so tests don't cross-pollute.
func uniqueRoom(label string) string {
	return fmt.Sprintf("hub-test-%s-%d", label, time.Now().UnixNano())
}

// recv waits up to d for a message on ch; returns (msg, true) or ("", false) on timeout.
func recv(ch <-chan []byte, d time.Duration) ([]byte, bool) {
	select {
	case msg := <-ch:
		return msg, true
	case <-time.After(d):
		return nil, false
	}
}

// waitForSub sleeps briefly to allow the Redis SUBSCRIBE command to complete.
// A local Redis round-trip is <1 ms; 100 ms is a safe margin.
func waitForSub() { time.Sleep(100 * time.Millisecond) }

// TestHub_SingleInstance_LocalFanout verifies the basic case: publish and receive
// within a single Hub instance.
func TestHub_SingleInstance_LocalFanout(t *testing.T) {
	rdb := newTestRedis(t)
	h := New(rdb)
	roomID := uniqueRoom("single")

	conn, ch := newTestConn()
	h.Subscribe(roomID, conn)
	defer h.Unsubscribe(roomID, conn)
	waitForSub()

	if err := h.Publish(context.Background(), roomID, map[string]string{"hello": "world"}); err != nil {
		t.Fatalf("Publish: %v", err)
	}

	msg, ok := recv(ch, time.Second)
	if !ok {
		t.Fatal("timed out waiting for message on local conn")
	}
	if len(msg) == 0 {
		t.Fatal("received empty message")
	}
}

// TestHub_TwoInstances_CrossFanout is the core multi-instance test.
// Hub A subscribes a conn; Hub B publishes. The message must arrive on Hub A's conn
// via Redis pub/sub — the same path used when two server processes share one Redis.
func TestHub_TwoInstances_CrossFanout(t *testing.T) {
	rdb := newTestRedis(t)
	roomID := uniqueRoom("cross")

	hubA := New(rdb)
	hubB := New(rdb)

	connA, chA := newTestConn()
	hubA.Subscribe(roomID, connA)
	defer hubA.Unsubscribe(roomID, connA)
	waitForSub()

	if err := hubB.Publish(context.Background(), roomID, map[string]string{"from": "hubB"}); err != nil {
		t.Fatalf("Publish: %v", err)
	}

	_, ok := recv(chA, time.Second)
	if !ok {
		t.Fatal("cross-instance fanout failed: Hub A did not receive Hub B's publish within 1s")
	}
}

// TestHub_TwoInstances_BothReceive verifies that a publish fans out to all subscribers
// across both hub instances simultaneously.
func TestHub_TwoInstances_BothReceive(t *testing.T) {
	rdb := newTestRedis(t)
	roomID := uniqueRoom("both")

	hubA := New(rdb)
	hubB := New(rdb)

	connA, chA := newTestConn()
	connB, chB := newTestConn()
	hubA.Subscribe(roomID, connA)
	hubB.Subscribe(roomID, connB)
	defer hubA.Unsubscribe(roomID, connA)
	defer hubB.Unsubscribe(roomID, connB)
	waitForSub()

	if err := hubA.Publish(context.Background(), roomID, map[string]string{"msg": "broadcast"}); err != nil {
		t.Fatalf("Publish: %v", err)
	}

	_, okA := recv(chA, time.Second)
	_, okB := recv(chB, time.Second)

	if !okA {
		t.Error("Hub A's own conn did not receive the message")
	}
	if !okB {
		t.Error("Hub B's conn did not receive Hub A's publish (cross-instance fanout failed)")
	}
}

// TestHub_MultipleLocalConns verifies that a single Hub fans a message out to all
// local connections registered for the same room.
func TestHub_MultipleLocalConns(t *testing.T) {
	rdb := newTestRedis(t)
	h := New(rdb)
	roomID := uniqueRoom("multi")

	conn1, ch1 := newTestConn()
	conn2, ch2 := newTestConn()
	h.Subscribe(roomID, conn1)
	h.Subscribe(roomID, conn2)
	defer h.Unsubscribe(roomID, conn1)
	defer h.Unsubscribe(roomID, conn2)
	waitForSub()

	if err := h.Publish(context.Background(), roomID, map[string]string{"msg": "all"}); err != nil {
		t.Fatalf("Publish: %v", err)
	}

	_, ok1 := recv(ch1, time.Second)
	_, ok2 := recv(ch2, time.Second)
	if !ok1 {
		t.Error("conn1 did not receive the message")
	}
	if !ok2 {
		t.Error("conn2 did not receive the message")
	}
}

// TestHub_Unsubscribe_NoMessageAfterTeardown confirms that after the last conn
// unsubscribes, subsequent publishes are not delivered.
func TestHub_Unsubscribe_NoMessageAfterTeardown(t *testing.T) {
	rdb := newTestRedis(t)
	h := New(rdb)
	roomID := uniqueRoom("unsub")

	conn, ch := newTestConn()
	h.Subscribe(roomID, conn)
	waitForSub()

	h.Unsubscribe(roomID, conn)

	_ = h.Publish(context.Background(), roomID, map[string]string{"msg": "after-unsub"})

	_, ok := recv(ch, 200*time.Millisecond)
	if ok {
		t.Fatal("received message after Unsubscribe — conn should have been removed")
	}
}
