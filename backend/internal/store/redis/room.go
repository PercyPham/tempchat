package redis

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strconv"
	"time"

	nanoid "github.com/matoous/go-nanoid/v2"
	"github.com/percypham/tempchat/internal/appctx"
	"github.com/percypham/tempchat/internal/store"
	"github.com/redis/go-redis/v9"
)

const (
	freeTTL             = 3 * time.Hour
	freeMaxParticipants = 5
	freeMaxEvents       = 50
)

// ErrRoomFull is returned when a join is rejected due to capacity.
var ErrRoomFull = errors.New("room_full")

// ErrRoomNotFound is returned when the room does not exist.
var ErrRoomNotFound = errors.New("room_not_found")

// Store is the Redis-backed implementation of store.Store.
type Store struct {
	rdb *redis.Client
}

// New creates a new Redis Store.
func New(rdb *redis.Client) *Store {
	return &Store{rdb: rdb}
}

// keyMeta returns the meta hash key for a room.
func keyMeta(roomID string) string { return fmt.Sprintf("room:%s:meta", roomID) }

// keyUsers returns the users hash key for a room.
func keyUsers(roomID string) string { return fmt.Sprintf("room:%s:users", roomID) }

// keyUserMeta returns the per-user meta hash key.
func keyUserMeta(roomID, userID string) string {
	return fmt.Sprintf("room:%s:user:%s:meta", roomID, userID)
}

// keyEvents returns the events sorted set key.
func keyEvents(roomID string) string { return fmt.Sprintf("room:%s:events", roomID) }

// keyEventSeq returns the monotonic counter key.
func keyEventSeq(roomID string) string { return fmt.Sprintf("room:%s:event_seq", roomID) }

// keyKeys returns the cleanup registry set key.
func keyKeys(roomID string) string { return fmt.Sprintf("room:%s:keys", roomID) }

// keyPubSub returns the Redis Pub/Sub channel name for a room.
func keyPubSub(roomID string) string { return fmt.Sprintf("room:%s:pubsub", roomID) }

// CreateRoom creates a new room and registers the creator as the first member.
func (s *Store) CreateRoom(ctx appctx.AppCtx, req store.CreateRoomRequest) (*store.CreateRoomResult, error) {
	roomID, err := nanoid.New(10)
	if err != nil {
		return nil, err
	}
	userID, err := nanoid.New(8)
	if err != nil {
		return nil, err
	}

	now := ctx.Now
	nowMs := now.UnixMilli()
	expiresAt := now.Add(freeTTL)
	expiresAtMs := expiresAt.UnixMilli()

	pipe := s.rdb.Pipeline()

	// meta hash
	pipe.HSet(ctx, keyMeta(roomID),
		"name", req.Name,
		"public_key", req.PublicKey,
		"max_participants", freeMaxParticipants,
		"max_events", freeMaxEvents,
		"created_at", nowMs,
		"expires_at", expiresAtMs,
	)

	// event_seq initialised to 0 (INCR will return 1 for the first event)
	pipe.Set(ctx, keyEventSeq(roomID), 0, 0)

	// keys registry
	pipe.SAdd(ctx, keyKeys(roomID),
		keyMeta(roomID),
		keyUsers(roomID),
		keyEvents(roomID),
		keyEventSeq(roomID),
		keyKeys(roomID),
	)

	// creator in users hash
	pipe.HSet(ctx, keyUsers(roomID), userID, nowMs)

	// creator user meta (join_eid = 0 so they see all events from creation)
	pipe.HSet(ctx, keyUserMeta(roomID, userID),
		"name", req.CreatorName,
		"joined_at", nowMs,
		"join_eid", 0,
	)

	// register creator meta key in cleanup registry
	pipe.SAdd(ctx, keyKeys(roomID), keyUserMeta(roomID, userID))

	if _, err := pipe.Exec(ctx); err != nil {
		return nil, err
	}

	// append joined system event for creator
	joinEid, err := s.appendSystemEvent(ctx, roomID, "joined", userID, expiresAtMs, freeMaxEvents)
	if err != nil {
		return nil, err
	}

	// update creator's join_eid to the actual event eid
	if err := s.rdb.HSet(ctx, keyUserMeta(roomID, userID), "join_eid", joinEid).Err(); err != nil {
		return nil, err
	}

	// set TTL on all room keys
	if err := s.pexpireAllKeys(ctx, roomID, expiresAt); err != nil {
		return nil, err
	}

	return &store.CreateRoomResult{
		RoomID:    roomID,
		CreatedAt: nowMs,
		ExpiresAt: expiresAtMs,
		UserID:    userID,
		JoinEid:   joinEid,
	}, nil
}

// GetRoomPublicKey fetches only the public_key field from room meta.
func (s *Store) GetRoomPublicKey(ctx appctx.AppCtx, roomID string) (string, error) {
	val, err := s.rdb.HGet(ctx, keyMeta(roomID), "public_key").Result()
	if errors.Is(err, redis.Nil) {
		return "", ErrRoomNotFound
	}
	if err != nil {
		return "", err
	}
	return val, nil
}

// GetRoom reads the full room state including member list.
func (s *Store) GetRoom(ctx appctx.AppCtx, roomID string) (*store.Room, error) {
	meta, err := s.rdb.HGetAll(ctx, keyMeta(roomID)).Result()
	if err != nil {
		return nil, err
	}
	if len(meta) == 0 {
		return nil, ErrRoomNotFound
	}

	users, err := s.rdb.HGetAll(ctx, keyUsers(roomID)).Result()
	if err != nil {
		return nil, err
	}

	members := make([]store.Member, 0, len(users))
	for uid := range users {
		fields, err := s.rdb.HMGet(ctx, keyUserMeta(roomID, uid), "name", "joined_at", "left_at").Result()
		if err != nil || fields[0] == nil {
			continue
		}
		var leftAt int64
		if fields[2] != nil && fields[2].(string) != "" {
			leftAt = parseInt64(fields[2].(string))
		}
		members = append(members, store.Member{
			UID:      uid,
			Name:     fields[0].(string),
			JoinedAt: parseInt64(fields[1].(string)),
			LeftAt:   leftAt,
		})
	}

	return &store.Room{
		ID:              roomID,
		Name:            meta["name"],
		CreatedAt:       parseInt64(meta["created_at"]),
		ExpiresAt:       parseInt64(meta["expires_at"]),
		MaxParticipants: int(parseInt64(meta["max_participants"])),
		MaxEvents:       int(parseInt64(meta["max_events"])),
		MemberCount:     len(users),
		Members:         members,
	}, nil
}

// JoinRoom adds a new user to an existing room.
func (s *Store) JoinRoom(ctx appctx.AppCtx, roomID, name string) (*store.JoinResult, error) {
	meta, err := s.rdb.HGetAll(ctx, keyMeta(roomID)).Result()
	if err != nil {
		return nil, err
	}
	if len(meta) == 0 {
		return nil, ErrRoomNotFound
	}

	maxParticipants := int(parseInt64(meta["max_participants"]))
	maxEvents := int(parseInt64(meta["max_events"]))
	expiresAtMs := parseInt64(meta["expires_at"])
	expiresAt := time.UnixMilli(expiresAtMs)

	memberCount, err := s.rdb.HLen(ctx, keyUsers(roomID)).Result()
	if err != nil {
		return nil, err
	}
	if int(memberCount) >= maxParticipants {
		return nil, ErrRoomFull
	}

	userID, err := nanoid.New(8)
	if err != nil {
		return nil, err
	}

	nowMs := ctx.Now.UnixMilli()

	pipe := s.rdb.Pipeline()
	pipe.HSet(ctx, keyUsers(roomID), userID, nowMs)
	pipe.HSet(ctx, keyUserMeta(roomID, userID),
		"name", name,
		"joined_at", nowMs,
		"join_eid", 0, // placeholder; updated below
	)
	pipe.SAdd(ctx, keyKeys(roomID), keyUserMeta(roomID, userID))
	pipe.PExpireAt(ctx, keyUserMeta(roomID, userID), expiresAt)
	if _, err := pipe.Exec(ctx); err != nil {
		return nil, err
	}

	joinEid, err := s.appendSystemEvent(ctx, roomID, "joined", userID, expiresAtMs, maxEvents)
	if err != nil {
		return nil, err
	}

	if err := s.rdb.HSet(ctx, keyUserMeta(roomID, userID), "join_eid", joinEid).Err(); err != nil {
		return nil, err
	}

	room, err := s.GetRoom(ctx, roomID)
	if err != nil {
		return nil, err
	}

	return &store.JoinResult{
		UserID:  userID,
		JoinEid: joinEid,
		Room:    room,
	}, nil
}

// SetUserLeft records the leave timestamp and appends a left system event.
// Returns the eid assigned to the left event, or 0 if the room has expired.
// If all users have left after this call, the room is deleted immediately.
func (s *Store) SetUserLeft(ctx appctx.AppCtx, roomID, userID string) (int64, error) {
	meta, err := s.rdb.HGetAll(ctx, keyMeta(roomID)).Result()
	if err != nil || len(meta) == 0 {
		return 0, nil // room may have expired; silently ignore
	}
	expiresAtMs := parseInt64(meta["expires_at"])
	maxEvents := int(parseInt64(meta["max_events"]))

	nowMs := ctx.Now.UnixMilli()
	if err := s.rdb.HSet(ctx, keyUserMeta(roomID, userID), "left_at", nowMs).Err(); err != nil {
		return 0, err
	}
	eid, err := s.appendSystemEvent(ctx, roomID, "left", userID, expiresAtMs, maxEvents)
	if err != nil {
		return 0, err
	}

	if empty, _ := s.isRoomEmpty(ctx, roomID); empty {
		_ = s.DeleteRoom(ctx, roomID)
	}
	return eid, nil
}

// isRoomEmpty returns true if every user in the room has a left_at timestamp.
func (s *Store) isRoomEmpty(ctx context.Context, roomID string) (bool, error) {
	userIDs, err := s.rdb.HKeys(ctx, keyUsers(roomID)).Result()
	if err != nil {
		return false, err
	}
	if len(userIDs) == 0 {
		return true, nil
	}
	for _, uid := range userIDs {
		leftAt, err := s.rdb.HGet(ctx, keyUserMeta(roomID, uid), "left_at").Result()
		if errors.Is(err, redis.Nil) || leftAt == "" {
			return false, nil
		}
		if err != nil {
			return false, err
		}
	}
	return true, nil
}

// DeleteRoom immediately deletes all Redis keys associated with a room.
// It is safe to call even if the room is already gone (idempotent).
func (s *Store) DeleteRoom(ctx context.Context, roomID string) error {
	members, err := s.rdb.SMembers(ctx, keyKeys(roomID)).Result()
	if err != nil || len(members) == 0 {
		return err
	}
	pipe := s.rdb.Pipeline()
	for _, k := range members {
		pipe.Del(ctx, k)
	}
	pipe.Del(ctx, keyKeys(roomID))
	_, err = pipe.Exec(ctx)
	return err
}

// GetUserJoinEid returns the join_eid for a user in a room.
func (s *Store) GetUserJoinEid(ctx appctx.AppCtx, roomID, userID string) (int64, error) {
	val, err := s.rdb.HGet(ctx, keyUserMeta(roomID, userID), "join_eid").Result()
	if errors.Is(err, redis.Nil) {
		return 0, ErrRoomNotFound
	}
	if err != nil {
		return 0, err
	}
	return parseInt64(val), nil
}

// appendSystemEvent increments the event sequence, appends a system event JSON
// to the sorted set, trims to maxEvents, and returns the assigned eid.
func (s *Store) appendSystemEvent(ctx appctx.AppCtx, roomID, eventType, userID string, expiresAtMs int64, maxEvents int) (int64, error) {
	eid, err := s.rdb.Incr(ctx, keyEventSeq(roomID)).Result()
	if err != nil {
		return 0, err
	}

	event := map[string]any{
		"eid":  eid,
		"type": eventType,
		"uid":  userID,
		"ts":   ctx.Now.UnixMilli(),
	}
	data, err := json.Marshal(event)
	if err != nil {
		return 0, err
	}

	pipe := s.rdb.Pipeline()
	pipe.ZAdd(ctx, keyEvents(roomID), redis.Z{Score: float64(eid), Member: string(data)})
	pipe.ZRemRangeByRank(ctx, keyEvents(roomID), 0, int64(-maxEvents-1))
	pipe.PExpireAt(ctx, keyEventSeq(roomID), time.UnixMilli(expiresAtMs))
	pipe.PExpireAt(ctx, keyEvents(roomID), time.UnixMilli(expiresAtMs))
	_, err = pipe.Exec(ctx)
	return eid, err
}

// pexpireAllKeys sets absolute expiry on all room keys via PEXPIREAT.
func (s *Store) pexpireAllKeys(ctx appctx.AppCtx, roomID string, expiresAt time.Time) error {
	keys, err := s.rdb.SMembers(ctx, keyKeys(roomID)).Result()
	if err != nil {
		return err
	}
	pipe := s.rdb.Pipeline()
	for _, k := range keys {
		pipe.PExpireAt(ctx, k, expiresAt)
	}
	_, err = pipe.Exec(ctx)
	return err
}

func parseInt64(s string) int64 {
	v, _ := strconv.ParseInt(s, 10, 64)
	return v
}
