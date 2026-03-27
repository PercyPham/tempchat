package redis

import (
	"crypto/rand"
	"encoding/hex"
	"errors"
	"time"

	"github.com/percypham/tempchat/internal/appctx"
	"github.com/percypham/tempchat/internal/store"
	"github.com/redis/go-redis/v9"
)

const (
	couponTTL = 7 * 24 * time.Hour
	orderTTL  = 24 * time.Hour
)

func keyCoupon(code string) string   { return "coupon:" + code }
func keyOrder(orderID string) string { return "order:" + orderID + ":meta" }

// NewCouponCode generates a cryptographically random coupon code.
// Format: tc_cpn_ + 16 hex characters.
func NewCouponCode() (string, error) {
	b := make([]byte, 8)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	return "tc_cpn_" + hex.EncodeToString(b), nil
}

// NewOrderID generates a cryptographically random order ID.
// Format: tc_ + 16 hex characters.
func NewOrderID() (string, error) {
	b := make([]byte, 8)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	return "tc_" + hex.EncodeToString(b), nil
}

// CreateCoupon writes a coupon hash with a 7-day TTL.
func (s *Store) CreateCoupon(ctx appctx.AppCtx, c *store.Coupon) error {
	pipe := s.rdb.Pipeline()
	pipe.HSet(ctx, keyCoupon(c.Code),
		"boost_id",          c.BoostID,
		"boost_name",        c.BoostName,
		"ttl_ms",            c.TTLMs,
		"max_participants",  c.MaxParticipants,
		"max_events",        c.MaxEvents,
		"original_order_id", c.OriginalOrderID,
		"status",            c.Status,
		"created_at",        c.CreatedAt,
	)
	pipe.Expire(ctx, keyCoupon(c.Code), couponTTL)
	_, err := pipe.Exec(ctx)
	return err
}

// GetCoupon loads a coupon from Redis. Returns store.ErrCouponNotFound if absent.
func (s *Store) GetCoupon(ctx appctx.AppCtx, code string) (*store.Coupon, error) {
	m, err := s.rdb.HGetAll(ctx, keyCoupon(code)).Result()
	if err != nil {
		return nil, err
	}
	if len(m) == 0 {
		return nil, store.ErrCouponNotFound
	}
	return &store.Coupon{
		Code:            code,
		BoostID:         m["boost_id"],
		BoostName:       m["boost_name"],
		TTLMs:           parseInt64(m["ttl_ms"]),
		MaxParticipants: int(parseInt64(m["max_participants"])),
		MaxEvents:       int(parseInt64(m["max_events"])),
		OriginalOrderID: m["original_order_id"],
		Status:          m["status"],
		CreatedAt:       parseInt64(m["created_at"]),
		UsedAt:          parseInt64(m["used_at"]),
		UsedForRoomID:   m["used_for_room_id"],
	}, nil
}

// MarkCouponUsed marks a coupon as used with a timestamp and the room it was applied to.
func (s *Store) MarkCouponUsed(ctx appctx.AppCtx, code, roomID string) error {
	return s.rdb.HSet(ctx, keyCoupon(code),
		"status",           "used",
		"used_at",          ctx.Now.UnixMilli(),
		"used_for_room_id", roomID,
	).Err()
}

// GetOrder loads an order from Redis. Returns store.ErrOrderNotFound if absent.
func (s *Store) GetOrder(ctx appctx.AppCtx, orderID string) (*store.Order, error) {
	m, err := s.rdb.HGetAll(ctx, keyOrder(orderID)).Result()
	if err != nil {
		return nil, err
	}
	if len(m) == 0 {
		return nil, store.ErrOrderNotFound
	}
	return &store.Order{
		OrderID:    orderID,
		RoomID:     m["room_id"],
		BoostID:    m["boost_id"],
		UID:        m["uid"],
		Provider:   m["provider"],
		Status:     m["status"],
		CouponCode: m["coupon_code"],
		AmountVND:  parseInt64(m["amount_vnd"]),
		CreatedAt:  parseInt64(m["created_at"]),
	}, nil
}

// CreateOrder writes an order hash with a 24-hour TTL.
func (s *Store) CreateOrder(ctx appctx.AppCtx, o *store.Order) error {
	pipe := s.rdb.Pipeline()
	pipe.HSet(ctx, keyOrder(o.OrderID),
		"room_id",    o.RoomID,
		"boost_id",   o.BoostID,
		"uid",        o.UID,
		"provider",   o.Provider,
		"status",     o.Status,
		"coupon_code", o.CouponCode,
		"amount_vnd", o.AmountVND,
		"created_at", o.CreatedAt,
	)
	pipe.Expire(ctx, keyOrder(o.OrderID), orderTTL)
	_, err := pipe.Exec(ctx)
	return err
}

// SetOrderCompleted marks an order as completed.
func (s *Store) SetOrderCompleted(ctx appctx.AppCtx, orderID string) error {
	return s.rdb.HSet(ctx, keyOrder(orderID), "status", "completed").Err()
}

// SetOrderRoomExpired marks an order as room_expired and records the issued coupon code.
func (s *Store) SetOrderRoomExpired(ctx appctx.AppCtx, orderID, couponCode string) error {
	return s.rdb.HSet(ctx, keyOrder(orderID),
		"status",      "room_expired",
		"coupon_code", couponCode,
	).Err()
}

// SetIdempotencyKey stores an idempotency key with a TTL.
func (s *Store) SetIdempotencyKey(ctx appctx.AppCtx, key, value string, ttl time.Duration) error {
	return s.rdb.Set(ctx, key, value, ttl).Err()
}

// CheckIdempotencyKey returns the stored value if the key exists, otherwise ("", false, nil).
func (s *Store) CheckIdempotencyKey(ctx appctx.AppCtx, key string) (string, bool, error) {
	val, err := s.rdb.Get(ctx, key).Result()
	if err != nil {
		if errors.Is(err, redis.Nil) {
			return "", false, nil
		}
		return "", false, err
	}
	return val, true, nil
}
