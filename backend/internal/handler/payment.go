package handler

import (
	"bytes"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"regexp"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/percypham/tempchat/internal/appctx"
	"github.com/percypham/tempchat/internal/auth"
	"github.com/percypham/tempchat/internal/boostoptions"
	"github.com/percypham/tempchat/internal/common/config"
	"github.com/percypham/tempchat/internal/hub"
	"github.com/percypham/tempchat/internal/middleware"
	"github.com/percypham/tempchat/internal/store"
	storeredis "github.com/percypham/tempchat/internal/store/redis"
)

var sepayAllowedIPs = map[string]bool{
	"172.236.138.20":  true,
	"172.233.83.68":   true,
	"171.244.35.2":    true,
	"151.158.108.68":  true,
	"151.158.109.79":  true,
	"103.255.238.139": true,
}

var orderIDPattern = regexp.MustCompile(`tc_[a-f0-9]+`)

// --- InitiatePayment ---

type initiatePaymentBody struct {
	RoomID   string `json:"roomId"  binding:"required"`
	BoostID  string `json:"boostId" binding:"required"`
	Provider string `json:"provider" binding:"required"`
}

// InitiatePayment handles POST /v1/payments/initiate.
// Requires X-TempChat-Auth; uid may be null for non-members.
func InitiatePayment(s store.Store) gin.HandlerFunc {
	return func(c *gin.Context) {
		cfg := config.Payment()
		ctx := appctx.FromGin(c)

		var body initiatePaymentBody
		if err := c.ShouldBindJSON(&body); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid_body"})
			return
		}
		if body.Provider != "sepay" && body.Provider != "polar" {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid_provider"})
			return
		}

		boostOpt, ok := boostoptions.GetBoostOption(body.BoostID)
		if !ok {
			c.JSON(http.StatusBadRequest, gin.H{"error": "unknown_boost_id"})
			return
		}

		room, err := s.GetRoom(ctx, body.RoomID)
		if err != nil {
			if errors.Is(err, storeredis.ErrRoomNotFound) {
				c.JSON(http.StatusNotFound, gin.H{"error": "room_not_found"})
				return
			}
			c.JSON(http.StatusInternalServerError, gin.H{"error": "internal"})
			return
		}

		// Non-member capacity check.
		claimsVal, _ := c.Get(middleware.ClaimsKey)
		claims, _ := claimsVal.(*auth.RoomAccessTokenClaims)
		boosterUID := ""
		if claims != nil && claims.Uid != nil {
			boosterUID = *claims.Uid
		}
		if boosterUID == "" && boostOpt.MaxParticipants <= room.MemberCount {
			c.JSON(http.StatusBadRequest, gin.H{"error": "insufficient_capacity"})
			return
		}

		orderID, err := storeredis.NewOrderID()
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "internal"})
			return
		}

		order := &store.Order{
			OrderID:   orderID,
			RoomID:    body.RoomID,
			BoostID:   body.BoostID,
			UID:       boosterUID,
			Provider:  body.Provider,
			Status:    "pending",
			AmountVND: boostOpt.Pricing.VND,
			CreatedAt: ctx.Now.UnixMilli(),
		}
		if err := s.CreateOrder(ctx, order); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "internal"})
			return
		}

		expiresAt := ctx.Now.Add(24 * time.Hour).UnixMilli()

		switch body.Provider {
		case "sepay":
			qrURL := fmt.Sprintf(
				"https://qr.sepay.vn/img?acc=%s&bank=%s&amount=%d&des=%s&template=compact",
				cfg.SepayAccountNumber, cfg.SepayBankCode, boostOpt.Pricing.VND, orderID,
			)
			c.JSON(http.StatusOK, gin.H{
				"provider":  "sepay",
				"orderId":   orderID,
				"qrUrl":     qrURL,
				"amount":    boostOpt.Pricing.VND,
				"currency":  "VND",
				"expiresAt": expiresAt,
			})

		case "polar":
			if cfg.PolarAccessToken == "" || boostOpt.Pricing.PolarProductPriceID == "" {
				c.JSON(http.StatusBadGateway, gin.H{"error": "polar_not_configured"})
				return
			}
			successURL := fmt.Sprintf("%s/chat/%s?orderId=%s", cfg.AppBaseURL, body.RoomID, orderID)
			checkoutURL, err := createPolarCheckout(cfg.PolarAccessToken, boostOpt.Pricing.PolarProductPriceID, successURL, orderID)
			if err != nil {
				c.JSON(http.StatusBadGateway, gin.H{"error": "polar_unavailable"})
				return
			}
			c.JSON(http.StatusOK, gin.H{
				"provider":    "polar",
				"orderId":     orderID,
				"checkoutUrl": checkoutURL,
			})
		}
	}
}

// createPolarCheckout calls the Polar API to create a hosted checkout session.
func createPolarCheckout(accessToken, priceID, successURL, orderID string) (string, error) {
	payload := map[string]any{
		"product_price_id": priceID,
		"success_url":      successURL,
		"metadata":         map[string]string{"orderId": orderID},
	}
	body, err := json.Marshal(payload)
	if err != nil {
		return "", err
	}

	req, err := http.NewRequest(http.MethodPost, "https://api.polar.sh/v1/checkouts", bytes.NewReader(body))
	if err != nil {
		return "", err
	}
	req.Header.Set("Authorization", "Bearer "+accessToken)
	req.Header.Set("Content-Type", "application/json")

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()

	if resp.StatusCode >= 300 {
		return "", fmt.Errorf("polar API returned %d", resp.StatusCode)
	}

	var result struct {
		URL string `json:"url"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return "", err
	}
	return result.URL, nil
}

// --- SepayWebhook ---

type sepayWebhookPayload struct {
	ID             int64   `json:"id"`
	Gateway        string  `json:"gateway"`
	TransferAmount float64 `json:"transferAmount"`
	Content        string  `json:"content"`
	ReferenceCode  string  `json:"referenceCode"`
	TransferType   string  `json:"transferType"`
}

// SepayWebhook handles POST /v1/payments/sepay/webhook.
func SepayWebhook(s store.Store, h *hub.Hub) gin.HandlerFunc {
	return func(c *gin.Context) {
		cfg := config.Payment()
		ctx := appctx.FromGin(c)

		// IP whitelist — only enforced in release/production mode.
		if gin.Mode() == gin.ReleaseMode {
			clientIP := c.ClientIP()
			if !sepayAllowedIPs[clientIP] {
				c.JSON(http.StatusForbidden, gin.H{"error": "forbidden"})
				return
			}
		}

		// API key verification.
		authHeader := c.GetHeader("Authorization")
		expectedKey := "Apikey " + cfg.SepayWebhookAPIKey
		if cfg.SepayWebhookAPIKey == "" || authHeader != expectedKey {
			c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthorized"})
			return
		}

		var payload sepayWebhookPayload
		if err := c.ShouldBindJSON(&payload); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid_body"})
			return
		}

		// Extract orderId from the payment content field.
		match := orderIDPattern.FindString(payload.Content)
		if match == "" {
			c.Status(http.StatusOK) // unknown reference — don't retry
			return
		}
		orderID := match

		// Idempotency check.
		idempKey := "payment:sepay:ref:" + payload.ReferenceCode
		if _, exists, _ := s.CheckIdempotencyKey(ctx, idempKey); exists {
			c.Status(http.StatusOK)
			return
		}

		order, err := s.GetOrder(ctx, orderID)
		if err != nil {
			c.Status(http.StatusOK) // stale/unknown order
			return
		}
		if order.Status != "pending" {
			c.Status(http.StatusOK)
			return
		}

		// Amount verification.
		if int64(payload.TransferAmount) != order.AmountVND {
			c.Status(http.StatusOK) // wrong amount — don't process
			return
		}

		boostOpt, ok := boostoptions.GetBoostOption(order.BoostID)
		if !ok {
			c.Status(http.StatusOK)
			return
		}

		applyBoostOrIssueCoupon(ctx, s, h, order, boostOpt)

		// Mark idempotency key so duplicate callbacks are ignored.
		_ = s.SetIdempotencyKey(ctx, idempKey, orderID, 7*24*time.Hour)
		c.Status(http.StatusOK)
	}
}

// --- PolarWebhook ---

// PolarWebhook handles POST /v1/payments/polar/webhook.
func PolarWebhook(s store.Store, h *hub.Hub) gin.HandlerFunc {
	return func(c *gin.Context) {
		cfg := config.Payment()
		ctx := appctx.FromGin(c)

		// Read raw body before binding (needed for signature verification).
		rawBody, err := io.ReadAll(c.Request.Body)
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "read_error"})
			return
		}

		// Verify standardWebhooks HMAC-SHA256 signature.
		webhookID := c.GetHeader("webhook-id")
		webhookTimestamp := c.GetHeader("webhook-timestamp")
		webhookSig := c.GetHeader("webhook-signature")

		if cfg.PolarWebhookSecret != "" {
			if !verifyPolarSignature(cfg.PolarWebhookSecret, webhookID, webhookTimestamp, rawBody, webhookSig) {
				c.JSON(http.StatusBadRequest, gin.H{"error": "invalid_signature"})
				return
			}
		}

		// Parse event.
		var event struct {
			Type string `json:"type"`
			Data struct {
				BillingReason string `json:"billing_reason"`
				Metadata      map[string]string `json:"metadata"`
			} `json:"data"`
		}
		if err := json.Unmarshal(rawBody, &event); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid_body"})
			return
		}

		// Only process order.paid with billing_reason == "purchase".
		if event.Type != "order.paid" || event.Data.BillingReason != "purchase" {
			c.Status(http.StatusOK)
			return
		}

		// Idempotency check.
		idempKey := "payment:polar:webhook:" + webhookID
		if _, exists, _ := s.CheckIdempotencyKey(ctx, idempKey); exists {
			c.Status(http.StatusOK)
			return
		}

		orderID := event.Data.Metadata["orderId"]
		if orderID == "" {
			c.Status(http.StatusOK)
			return
		}

		order, err := s.GetOrder(ctx, orderID)
		if err != nil {
			c.Status(http.StatusOK)
			return
		}
		if order.Status != "pending" {
			c.Status(http.StatusOK)
			return
		}

		boostOpt, ok := boostoptions.GetBoostOption(order.BoostID)
		if !ok {
			c.Status(http.StatusOK)
			return
		}

		applyBoostOrIssueCoupon(ctx, s, h, order, boostOpt)

		_ = s.SetIdempotencyKey(ctx, idempKey, "processed", 7*24*time.Hour)
		c.Status(http.StatusOK)
	}
}

// verifyPolarSignature verifies a Polar standardWebhooks HMAC-SHA256 signature.
// The signed string is "{webhookId}.{webhookTimestamp}.{rawBody}".
// The secret is base64-encoded; the signature header is "v1,{base64(hmac)}".
func verifyPolarSignature(secretB64, webhookID, webhookTimestamp string, rawBody []byte, sigHeader string) bool {
	secret, err := base64.StdEncoding.DecodeString(secretB64)
	if err != nil {
		return false
	}

	signedContent := webhookID + "." + webhookTimestamp + "." + string(rawBody)
	mac := hmac.New(sha256.New, secret)
	mac.Write([]byte(signedContent))
	expected := "v1," + base64.StdEncoding.EncodeToString(mac.Sum(nil))

	// The header may contain multiple signatures separated by spaces.
	for _, sig := range strings.Fields(sigHeader) {
		if hmac.Equal([]byte(sig), []byte(expected)) {
			return true
		}
	}
	return false
}

// --- Shared helper ---

// applyBoostOrIssueCoupon applies a boost to the room or issues a coupon if the room has expired.
// Called by both SepayWebhook and PolarWebhook after verifying the order.
func applyBoostOrIssueCoupon(ctx appctx.AppCtx, s store.Store, h *hub.Hub, order *store.Order, boostOpt boostoptions.BoostOption) {
	req := store.ApplyBoostRequest{
		RoomID:          order.RoomID,
		BoosterUID:      order.UID,
		BoostID:         order.BoostID,
		TTLMs:           boostOpt.TTL.Milliseconds(),
		MaxParticipants: boostOpt.MaxParticipants,
		MaxEvents:       boostOpt.MaxEvents,
	}

	result, err := s.ApplyBoost(ctx, req)
	if err != nil {
		if errors.Is(err, storeredis.ErrRoomNotFound) {
			// Room expired — issue a coupon instead.
			issueCouponForExpiredRoom(ctx, s, order, boostOpt)
			return
		}
		// Other errors: best-effort, don't fail the webhook.
		return
	}

	// Broadcast room:boosted WS event.
	var uid any = nil
	if order.UID != "" {
		uid = order.UID
	}
	_ = h.Publish(ctx, order.RoomID, gin.H{
		"event":           "room:boosted",
		"eid":             result.Eid,
		"type":            "boosted",
		"uid":             uid,
		"boostId":         order.BoostID,
		"expiresAt":       result.NewExpiresAt,
		"maxParticipants": result.NewMaxParts,
		"maxEvents":       result.NewMaxEvents,
		"ts":              ctx.Now.UnixMilli(),
	})

	_ = s.SetOrderCompleted(ctx, order.OrderID)
}

// issueCouponForExpiredRoom creates a coupon and marks the order as room_expired.
func issueCouponForExpiredRoom(ctx appctx.AppCtx, s store.Store, order *store.Order, boostOpt boostoptions.BoostOption) {
	code, err := storeredis.NewCouponCode()
	if err != nil {
		return
	}
	coupon := &store.Coupon{
		Code:            code,
		BoostID:         boostOpt.ID,
		BoostName:       boostOpt.Name,
		TTLMs:           boostOpt.TTL.Milliseconds(),
		MaxParticipants: boostOpt.MaxParticipants,
		MaxEvents:       boostOpt.MaxEvents,
		OriginalOrderID: order.OrderID,
		Status:          "unused",
		CreatedAt:       ctx.Now.UnixMilli(),
	}
	if err := s.CreateCoupon(ctx, coupon); err != nil {
		return
	}
	_ = s.SetOrderRoomExpired(ctx, order.OrderID, code)
}
