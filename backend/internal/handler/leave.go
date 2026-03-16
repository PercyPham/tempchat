package handler

import (
	"log"
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/percypham/tempchat/internal/appctx"
	"github.com/percypham/tempchat/internal/auth"
	"github.com/percypham/tempchat/internal/hub"
	"github.com/percypham/tempchat/internal/middleware"
	"github.com/percypham/tempchat/internal/store"
)

// LeaveRoom handles DELETE /v1/rooms/:roomId/members/me.
// Called when a user explicitly chooses "Leave & Delete Room".
// Records left_at, appends a "left" system event, and broadcasts user:left.
func LeaveRoom(s store.Store, h *hub.Hub) gin.HandlerFunc {
	return func(c *gin.Context) {
		roomID := c.Param("roomId")

		claims, _ := c.Get(middleware.ClaimsKey)
		claimsTyped, _ := claims.(*auth.RoomAccessTokenClaims)
		if claimsTyped == nil || claimsTyped.Uid == nil || *claimsTyped.Uid == "" {
			c.JSON(http.StatusUnauthorized, gin.H{"error": "uid_required"})
			return
		}
		userID := *claimsTyped.Uid

		ctx := appctx.FromGin(c)

		leftEid, err := s.SetUserLeft(ctx, roomID, userID)
		if err != nil {
			log.Printf("leave: SetUserLeft error: %v", err)
			c.JSON(http.StatusInternalServerError, gin.H{"error": "internal_error"})
			return
		}

		_ = h.Publish(ctx, roomID, gin.H{
			"event": "user:left",
			"eid":   leftEid,
			"uid":   userID,
			"ts":    ctx.Now.UnixMilli(),
		})

		c.Status(http.StatusNoContent)
	}
}
