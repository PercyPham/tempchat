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
	"log"
	"net/http"
	"regexp"
	"strconv"
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

// orderIDPattern matches both "tc_<hex>" (canonical) and "tc<hex>" (underscore stripped by some banks).
var orderIDPattern = regexp.MustCompile(`tc_?[a-f0-9]{8,}`)

// --- InitiatePayment ---

type initiatePaymentBody struct {
	BoostID  string `json:"boostId" binding:"required"`
	Provider string `json:"provider" binding:"required"`
}

// InitiatePayment handles POST /v1/payments/initiate.
// Requires X-TempChat-Auth; uid may be null for non-members.
func InitiatePayment(s store.Store) gin.HandlerFunc {
	return func(c *gin.Context) {
		cfg := config.Payment()
		ctx := appctx.FromGin(c)

		roomID := c.Param("roomId")

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

		room, err := s.GetRoom(ctx, roomID)
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
			RoomID:    roomID,
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

		switch body.Provider {
		case "sepay":
			c.JSON(http.StatusOK, gin.H{
				"provider":      "sepay",
				"orderId":       orderID,
				"amountVnd":     boostOpt.Pricing.VND,
				"accountNumber": cfg.SepayAccountNumber,
				"bankCode":      cfg.SepayBankCode,
				"bankName":      cfg.SepayBankName,
			})

		case "polar":
			if cfg.PolarAccessToken == "" || boostOpt.Pricing.PolarProductID == "" {
				c.JSON(http.StatusBadGateway, gin.H{"error": "polar_not_configured"})
				return
			}
			successURL := fmt.Sprintf("%s/chat/%s?orderId=%s", cfg.AppBaseURL, roomID, orderID)
			checkoutURL, err := createPolarCheckout(boostOpt.Pricing.PolarProductID, successURL, orderID)
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
func createPolarCheckout(productID, successURL, orderID string) (string, error) {
	cfg := config.Payment()

	baseURL := "https://api.polar.sh"
	if cfg.PolarEnv == "sandbox" {
		baseURL = "https://sandbox-api.polar.sh"
	}

	payload := map[string]any{
		"products":    []string{productID},
		"success_url": successURL,
		"metadata":    map[string]string{"orderId": orderID},
	}
	body, err := json.Marshal(payload)
	if err != nil {
		return "", err
	}

	req, err := http.NewRequest(http.MethodPost, baseURL+"/v1/checkouts", bytes.NewReader(body))
	if err != nil {
		return "", err
	}
	req.Header.Set("Authorization", "Bearer "+cfg.PolarAccessToken)
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

// extractOrderID searches each field for the first tc_<hex> token and returns
// it in canonical form (with underscore). Some banks strip underscores from
// transfer content, so "tc56498f088b417b21" is normalized to "tc_56498f088b417b21".
func extractOrderID(content string) string {
	if m := orderIDPattern.FindString(content); m != "" {
		if len(m) > 2 && m[2] != '_' {
			return "tc_" + m[2:]
		}
		return m
	}
	return ""
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

		// Extract orderId from any field SePay may carry it in.
		orderID := extractOrderID(payload.Content)
		if orderID == "" {
			c.Status(http.StatusOK) // unknown reference — don't retry
			return
		}

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
			log.Printf("polar_webhook: failed to read body: %v", err)
			c.JSON(http.StatusBadRequest, gin.H{"error": "read_error"})
			return
		}

		// Verify standardWebhooks HMAC-SHA256 signature.
		webhookID := c.GetHeader("webhook-id")
		webhookTimestamp := c.GetHeader("webhook-timestamp")
		webhookSig := c.GetHeader("webhook-signature")

		if cfg.PolarWebhookSecret != "" {
			if !verifyPolarSignature(cfg.PolarWebhookSecret, webhookID, webhookTimestamp, rawBody, webhookSig) {
				log.Printf("polar_webhook: invalid_signature")
				c.JSON(http.StatusBadRequest, gin.H{"error": "invalid_signature"})
				return
			}
		}

		// Parse event.
		var event struct {
			Type string `json:"type"`
			Data struct {
				BillingReason string            `json:"billing_reason"`
				Metadata      map[string]string `json:"metadata"`
			} `json:"data"`
		}
		if err := json.Unmarshal(rawBody, &event); err != nil {
			log.Printf("polar_webhook: failed to parse JSON: %v", err)
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
			log.Printf("polar_webhook: GetOrder(%q) error: %v", orderID, err)
			c.Status(http.StatusOK)
			return
		}

		if order.Status != "pending" {
			c.Status(http.StatusOK)
			return
		}

		boostOpt, ok := boostoptions.GetBoostOption(order.BoostID)
		if !ok {
			log.Printf("polar_webhook: unknown boostID %q", order.BoostID)
			c.Status(http.StatusOK)
			return
		}

		applyBoostOrIssueCoupon(ctx, s, h, order, boostOpt)

		_ = s.SetIdempotencyKey(ctx, idempKey, "processed", 7*24*time.Hour)
		log.Printf("polar_webhook: processed order %q", orderID)
		c.Status(http.StatusOK)
	}
}

// verifyPolarSignature verifies a Polar standardWebhooks HMAC-SHA256 signature.
// Polar uses the full secret string (e.g. "polar_whs_xxx") as the raw HMAC key —
// no prefix stripping, no base64 decoding. Signed content: "{id}.{ts}.{body}".
func verifyPolarSignature(secretEnv, webhookID, webhookTimestamp string, rawBody []byte, sigHeader string) bool {
	// Parse timestamp header (unix epoch integer).
	tsInt, err := strconv.ParseInt(webhookTimestamp, 10, 64)
	if err != nil {
		log.Printf("polar_webhook: verify: bad timestamp %q: %v", webhookTimestamp, err)
		return false
	}

	// Key is the full secret string as raw bytes — Polar does not base64-decode it.
	toSign := fmt.Sprintf("%s.%d.%s", webhookID, tsInt, rawBody)
	h := hmac.New(sha256.New, []byte(secretEnv))
	h.Write([]byte(toSign))
	expected := make([]byte, base64.StdEncoding.EncodedLen(h.Size()))
	base64.StdEncoding.Encode(expected, h.Sum(nil))

	// Header may contain multiple "v1,<base64>" signatures separated by spaces.
	for _, versionedSig := range strings.Split(sigHeader, " ") {
		parts := strings.SplitN(versionedSig, ",", 2)
		if len(parts) < 2 || parts[0] != "v1" {
			continue
		}
		if hmac.Equal([]byte(parts[1]), expected) {
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
