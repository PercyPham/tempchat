# Redis Storage Design — TempChat

## Key Schema Summary

| Key                                | Structure        | TTL      |
| ---------------------------------- | ---------------- | -------- |
| `room:{roomId}:meta`               | Hash             | Room TTL |
| `room:{roomId}:users`              | Hash             | Room TTL |
| `room:{roomId}:user:{userId}:meta` | Hash             | Room TTL |
| `room:{roomId}:events`             | Sorted Set       | Room TTL |
| `room:{roomId}:event_seq`          | String (integer) | Room TTL |
| `room:{roomId}:keys`               | Set              | Room TTL |

---

## Key Definitions

### `room:{roomId}:meta` — Hash

Room configuration. Existence of this key is the source of truth for whether a room is alive.

| Field              | Type         | Description                                          |
| ------------------ | ------------ | ---------------------------------------------------- |
| `group_name`       | string       | Immutable display name, set at creation              |
| `access_key`       | string       | Hashed join token                                    |
| `max_participants` | integer      | Participant cap. Updated (MAX logic) when a boost is applied. |
| `max_events`       | integer      | Event history cap. Updated (MAX logic) when a boost is applied. |
| `created_at`       | integer (ms) | Unix timestamp of room creation                      |
| `expires_at`       | integer (ms) | Absolute expiry timestamp. Extended additively when a boost is applied. |

---

### `room:{roomId}:users` — Hash

Tracks **all users who ever joined**, including those who have left. Never remove entries — this is the canonical participant count.

| Field      | Value        | Description                 |
| ---------- | ------------ | --------------------------- |
| `{userId}` | integer (ms) | Join timestamp of that user |

- **Participant count** (including left users): `HLEN room:{roomId}:users`
- **Cap enforcement**: reject join if `HLEN >= max_participants`

---

### `room:{roomId}:user:{userId}:meta` — Hash

Ephemeral user identity, scoped to the room. `userId` is only unique within a room.

| Field          | Type         | Description                                                      |
| -------------- | ------------ | ---------------------------------------------------------------- |
| `display_name` | string       | Chosen nickname                                                  |
| `joined_at`    | integer (ms) | Join timestamp                                                   |
| `join_eid`     | integer      | Value of `event_seq` at join time. Lower bound for history fetch |
| `left_at`      | integer (ms) | Leave timestamp. Absent if user is still in room                 |

---

### `room:{roomId}:events` — Sorted Set

Append-only event log. Score is the sequence number for strict ordering.

**Score:** sequence number (`eid`), monotonically increasing via `room:{roomId}:event_seq`

**Member:** JSON string

```jsonc
// Chat message — "type" is omitted (chat is the default)
{
  "eid": 42,
  "uid": "xyz0987654",
  "msg": "<encrypted_blob>",
  "ts": 1700001500000        // Unix ms, for display purposes only
}

// System event
{
  "eid": 43,
  "type": "joined",          // "joined" | "left"
  "uid": "xyz0987654",
  "ts": 1700001000000
}

// Boost system event
{
  "eid": 44,
  "type": "boosted",
  "uid": "xyz0987654",       // userId of the booster, or null if non-member
  "boostId": "boost_abc123", // ID of the boost option purchased
  "ts": 1700002000000
}
```

**TTL:** Room TTL — the set lives as long as the room.

**Length cap:** After every `ZADD`, trim to the latest `max_events` entries atomically in the publish Lua script:

```redis
ZADD room:{roomId}:events {eid} {json}
ZREMRANGEBYRANK room:{roomId}:events 0 -(max_events + 1)
```

This retains only the most recent N events and drops the oldest automatically when the cap is exceeded.

**Late-join history query** — fetch all events after a user's join sequence:

```redis
ZRANGEBYSCORE room:{roomId}:events {join_eid} +inf
```

> `join_eid` is stored in `room:{roomId}:user:{userId}:meta` at join time. If it predates the oldest retained event (due to the cap), the user receives whatever remains in the set.

---

### `room:{roomId}:event_seq` — String (integer)

Monotonic counter. Incremented atomically before each event write. The returned value is used as the event's `eid`.

```redis
INCR room:{roomId}:event_seq
```

---

### `room:{roomId}:keys` — Set

Registry of every Redis key belonging to this room. Used for deterministic cleanup when the room expires.

Populated at room creation:

```redis
SADD room:{roomId}:keys
  "room:{roomId}:meta"
  "room:{roomId}:users"
  "room:{roomId}:events"
  "room:{roomId}:event_seq"
  "room:{roomId}:keys"
```

Each time a new user joins, their meta key is registered:

```redis
SADD room:{roomId}:keys "room:{roomId}:user:{userId}:meta"
```

---

## TTL Strategy

| Tier  | Room TTL          | Max Participants | Max Events |
| ----- | ----------------- | ---------------- | ---------- |
| Free  | 1 hour (3600s)    | 5                | 50         |
| Plus  | 24 hours (86400s) | 20               | 100        |
| Pro   | 7 days (604800s)  | 100              | 200        |

> At creation, `max_participants` / `max_events` / `expires_at` reflect the Free tier defaults above. Boost options are served dynamically from the backend and applied additively on top of the current state.

- All keys carry the **room TTL**.

## Boost Strategy

Boosts are applied atomically via a Lua script, triggered by a payment webhook:

1. Read `expires_at`, `max_participants`, `max_events` from meta
2. `new_expires_at = current_expires_at + boost.ttl_ms` (additive — not relative to now)
3. `new_max_participants = MAX(current, boost.maxParticipants)`
4. `new_max_events = MAX(current, boost.maxEvents)`
5. `HMSET room:{roomId}:meta` — write all updated fields
6. Append a `boosted` system event to `room:{roomId}:events` (using `INCR event_seq` for the eid)
7. `SMEMBERS room:{roomId}:keys` — fetch all room keys
8. For each key: `PEXPIREAT key new_expires_at`

**Why `PEXPIREAT` over `EXPIRE`**: All keys must share the same absolute deadline. A relative `EXPIRE` inside a loop would skew deadlines by milliseconds.

---

## Cleanup on Room Expiry

Enable keyspace notifications in Redis config:

```
notify-keyspace-events Ex
```

Listen for `expired` events on `room:{roomId}:meta`. When fired, the cleanup worker:

1. Reads all members of `room:{roomId}:keys`
2. Issues a pipelined `DEL` for every key in the set
3. Deletes `room:{roomId}:keys` itself

```
room:{roomId}:meta  --[expired]--> cleanup worker
                                      └─ SMEMBERS room:{roomId}:keys
                                      └─ DEL all members
                                      └─ DEL room:{roomId}:keys
```

---

## Scalability Notes

- **Redis Cluster**: Use hash tags so all room keys land on the same slot, which is required for multi-key Lua scripts. Rename keys to `{roomId}:room:meta`, `{roomId}:room:users`, etc.
- **Pub/Sub**: Use `PUBLISH room:{roomId}` for real-time WebSocket fan-out. The sorted set is the persistence layer; pub/sub is the delivery layer.
- **Memory estimate (free room)**: ~5 users × ~50 events × ~512 bytes/event ≈ ~125 KB per active room. Pro rooms: ~100 users × ~200 events × ~512 bytes/event ≈ ~10 MB worst case.
