package redis

import (
	"errors"
	"fmt"
	"strconv"

	"github.com/percypham/tempchat/internal/appctx"
	"github.com/percypham/tempchat/internal/store"
	"github.com/redis/go-redis/v9"
)

// boostScript atomically applies a boost to a room.
//
// KEYS: meta_key, events_key, seq_key, keys_key
// ARGV: ttl_ms, max_participants, max_events, uid_json, boost_id, now_ms
//
// Returns a 5-element array: [status, eid, new_expires_at, new_max_p, new_max_e]
// where status is "ok" on success or "room_not_found" if the room does not exist.
var boostScript = redis.NewScript(`
local meta_key  = KEYS[1]
local events_key = KEYS[2]
local seq_key   = KEYS[3]
local keys_key  = KEYS[4]

local ttl_ms  = tonumber(ARGV[1])
local max_p   = tonumber(ARGV[2])
local max_e   = tonumber(ARGV[3])
local uid_json = ARGV[4]
local boost_id = ARGV[5]
local now_ms  = tonumber(ARGV[6])

if redis.call("EXISTS", meta_key) == 0 then
    return {"room_not_found", 0, 0, 0, 0}
end

local expires_at  = tonumber(redis.call("HGET", meta_key, "expires_at"))
local cur_max_p   = tonumber(redis.call("HGET", meta_key, "max_participants"))
local cur_max_e   = tonumber(redis.call("HGET", meta_key, "max_events"))

local new_expires_at = expires_at + ttl_ms
local new_max_p      = math.max(cur_max_p, max_p)
local new_max_e      = math.max(cur_max_e, max_e)

redis.call("HMSET", meta_key,
    "expires_at",       tostring(new_expires_at),
    "max_participants", tostring(new_max_p),
    "max_events",       tostring(new_max_e))

local eid = redis.call("INCR", seq_key)
local event_json = '{"eid":' .. eid .. ',"type":"boosted","uid":' .. uid_json .. ',"boostId":"' .. boost_id .. '","ts":' .. now_ms .. '}'
redis.call("ZADD", events_key, eid, event_json)
redis.call("ZREMRANGEBYRANK", events_key, 0, -(new_max_e + 1))

local all_keys = redis.call("SMEMBERS", keys_key)
for _, k in ipairs(all_keys) do
    redis.call("PEXPIREAT", k, new_expires_at)
end

return {"ok", eid, new_expires_at, new_max_p, new_max_e}
`)

// ApplyBoost atomically upgrades a room's expiry and participant/event caps,
// appends a "boosted" system event, and re-sets TTLs on all room keys.
// Returns ErrRoomNotFound if the room has expired.
func (s *Store) ApplyBoost(ctx appctx.AppCtx, req store.ApplyBoostRequest) (*store.ApplyBoostResult, error) {
	// Build uid_json: "null" for non-members, '"<uid>"' for members.
	uidJSON := "null"
	if req.BoosterUID != "" {
		uidJSON = fmt.Sprintf(`"%s"`, req.BoosterUID)
	}

	keys := []string{
		keyMeta(req.RoomID),
		keyEvents(req.RoomID),
		keyEventSeq(req.RoomID),
		keyKeys(req.RoomID),
	}
	args := []interface{}{
		strconv.FormatInt(req.TTLMs, 10),
		strconv.Itoa(req.MaxParticipants),
		strconv.Itoa(req.MaxEvents),
		uidJSON,
		req.BoostID,
		strconv.FormatInt(ctx.Now.UnixMilli(), 10),
	}

	raw, err := boostScript.Run(ctx, s.rdb, keys, args...).Result()
	if err != nil {
		return nil, err
	}

	arr, ok := raw.([]interface{})
	if !ok || len(arr) < 5 {
		return nil, errors.New("unexpected boost script result")
	}

	status, _ := arr[0].(string)
	if status == "room_not_found" {
		return nil, ErrRoomNotFound
	}

	return &store.ApplyBoostResult{
		Eid:          arr[1].(int64),
		NewExpiresAt: arr[2].(int64),
		NewMaxParts:  int(arr[3].(int64)),
		NewMaxEvents: int(arr[4].(int64)),
	}, nil
}
