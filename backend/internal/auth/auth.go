// Package auth implements server-side verification of TempChat auth tokens.
package auth

import (
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/sha512"
	"encoding/base64"
	"encoding/json"
	"errors"
	"math/big"
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

// p384PublicJWK is used to parse the public key JWK from the client.
type p384PublicJWK struct {
	Kty string `json:"kty"`
	Crv string `json:"crv"`
	X   string `json:"x"`
	Y   string `json:"y"`
}

// VerifyRoomAccessToken decodes and validates an X-TempChat-Auth token.
//
// Token format: base64url(claimsJSON).base64url(ECDSA-P384-sig)
// The signing input is the raw encoded claims string (the part before ".").
// publicKeyJWK must be the JWK JSON of the ECDSA P-384 public key stored at room creation.
// now is the server's current time (captured at request receipt).
// Returns ErrMalformed, ErrExpired, or ErrInvalidSignature on failure.
func VerifyRoomAccessToken(now time.Time, token string, publicKeyJWK string) (*RoomAccessTokenClaims, error) {
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

	// Parse the public key from JWK JSON
	pubKey, err := parseP384PublicJWK(publicKeyJWK)
	if err != nil {
		return nil, ErrMalformed
	}

	// SHA-384 hash the encoded claims part (the part before ".")
	digest := sha512.Sum384([]byte(parts[0]))

	// P1363 signature format for P-384: 96 bytes, r = sig[:48], s = sig[48:]
	if len(sigBytes) != 96 {
		return nil, ErrInvalidSignature
	}
	r := new(big.Int).SetBytes(sigBytes[:48])
	s := new(big.Int).SetBytes(sigBytes[48:])

	if !ecdsa.Verify(pubKey, digest[:], r, s) {
		return nil, ErrInvalidSignature
	}

	var claims RoomAccessTokenClaims
	if err := json.Unmarshal(claimsBytes, &claims); err != nil {
		return nil, ErrMalformed
	}

	nowMs := now.UnixMilli()
	diff := claims.Ts - nowMs
	if diff < 0 {
		diff = -diff
	}
	if diff > 5000 {
		return nil, ErrExpired
	}

	return &claims, nil
}

// parseP384PublicJWK parses a JWK JSON string into an *ecdsa.PublicKey for P-384.
func parseP384PublicJWK(jwkJSON string) (*ecdsa.PublicKey, error) {
	var jwk p384PublicJWK
	if err := json.Unmarshal([]byte(jwkJSON), &jwk); err != nil {
		return nil, err
	}
	if jwk.Crv != "P-384" {
		return nil, errors.New("unsupported curve")
	}

	xBytes, err := base64.RawURLEncoding.DecodeString(jwk.X)
	if err != nil {
		return nil, err
	}
	yBytes, err := base64.RawURLEncoding.DecodeString(jwk.Y)
	if err != nil {
		return nil, err
	}

	return &ecdsa.PublicKey{
		Curve: elliptic.P384(),
		X:     new(big.Int).SetBytes(xBytes),
		Y:     new(big.Int).SetBytes(yBytes),
	}, nil
}
