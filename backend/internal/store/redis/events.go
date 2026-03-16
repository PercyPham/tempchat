package redis

import (
	"encoding/json"
	"fmt"
	"time"

	"github.com/percypham/tempchat/internal/appctx"
	"github.com/percypham/tempchat/internal/store"
	"github.com/redis/go-redis/v9"
)

// AppendMessage assigns an eid, stores the encrypted message in the events
// sorted set, trims to maxEvents, and returns the stored event.
func (s *Store) AppendMessage(ctx appctx.AppCtx, roomID, userID, ciphertext string) (*store.Event, error) {
	meta, err := s.rdb.HGetAll(ctx, keyMeta(roomID)).Result()
	if err != nil || len(meta) == 0 {
		return nil, ErrRoomNotFound
	}
	maxEvents := int(parseInt64(meta["max_events"]))
	expiresAtMs := parseInt64(meta["expires_at"])

	eid, err := s.rdb.Incr(ctx, keyEventSeq(roomID)).Result()
	if err != nil {
		return nil, err
	}

	nowMs := ctx.Now.UnixMilli()
	event := map[string]any{
		"eid": eid,
		"uid": userID,
		"msg": ciphertext,
		"ts":  nowMs,
	}
	data, err := json.Marshal(event)
	if err != nil {
		return nil, err
	}

	pipe := s.rdb.Pipeline()
	pipe.ZAdd(ctx, keyEvents(roomID), redis.Z{Score: float64(eid), Member: string(data)})
	pipe.ZRemRangeByRank(ctx, keyEvents(roomID), 0, int64(-maxEvents-1))
	pipe.PExpireAt(ctx, keyEvents(roomID), time.UnixMilli(expiresAtMs))
	pipe.PExpireAt(ctx, keyEventSeq(roomID), time.UnixMilli(expiresAtMs))
	if _, err := pipe.Exec(ctx); err != nil {
		return nil, err
	}

	return &store.Event{
		Eid: eid,
		UID: userID,
		Msg: ciphertext,
		Ts:  nowMs,
	}, nil
}

// GetEvents returns all events with eid > afterEid, in ascending order.
func (s *Store) GetEvents(ctx appctx.AppCtx, roomID string, afterEid int64) ([]store.Event, error) {
	min := fmt.Sprintf("(%d", afterEid) // exclusive lower bound
	results, err := s.rdb.ZRangeByScore(ctx, keyEvents(roomID), &redis.ZRangeBy{
		Min: min,
		Max: "+inf",
	}).Result()
	if err != nil {
		return nil, err
	}

	events := make([]store.Event, 0, len(results))
	for _, raw := range results {
		var m map[string]any
		if err := json.Unmarshal([]byte(raw), &m); err != nil {
			continue
		}
		ev := store.Event{
			Eid:  int64(toFloat64(m["eid"])),
			Type: toString(m["type"]),
			UID:  toString(m["uid"]),
			Msg:  toString(m["msg"]),
			Ts:   int64(toFloat64(m["ts"])),
		}
		events = append(events, ev)
	}
	return events, nil
}

func toFloat64(v any) float64 {
	switch n := v.(type) {
	case float64:
		return n
	case json.Number:
		f, _ := n.Float64()
		return f
	}
	return 0
}

func toString(v any) string {
	if v == nil {
		return ""
	}
	s, _ := v.(string)
	return s
}
