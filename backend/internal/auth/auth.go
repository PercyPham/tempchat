// Package auth implements server-side verification of TempChat auth tokens.
package auth

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"errors"
	"strings"
	"time"
)

// RoomAccessTokenClaims holds the parsed contents of an X-TempChat-Auth token.
type RoomAccessTokenClaims struct {
	Rid string  `json:"rid"`
	Uid *string `json:"uid"` // nil for join requests
	Ts  int64   `json:"ts"`
}

var (
	ErrMalformed        = errors.New("malformed token")
	ErrExpired          = errors.New("token timestamp out of window")
	ErrInvalidSignature = errors.New("invalid signature")
)

// VerifyRoomAccessToken decodes and validates an X-TempChat-Auth token.
//
// Token format: base64url(claimsJSON).base64url(HMAC-SHA256-sig)
// The signing input is the raw encoded claims string (the part before ".").
// accessKey must be the raw HMAC key bytes stored at room creation.
// Returns ErrMalformed, ErrExpired, or ErrInvalidSignature on failure.
func VerifyRoomAccessToken(token string, accessKey []byte) (*RoomAccessTokenClaims, error) {
	parts := strings.Split(token, ".")
	if len(parts) != 2 {
		return nil, ErrMalformed
	}

	claimsBytes, err := base64.RawURLEncoding.DecodeString(parts[0])
	if err != nil {
		return nil, ErrMalformed
	}

	sigBytes, err := base64.RawURLEncoding.DecodeString(parts[1])
	if err != nil {
		return nil, ErrMalformed
	}

	mac := hmac.New(sha256.New, accessKey)
	mac.Write([]byte(parts[0]))
	expected := mac.Sum(nil)

	if !hmac.Equal(expected, sigBytes) {
		return nil, ErrInvalidSignature
	}

	var claims RoomAccessTokenClaims
	if err := json.Unmarshal(claimsBytes, &claims); err != nil {
		return nil, ErrMalformed
	}

	now := time.Now().UnixMilli()
	diff := claims.Ts - now
	if diff < 0 {
		diff = -diff
	}
	if diff > 5000 {
		return nil, ErrExpired
	}

	return &claims, nil
}
