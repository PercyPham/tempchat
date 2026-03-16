// Package middleware provides Gin middleware for TempChat.
package middleware

import (
	"errors"
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/percypham/tempchat/internal/appctx"
	"github.com/percypham/tempchat/internal/auth"
	"github.com/percypham/tempchat/internal/store"
	storeredis "github.com/percypham/tempchat/internal/store/redis"
)

// ClaimsKey is the Gin context key under which verified claims are stored.
const ClaimsKey = "auth_claims"

// RequireAuth returns a Gin middleware that validates the X-TempChat-Auth header.
// uid in the token may be nil (valid for join requests and non-member boost).
func RequireAuth(s store.Store) gin.HandlerFunc {
	return func(c *gin.Context) {
		token := c.GetHeader("X-TempChat-Auth")
		if token == "" {
			c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{"error": "missing_auth"})
			return
		}

		ctx := appctx.FromGin(c)
		roomID := c.Param("roomId")
		accessKey, err := s.GetRoomAccessKey(ctx, roomID)
		if err != nil {
			if errors.Is(err, storeredis.ErrRoomNotFound) {
				c.AbortWithStatusJSON(http.StatusNotFound, gin.H{"error": "room_not_found"})
				return
			}
			c.AbortWithStatusJSON(http.StatusInternalServerError, gin.H{"error": "internal"})
			return
		}

		claims, err := auth.VerifyRoomAccessToken(ctx.Now, token, accessKey)
		if err != nil {
			c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{"error": "invalid_auth"})
			return
		}

		if claims.Rid != roomID {
			c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{"error": "invalid_auth"})
			return
		}

		c.Set(ClaimsKey, claims)
		c.Next()
	}
}
