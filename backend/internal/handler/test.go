package handler

import (
	"net/http"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/percypham/tempchat/internal/appctx"
	"github.com/percypham/tempchat/internal/boostoptions"
	"github.com/percypham/tempchat/internal/store"
	storeredis "github.com/percypham/tempchat/internal/store/redis"
)

// createTestCouponBody is the request body for POST /v1/test/coupons.
type createTestCouponBody struct {
	BoostID string `json:"boostId" binding:"required"`
}

// CreateTestCoupon handles POST /v1/test/coupons (test server only).
// It creates a coupon and a fake order in room_expired state so integration
// tests can exercise the GetOrderStatus and RedeemCoupon endpoints.
func CreateTestCoupon(s store.Store) gin.HandlerFunc {
	return func(c *gin.Context) {
		var body createTestCouponBody
		if err := c.ShouldBindJSON(&body); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid_body"})
			return
		}

		opt, ok := boostoptions.GetBoostOption(body.BoostID)
		if !ok {
			c.JSON(http.StatusBadRequest, gin.H{"error": "unknown_boost_id"})
			return
		}

		ctx := appctx.FromGin(c)
		nowMs := ctx.Now.UnixMilli()

		couponCode, err := storeredis.NewCouponCode()
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "internal"})
			return
		}

		orderID, err := storeredis.NewOrderID()
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "internal"})
			return
		}

		ttlMs := opt.TTL.Milliseconds()

		coupon := &store.Coupon{
			Code:            couponCode,
			BoostID:         opt.ID,
			BoostName:       opt.Name,
			TTLMs:           ttlMs,
			MaxParticipants: opt.MaxParticipants,
			MaxEvents:       opt.MaxEvents,
			OriginalOrderID: orderID,
			Status:          "unused",
			CreatedAt:       nowMs,
		}
		if err := s.CreateCoupon(ctx, coupon); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "internal"})
			return
		}

		order := &store.Order{
			OrderID:    orderID,
			BoostID:    opt.ID,
			Status:     "room_expired",
			CouponCode: couponCode,
			CreatedAt:  nowMs,
		}
		if err := s.CreateOrder(ctx, order); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "internal"})
			return
		}

		expiresAt := nowMs + int64(7*24*time.Hour/time.Millisecond)

		c.JSON(http.StatusCreated, gin.H{
			"orderId":         orderID,
			"code":            couponCode,
			"boostName":       opt.Name,
			"ttlMs":           ttlMs,
			"maxParticipants": opt.MaxParticipants,
			"maxEvents":       opt.MaxEvents,
			"expiresAt":       expiresAt,
		})
	}
}
