package handler

import (
	"errors"
	"net/http"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/percypham/tempchat/internal/appctx"
	"github.com/percypham/tempchat/internal/auth"
	"github.com/percypham/tempchat/internal/hub"
	"github.com/percypham/tempchat/internal/middleware"
	"github.com/percypham/tempchat/internal/store"
	storeredis "github.com/percypham/tempchat/internal/store/redis"
)

// GetOrderStatus handles GET /v1/orders/:orderId.
// No auth required — the orderId is a random secret that serves as proof of intent.
func GetOrderStatus(s store.Store) gin.HandlerFunc {
	return func(c *gin.Context) {
		orderID := c.Param("orderId")
		ctx := appctx.FromGin(c)

		order, err := s.GetOrder(ctx, orderID)
		if err != nil {
			if errors.Is(err, store.ErrOrderNotFound) {
				c.JSON(http.StatusNotFound, gin.H{"error": "order_not_found"})
				return
			}
			c.JSON(http.StatusInternalServerError, gin.H{"error": "internal"})
			return
		}

		switch order.Status {
		case "pending":
			c.JSON(http.StatusOK, gin.H{"status": "pending"})
		case "completed":
			c.JSON(http.StatusOK, gin.H{"status": "completed"})
		case "room_expired":
			coupon, err := s.GetCoupon(ctx, order.CouponCode)
			if err != nil {
				// Coupon may have expired (7-day TTL). Return status without coupon data.
				c.JSON(http.StatusOK, gin.H{"status": "room_expired"})
				return
			}
			expiresAt := coupon.CreatedAt + int64(7*24*time.Hour/time.Millisecond)
			c.JSON(http.StatusOK, gin.H{
				"status": "room_expired",
				"coupon": gin.H{
					"code":            coupon.Code,
					"boostName":       coupon.BoostName,
					"ttlMs":           coupon.TTLMs,
					"maxParticipants": coupon.MaxParticipants,
					"maxEvents":       coupon.MaxEvents,
					"expiresAt":       expiresAt,
				},
			})
		default:
			c.JSON(http.StatusOK, gin.H{"status": order.Status})
		}
	}
}

// redeemCouponBody is the request body for POST /v1/rooms/:roomId/redeem-coupon.
type redeemCouponBody struct {
	CouponCode string `json:"couponCode" binding:"required"`
}

// RedeemCoupon handles POST /v1/rooms/:roomId/redeem-coupon.
// Requires X-TempChat-Auth; uid may be null for non-members.
func RedeemCoupon(s store.Store, h *hub.Hub) gin.HandlerFunc {
	return func(c *gin.Context) {
		roomID := c.Param("roomId")
		ctx := appctx.FromGin(c)

		var body redeemCouponBody
		if err := c.ShouldBindJSON(&body); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid_body"})
			return
		}

		// Load and validate coupon.
		coupon, err := s.GetCoupon(ctx, body.CouponCode)
		if err != nil {
			if errors.Is(err, store.ErrCouponNotFound) {
				c.JSON(http.StatusNotFound, gin.H{"error": "coupon_not_found"})
				return
			}
			c.JSON(http.StatusInternalServerError, gin.H{"error": "internal"})
			return
		}
		if coupon.Status != "unused" {
			c.JSON(http.StatusConflict, gin.H{"error": "coupon_already_used"})
			return
		}

		// Verify room exists and get current state for non-member capacity check.
		room, err := s.GetRoom(ctx, roomID)
		if err != nil {
			if errors.Is(err, storeredis.ErrRoomNotFound) {
				c.JSON(http.StatusNotFound, gin.H{"error": "room_not_found"})
				return
			}
			c.JSON(http.StatusInternalServerError, gin.H{"error": "internal"})
			return
		}

		// Non-member capacity check: the boost must raise the participant cap
		// high enough to allow the non-member to join.
		claims, _ := c.Get(middleware.ClaimsKey)
		claimsVal, _ := claims.(*auth.RoomAccessTokenClaims)
		boosterUID := ""
		if claimsVal != nil && claimsVal.Uid != nil {
			boosterUID = *claimsVal.Uid
		}
		if boosterUID == "" && coupon.MaxParticipants <= room.MemberCount {
			c.JSON(http.StatusForbidden, gin.H{"error": "insufficient_capacity"})
			return
		}

		// Apply boost using coupon snapshot values.
		result, err := s.ApplyBoost(ctx, store.ApplyBoostRequest{
			RoomID:          roomID,
			BoosterUID:      boosterUID,
			BoostID:         coupon.BoostID,
			TTLMs:           coupon.TTLMs,
			MaxParticipants: coupon.MaxParticipants,
			MaxEvents:       coupon.MaxEvents,
		})
		if err != nil {
			if errors.Is(err, storeredis.ErrRoomNotFound) {
				c.JSON(http.StatusNotFound, gin.H{"error": "room_not_found"})
				return
			}
			c.JSON(http.StatusInternalServerError, gin.H{"error": "internal"})
			return
		}

		// Mark coupon as used.
		if err := s.MarkCouponUsed(ctx, body.CouponCode, roomID); err != nil {
			// Non-fatal: boost was already applied; log and continue.
			_ = err
		}

		// Broadcast room:boosted WebSocket event.
		var uid interface{} = nil
		if boosterUID != "" {
			uid = boosterUID
		}
		_ = h.Publish(ctx, roomID, gin.H{
			"event":           "room:boosted",
			"eid":             result.Eid,
			"type":            "boosted",
			"uid":             uid,
			"boostId":         coupon.BoostID,
			"expiresAt":       result.NewExpiresAt,
			"maxParticipants": result.NewMaxParts,
			"maxEvents":       result.NewMaxEvents,
			"ts":              ctx.Now.UnixMilli(),
		})

		c.Status(http.StatusOK)
	}
}
